"""Turn a source file into per-page text and tables.

Per page, in order of preference:

1. The PDF text layer, when it passes the corruption check (``text.quality``).
2. Font recovery: glyphs decoded through the embedded fonts (``font_recovery``), accepted only when
   independent OCR of the same page agrees.
3. OCR, using the strategy below.

OCR strategy:

* Every page whose text layer fails the quality check is OCR'd twice in the same tesseract run:
  once as a full page and once as horizontal *line bands* cut at the visual line positions of the
  PDF. Line positions remain correct even when the glyph-to-Unicode mapping is broken.
* Full-page OCR silently dropped lines on real documents; line bands cannot drop a line without it
  showing up as an empty band, but they read multi-column layouts (e.g. definition tables) poorly.
* Per page, the variant with the higher ``min(line_coverage, 1) * confidence`` is kept, and pages
  that remain weak are flagged ``needs_review``.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber
import pymupdf

from import_compliance_rag.ingestion.font_recovery import FontRecovery, agreement, learn_corrections
from import_compliance_rag.ingestion.ocr import OcrResult, OcrUnavailableError, TesseractOcr
from import_compliance_rag.schemas.regulatory import (
    ExtractionMethod,
    ExtractionPolicy,
    ExtractionReport,
    ExtractionStatus,
    Language,
    PageExtraction,
)
from import_compliance_rag.text.arabic import clean_original
from import_compliance_rag.text.language import detect_language
from import_compliance_rag.text.quality import assess_text_layer

log = logging.getLogger(__name__)

# An OCR'd page below either threshold is flagged for human review against the source PDF.
LOW_OCR_CONFIDENCE = 85.0
MIN_LINE_COVERAGE = 0.9
MIN_DECODED_RATIO = 0.9  # share of glyphs that must decode through embedded fonts to attempt recovery
PSM_SINGLE_LINE = 7
PSM_RAW_LINE = 13

# Restricting tesseract to the document's script avoids hallucinated Latin words in Arabic text
# (measured: with ara+eng, "جهة" was read as "Age"; with ara alone it was read correctly).
OCR_LANGUAGES = {Language.AR: "ara", Language.EN: "eng", Language.MIXED: "ara+eng"}


@dataclass
class PageText:
    page_number: int
    text: str
    method: ExtractionMethod


@dataclass
class ExtractedTable:
    page_number: int
    rows: list[list[str]]  # first row is treated as the header


@dataclass
class ExtractedDocument:
    pages: list[PageText]
    tables: list[ExtractedTable]
    report: ExtractionReport


@dataclass
class _PageLayer:
    text: str
    quality: float
    reasons: list[str]
    bands: list[pymupdf.Rect] = field(default_factory=list)


class DocumentExtractor:
    def __init__(
        self,
        ocr: TesseractOcr,
        min_page_quality: float = 0.85,
        min_line_coverage: float = MIN_LINE_COVERAGE,
        min_recovery_agreement: float = 0.75,
        verification_dpi: int = 200,
    ) -> None:
        self.ocr = ocr
        self.min_page_quality = min_page_quality
        self.min_line_coverage = min_line_coverage
        self.min_recovery_agreement = min_recovery_agreement
        self.verification_dpi = verification_dpi

    def extract(
        self,
        path: Path,
        policy: ExtractionPolicy = ExtractionPolicy.AUTO,
        language: Language = Language.UNKNOWN,
    ) -> ExtractedDocument:
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            return self._extract_pdf(path, policy, OCR_LANGUAGES.get(language))
        if suffix in {".txt", ".md"}:
            return self._extract_plain(path)
        raise ValueError(f"Unsupported source format: {suffix}")

    def _extract_plain(self, path: Path) -> ExtractedDocument:
        text = clean_original(path.read_text(encoding="utf-8"))
        page = PageExtraction(page_number=1, method=ExtractionMethod.PLAIN_TEXT, char_count=len(text))
        report = ExtractionReport(
            method=ExtractionMethod.PLAIN_TEXT,
            status=ExtractionStatus.SUCCEEDED if text else ExtractionStatus.FAILED,
            page_count=1,
            pages=[page],
            detected_language=detect_language(text),
        )
        return ExtractedDocument([PageText(1, text, ExtractionMethod.PLAIN_TEXT)], [], report)

    def _extract_pdf(
        self, path: Path, policy: ExtractionPolicy, ocr_languages: str | None
    ) -> ExtractedDocument:
        warnings: list[str] = []
        corrections: dict[str, dict[str, int]] = {}
        recovered: dict[int, tuple[str, float]] = {}
        ocr_choice: dict[int, tuple[str, OcrResult, float | None]] = {}
        with pymupdf.open(path) as doc:
            layers: dict[int, _PageLayer] = {}
            for n, page in enumerate(doc, start=1):
                text = page.get_text("text")
                q = assess_text_layer(text)
                layers[n] = _PageLayer(text, q.score, q.reasons, line_bands(page))
            page_count = doc.page_count

            if policy is ExtractionPolicy.OCR:
                rejected = list(layers)
            elif policy is ExtractionPolicy.TEXT_LAYER:
                rejected = []
            else:
                rejected = [n for n, layer in layers.items() if layer.quality < self.min_page_quality]

            if rejected:
                try:
                    remaining = rejected
                    if policy is ExtractionPolicy.AUTO:
                        recovered, corrections, remaining = self._recover_pages(
                            doc, rejected, ocr_languages
                        )
                    if remaining:
                        ocr_choice = self._ocr_pages(doc, layers, remaining, ocr_languages)
                except OcrUnavailableError as exc:
                    # Without OCR, neither recovered text can be verified nor OCR text produced.
                    warnings.append(str(exc))
                    log.warning("ocr.unavailable", extra={"pdf": str(path), "pages": rejected})

        pages: list[PageText] = []
        reports: list[PageExtraction] = []
        for n, layer in layers.items():
            page_warnings = list(layer.reasons)
            report = PageExtraction(
                page_number=n,
                method=ExtractionMethod.TEXT_LAYER,
                text_layer_quality=layer.quality,
                char_count=0,
            )
            if n in recovered:
                text, agreement_score = recovered[n]
                report.method = ExtractionMethod.FONT_RECOVERY
                report.verification_agreement = agreement_score
            elif n in ocr_choice:
                strategy, result, coverage = ocr_choice[n]
                text = clean_original(result.text)
                report.method = ExtractionMethod.OCR
                report.ocr_strategy = strategy
                report.ocr_confidence = result.mean_confidence
                report.line_coverage = coverage
                if result.mean_confidence is None or result.mean_confidence < LOW_OCR_CONFIDENCE:
                    page_warnings.append(f"low OCR confidence ({result.mean_confidence})")
                    report.needs_review = True
                if coverage is not None and coverage < self.min_line_coverage:
                    page_warnings.append(f"possible dropped lines (line coverage {coverage})")
                    report.needs_review = True
            elif n in rejected:
                # Corrupted text layer and no verified alternative: never index text known to be wrong.
                text = ""
                page_warnings.append("text layer rejected and no verified alternative; page not indexed")
            else:
                text = clean_original(layer.text)
            report.char_count = len(text)
            report.warnings = page_warnings
            pages.append(PageText(n, text, report.method))
            reports.append(report)

        # Tables are only taken from trustworthy text layers. Recovered or OCR'd tables would need
        # layout analysis that is not implemented; report that instead of silently flattening them.
        trusted = [n for n in layers if n not in rejected]
        tables = _extract_tables(path, trusted)
        if rejected:
            warnings.append("table structure is not extracted from recovered or OCR'd pages")

        methods = {p.method for p in pages if p.text}
        method = methods.pop() if len(methods) == 1 else ExtractionMethod.MIXED
        empty = [p.page_number for p in pages if not p.text]
        if len(empty) == page_count:
            status = ExtractionStatus.FAILED
        elif empty or any(r.needs_review for r in reports):
            status = ExtractionStatus.PARTIAL
        else:
            status = ExtractionStatus.SUCCEEDED
        report = ExtractionReport(
            method=method,
            status=status,
            page_count=page_count,
            pages=reports,
            detected_language=detect_language(" ".join(p.text for p in pages)),
            tables_found=len(tables),
            glyph_corrections=corrections,
            warnings=warnings,
        )
        return ExtractedDocument(pages, tables, report)

    def _recover_pages(
        self, doc: pymupdf.Document, page_numbers: list[int], languages: str | None
    ) -> tuple[dict[int, tuple[str, float]], dict[str, dict[str, int]], list[int]]:
        """Font-cmap recovery verified against OCR. Returns (accepted, corrections, fallback pages)."""
        recovery = FontRecovery(doc)
        pages = [recovery.recover_page(doc[n - 1], n) for n in page_numbers]
        candidates = [p for p in pages if p.decoded_ratio >= MIN_DECODED_RATIO]
        if not candidates:
            return {}, {}, page_numbers
        verification = self.ocr.recognize(
            [self.ocr.render(doc[p.page_number - 1], dpi=self.verification_dpi) for p in candidates],
            languages,
        )
        ocr_texts = {p.page_number: r.text for p, r in zip(candidates, verification, strict=True)}
        learned = learn_corrections(candidates, ocr_texts)
        accepted: dict[int, tuple[str, float]] = {}
        for page in candidates:
            text = clean_original(page.text(learned.corrections))
            score = agreement(text, ocr_texts[page.page_number])
            if score >= self.min_recovery_agreement and assess_text_layer(text).score >= self.min_page_quality:
                accepted[page.page_number] = (text, score)
        fallback = [n for n in page_numbers if n not in accepted]
        log.info(
            "font_recovery.done",
            extra={"accepted": len(accepted), "fallback": len(fallback), "corrections": learned.evidence},
        )
        return accepted, learned.evidence, fallback

    def _ocr_pages(
        self,
        doc: pymupdf.Document,
        layers: dict[int, _PageLayer],
        page_numbers: list[int],
        languages: str | None,
    ) -> dict[int, tuple[str, OcrResult, float | None]]:
        full_images = [self.ocr.render(doc[n - 1]) for n in page_numbers]
        band_owner: list[int] = []
        band_images: list[pymupdf.Pixmap] = []
        for n in page_numbers:
            for rect in layers[n].bands:
                band_owner.append(n)
                band_images.append(self.ocr.render(doc[n - 1], clip=rect))

        full_results = self.ocr.recognize(full_images, languages)
        band_results = self.ocr.recognize(band_images, languages, PSM_SINGLE_LINE)
        # Tesseract occasionally returns nothing for a clean single line in PSM 7; retry those
        # bands in raw-line mode, which always yields text (at lower confidence).
        empty = [i for i, r in enumerate(band_results) if not r.text.strip()]
        if empty:
            retry = self.ocr.recognize([band_images[i] for i in empty], languages, PSM_RAW_LINE)
            for i, r in zip(empty, retry, strict=True):
                band_results[i] = OcrResult(strip_raw_line_noise(r.text), r.mean_confidence, r.word_count)

        chosen: dict[int, tuple[str, OcrResult, float | None]] = {}
        for n, full in zip(page_numbers, full_results, strict=True):
            bands = [r for owner, r in zip(band_owner, band_results, strict=True) if owner == n]
            if not bands:  # no positional information (e.g. a scanned page)
                chosen[n] = ("full_page", full, None)
                continue
            expected = len(bands)
            full_coverage = round(_line_count(full.text) / expected, 3)
            merged = _merge_bands(bands)
            band_coverage = round(sum(1 for r in bands if r.text.strip()) / expected, 3)
            candidates = [("full_page", full, full_coverage), ("line_bands", merged, band_coverage)]
            chosen[n] = max(candidates, key=lambda c: min(c[2], 1.0) * (c[1].mean_confidence or 0))
        return chosen


def line_bands(page: pymupdf.Page, pad: float = 1.5) -> list[pymupdf.Rect]:
    """Full-width horizontal bands, one per visual line; vertically overlapping lines are merged."""
    lines = [
        pymupdf.Rect(line["bbox"])
        for block in page.get_text("dict")["blocks"]
        for line in block.get("lines", [])
        if any(span["text"].strip() for span in line["spans"])
    ]
    if not lines:
        return []
    lines.sort(key=lambda r: r.y0)
    merged: list[pymupdf.Rect] = []
    for rect in lines:
        if merged:
            overlap = min(merged[-1].y1, rect.y1) - max(merged[-1].y0, rect.y0)
            if overlap > 0.3 * min(merged[-1].height, rect.height):
                merged[-1] |= rect
                continue
        merged.append(pymupdf.Rect(rect))
    x0 = max(page.rect.x0, min(r.x0 for r in lines) - pad)
    x1 = min(page.rect.x1, max(r.x1 for r in lines) + pad)
    return [pymupdf.Rect(x0, r.y0 - pad, x1, r.y1 + pad) & page.rect for r in merged]


_TRAILING_NOISE = re.compile(r"(?:\s+[0-9]{6,})+\s*$")


def strip_raw_line_noise(text: str) -> str:
    """Remove the long digit runs PSM 13 emits for blank space at the end of a short line.

    Only runs of six or more digits drawn from at most two distinct characters are removed
    (e.g. ``000000`` or ``020202``); real numbers such as dates or HS codes are kept.
    """
    match = _TRAILING_NOISE.search(text)
    if match and all(len(set(tok)) <= 2 for tok in match.group(0).split()):
        return text[: match.start()].rstrip()
    return text


def _line_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if line.strip())


def _merge_bands(results: list[OcrResult]) -> OcrResult:
    lines = [r.text.strip() for r in results if r.text.strip()]
    words = sum(r.word_count for r in results)
    weighted = sum((r.mean_confidence or 0) * r.word_count for r in results)
    return OcrResult("\n".join(lines), round(weighted / words, 2) if words else None, words)


def _extract_tables(path: Path, page_numbers: list[int]) -> list[ExtractedTable]:
    if not page_numbers:
        return []
    tables: list[ExtractedTable] = []
    with pdfplumber.open(path) as pdf:
        for n in page_numbers:
            for raw in pdf.pages[n - 1].extract_tables():
                rows = [[clean_original(c or "") for c in row] for row in raw if any(row)]
                # A single column or single row is layout, not a data table.
                if len(rows) >= 2 and max(len(r) for r in rows) >= 2:
                    tables.append(ExtractedTable(n, rows))
    return tables
