"""Recover the legal structure (sections, articles, clauses) from extracted page text.

Article numbers are critical for citations, so every number records how it was obtained:

* ``parsed``   — read cleanly from the heading and consistent with the document's sequence.
* ``inferred`` — the heading was found but its number was unreadable or implausible (typically
  OCR of Eastern Arabic numerals), so the number was inferred from document order.

Inferred numbers must be presented with a caveat; they are never silently treated as verified.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from import_compliance_rag.schemas.regulatory import Language
from import_compliance_rag.text.arabic import normalize_digits

# A heading line is short and contains the article keyword; OCR may place the number on either side
# (bidi ordering) and may drop the final ة.
_AR_ARTICLE_WORD = re.compile(r"(?:^|\s)(?:ال)?ماد(?:ة|ه)?(?=\s|$|[:\-–(])")
_AR_SECTION = re.compile(r"^\s*(الفصل|الباب|الجزء|القسم)\b.{0,60}$")
_EN_ARTICLE = re.compile(r"^\s*Article\s+(\d{1,3}(?:\.\d{1,2})?[A-Za-z]?)\b\s*[:.\-–]?\s*(.*)$", re.I)
_EN_SECTION = re.compile(r"^\s*(ANNEX|CHAPTER|SECTION|PART)\s+[\w.\-]+.*$", re.I)
_EN_PARAGRAPH = re.compile(r"^\s*(\d{1,2})\.\s*(.*)$")
_CLEAN_NUMBER = re.compile(r"^[(\[]?\s*(\d{1,3})\s*[)\]]?\s*(مكرر[ةه]?)?\s*[:.\-–]?$")
_NOISE = re.compile(r"[ًّْ-ِ'\"“”’‘*>|/\\؟?!,،.:؛;ْ]")
_AMENDMENT_NOTE = re.compile(r"^\s*-?\s*هكذا\s+اصبحت")
_DEFINITIONS_MARKERS = (
    "يكون للكلمات والعبارات التالية",
    "المعاني المخصصة لها",
    "shall have the meanings",
    "the following definitions",
    "for the purposes of this",
)

MAX_HEADING_TOKENS = 4
MAX_SEQUENCE_JUMP = 3


class NumberSource(StrEnum):
    PARSED = "parsed"
    INFERRED = "inferred"


@dataclass
class Line:
    text: str
    page: int


@dataclass
class Segment:
    kind: str  # "preamble" | "article" | "paragraph" | "text"
    number: str | None = None
    number_source: NumberSource | None = None
    raw_heading: str | None = None
    title: str | None = None
    section_path: list[str] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    is_definitions: bool = False
    amendment_notes: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def page_start(self) -> int | None:
        return self.lines[0].page if self.lines else None

    @property
    def page_end(self) -> int | None:
        return self.lines[-1].page if self.lines else None


@dataclass
class ParsedStructure:
    segments: list[Segment]
    warnings: list[str]


def parse_structure(pages: list[tuple[int, str]], language: Language) -> ParsedStructure:
    lines = [Line(text, page) for page, body in pages for text in body.splitlines() if text.strip()]
    if language is Language.EN:
        segments, warnings = _parse_english(lines)
    else:
        segments, warnings = _parse_arabic(lines)
    for segment in segments:
        _annotate(segment)
    return ParsedStructure([s for s in segments if s.lines or s.raw_heading], warnings)


def _parse_arabic(lines: list[Line]) -> tuple[list[Segment], list[str]]:
    warnings: list[str] = []
    segments = [Segment(kind="preamble")]
    section: list[str] = []
    previous: int | None = None
    for line in lines:
        if _AR_SECTION.match(line.text) and len(line.text.split()) <= 8:
            section = [line.text.strip()]
            continue
        heading = _arabic_heading_number(line.text)
        if heading is None:
            _append_body(segments[-1], line)
            continue
        number, suffix = heading
        label, source = _resolve_number(number, suffix, previous, line, warnings)
        previous = int(label.split()[0])
        segments.append(
            Segment(
                kind="article",
                number=label,
                number_source=source,
                raw_heading=line.text.strip(),
                section_path=list(section),
            )
        )
    if len(segments) == 1:
        warnings.append("no article headings found; document will be chunked without structure")
        segments[0].kind = "text"
    return segments, warnings


def _arabic_heading_number(text: str) -> tuple[int | None, str] | None:
    """Return (number or None if unreadable, suffix) when ``text`` is an article heading line."""
    stripped = text.strip()
    tokens = stripped.split()
    if not tokens or len(tokens) > MAX_HEADING_TOKENS + 2:
        return None
    match = _AR_ARTICLE_WORD.search(stripped)
    if not match:
        return None
    rest = (stripped[: match.start()] + " " + stripped[match.end() :]).strip()
    rest_digits = normalize_digits(rest)
    # Real heading lines carry little besides the number; longer remainders are body text that
    # happens to start with the word المادة (e.g. "المادة باشراف اجهزة الوزارة ...").
    words = [w for w in re.findall(r"[ء-ي]{3,}", rest_digits) if not w.startswith("مكرر")]
    if words:
        return None
    suffix = "مكرر" if "مكرر" in rest_digits else ""
    clean = _CLEAN_NUMBER.match(rest_digits.strip())
    if clean:
        return int(clean.group(1)), suffix
    # Eastern Arabic numerals that OCR mangled: accept only an unambiguous digit run once noise
    # glyphs are removed and the order is not split by other characters.
    compact = _NOISE.sub(" ", rest_digits).split()
    digit_tokens = [t for t in compact if t.isdigit()]
    if len(digit_tokens) == 1 and len(compact) == 1:
        return int(digit_tokens[0]), suffix
    return None, suffix


def _resolve_number(
    number: int | None, suffix: str, previous: int | None, line: Line, warnings: list[str]
) -> tuple[str, NumberSource]:
    if suffix:
        # "مكرر" articles are inserted after the article with the same number.
        base = number if number is not None and previous is not None and number == previous else previous
        if base is None:
            base = number or 1
        source = NumberSource.PARSED if number == base else NumberSource.INFERRED
        return f"{base} مكرر", source
    expected = 1 if previous is None else previous + 1
    if number is not None and previous is not None and previous < number <= previous + MAX_SEQUENCE_JUMP:
        if number != expected:
            warnings.append(f"article numbering jumps from {previous} to {number} (page {line.page})")
        return str(number), NumberSource.PARSED
    if number is not None and previous is None and number <= MAX_SEQUENCE_JUMP:
        return str(number), NumberSource.PARSED
    warnings.append(
        f"article heading '{line.text.strip()}' on page {line.page}: number unreadable or out of "
        f"sequence; inferred as {expected}"
    )
    return str(expected), NumberSource.INFERRED


def _parse_english(lines: list[Line]) -> tuple[list[Segment], list[str]]:
    warnings: list[str] = []
    segments = [Segment(kind="preamble")]
    section: list[str] = []
    has_articles = any(_EN_ARTICLE.match(line.text) for line in lines)
    expected_paragraph = 1
    for line in lines:
        if _EN_SECTION.match(line.text) and len(line.text.split()) <= 10:
            section = [line.text.strip()]
            expected_paragraph = 1
            continue
        if has_articles:
            match = _EN_ARTICLE.match(line.text)
            if match:
                segments.append(
                    Segment(
                        kind="article",
                        number=match.group(1),
                        number_source=NumberSource.PARSED,
                        raw_heading=line.text.strip(),
                        section_path=list(section),
                    )
                )
                if match.group(2).strip():
                    segments[-1].lines.append(Line(match.group(2).strip(), line.page))
                continue
        else:
            # Treaty annexes number top-level paragraphs "1.", "2.", ... Only the next number in
            # sequence starts a new paragraph, so list items and decimals are not mistaken for one.
            match = _EN_PARAGRAPH.match(line.text)
            if match and int(match.group(1)) == expected_paragraph:
                expected_paragraph += 1
                segments.append(
                    Segment(
                        kind="paragraph",
                        number=match.group(1),
                        number_source=NumberSource.PARSED,
                        raw_heading=line.text.strip(),
                        section_path=list(section),
                    )
                )
                if match.group(2).strip():
                    segments[-1].lines.append(Line(match.group(2).strip(), line.page))
                continue
        _append_body(segments[-1], line)
    if len(segments) == 1:
        warnings.append("no article or paragraph headings found; document will be chunked without structure")
        segments[0].kind = "text"
    return segments, warnings


def _append_body(segment: Segment, line: Line) -> None:
    segment.lines.append(line)


def _annotate(segment: Segment) -> None:
    text = segment.text
    lowered = text.lower()
    segment.is_definitions = any(marker in lowered for marker in _DEFINITIONS_MARKERS[:2]) or (
        segment.kind != "preamble" and any(m in lowered for m in _DEFINITIONS_MARKERS[2:4])
    )
    segment.amendment_notes = [line.text for line in segment.lines if _AMENDMENT_NOTE.match(line.text)]
    # A short first line ending with ':' directly under an article heading is the article's title
    # (e.g. "الانتاج النباتي :"), not its first clause.
    if segment.kind == "article" and segment.lines:
        first = segment.lines[0].text.strip()
        if first.endswith(":") and len(first.split()) <= 5 and not _looks_like_clause(first):
            segment.title = first.rstrip(" :")


_CLAUSE_START = re.compile(
    r"^\s*(?:"
    r"[ء-ي]\s?[.\-–)](?:\s|$)"  # أ.  ب-  ج)
    r"|[(\[]?[0-9٠-٩]{1,2}[)\]]?\s?[.\-–)]"  # 1.  (2)-  ١)
    r"|[.\-]\s?[0-9٠-٩]{1,2}(?=\S)"  # ".1اذا" — RTL OCR puts the period first
    r"|\([a-z0-9ivx]{1,4}\)"  # (a) (ii)
    r"|[a-z]\)"
    r")",
    re.I,
)


def _looks_like_clause(text: str) -> bool:
    return bool(_CLAUSE_START.match(text))


def split_clauses(lines: list[Line]) -> tuple[list[Line], list[list[Line]]]:
    """Split an article body into its lead-in lines and a list of clauses (each a list of lines)."""
    lead: list[Line] = []
    clauses: list[list[Line]] = []
    for line in lines:
        if _looks_like_clause(line.text) or _AMENDMENT_NOTE.match(line.text):
            clauses.append([line])
        elif clauses:
            clauses[-1].append(line)
        else:
            lead.append(line)
    return lead, clauses


_ARTICLE_REFERENCE = re.compile(
    r"(?:ال)?ماد(?:ة|ه|تين)\s*\(?\s*([0-9٠-٩]{1,3})\s*\)?(\s*(?:من|في)\s+(?:هذا|هذه)\s+(?:القانون|النظام|التعليمات))?"
    r"|Article\s+(\d{1,3})(\s+of\s+this\s+(?:Law|Agreement|Annex|Regulation))?",
    re.I,
)


def find_cross_references(text: str) -> list[tuple[str, str, bool]]:
    """Return (raw match, article number, refers to the same instrument) for article references.

    A bare "المادة (35)" without "من هذا القانون" is treated as internal as well, since Jordanian
    legislation names the other instrument explicitly when referring outside itself.
    """
    refs = []
    for match in _ARTICLE_REFERENCE.finditer(text):
        number = match.group(1) or match.group(3)
        external_hint = re.search(r"من\s+(?:قانون|نظام)\s+(?!هذا)", text[match.end() : match.end() + 30])
        refs.append((match.group(0).strip(), normalize_digits(number), external_hint is None))
    return refs
