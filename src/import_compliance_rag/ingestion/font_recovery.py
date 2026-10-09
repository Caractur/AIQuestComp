"""Recover text from PDFs whose ToUnicode maps are broken, using the embedded fonts themselves.

Background: many official Jordanian PDFs are Word exports in which the PDF-level ToUnicode table is
wrong (reversed lam-alef, scrambled digits, or legacy-encoded mojibake), while the embedded
TrueType font still carries a correct internal cmap and glyph names. Decoding each drawn glyph ID
through that font recovers the exact text, including Eastern Arabic numerals that OCR misreads.

Because a font's own labels can be wrong for individual glyphs (observed: a colon outline stored
under the glyph name "eight"), recovered text is never trusted on its own:

1. Each page is also OCR'd, and the two texts are aligned character by character.
2. For every (font, glyph) pair, agreements and 1:1 disagreements with OCR are counted. A glyph that
   OCR consistently reads as another character is remapped for the whole document (majority vote).
3. A page is accepted only if the corrected recovery agrees with OCR above a threshold; otherwise
   the caller falls back to OCR.

Glyph order on the page is visual. Lines are rebuilt right-to-left for Arabic, with runs of digits
and Latin letters kept left-to-right and brackets mirrored (a simplified inverse of the Unicode
bidi algorithm that holds for single-paragraph legal text lines).
"""

from __future__ import annotations

import difflib
import io
import logging
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import pymupdf
from fontTools.ttLib import TTFont

from import_compliance_rag.text.arabic import ARABIC_LETTER, LATIN_LETTER, normalize_for_retrieval

log = logging.getLogger(__name__)

GlyphKey = tuple[str, int]  # (font name as reported by MuPDF, glyph id)

_LTR_CHAR = re.compile(r"[0-9٠-٩۰-۹A-Za-z]")
_LTR_JOINER = set("./,:-%")
_MIRROR = str.maketrans("()[]{}<>«»", ")(][}{><»«")
_LINE_TOLERANCE = 2.0  # points between baselines of the same line

# Fonts label some Arabic-Indic digit glyphs with the visually identical Extended (Persian) code
# points; store one consistent form.
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "٠١٢٣٤٥٦٧٨٩")

MIN_VOTES = 3
MIN_VOTE_SHARE = 0.7


@dataclass
class GlyphChar:
    char: str
    key: GlyphKey | None  # None when the character did not come from a font-cmap decode
    x: float
    y: float


@dataclass
class RecoveredPage:
    page_number: int
    lines: list[list[GlyphChar]]
    decoded_ratio: float  # share of visible characters decoded through an embedded font map

    def text(self, corrections: dict[GlyphKey, str] | None = None) -> str:
        out = []
        for line in self.lines:
            chars = [
                corrections.get(c.key, c.char) if corrections and c.key else c.char for c in line
            ]
            text = unicodedata.normalize("NFKC", "".join(chars)).translate(_PERSIAN_DIGITS).strip()
            if text:
                out.append(text)
        return "\n".join(out)


@dataclass
class CorrectionReport:
    corrections: dict[GlyphKey, str] = field(default_factory=dict)
    evidence: dict[str, dict[str, int]] = field(default_factory=dict)


@dataclass
class _FontInfo:
    mapping: dict[int, str]  # glyph id -> character
    advances: dict[int, float]  # glyph id -> advance width in em


# A glyph is decoded through an embedded font only if the drawn width matches that font's advance
# width for the glyph. Spans do not identify their font object, and one page can carry several
# fonts with the same name (observed: an embedded Type0 "Times New Roman" whose glyph 27 is "eight"
# and a substituted simple "Times New Roman" whose glyph 27 is a colon).
_WIDTH_TOLERANCE_PT = 0.6
_WIDTH_TOLERANCE_REL = 0.15


class FontRecovery:
    def __init__(self, doc: pymupdf.Document) -> None:
        self.doc = doc
        self._fonts: dict[int, _FontInfo] = {}

    def _font_info(self, xref: int) -> _FontInfo:
        if xref not in self._fonts:
            info = _FontInfo({}, {})
            try:
                buffer = self.doc.extract_font(xref)[3]
                if buffer:
                    font = TTFont(io.BytesIO(buffer), lazy=True)
                    units = font["head"].unitsPerEm
                    order = font.getGlyphOrder()
                    for gid, name in enumerate(order):
                        if re.fullmatch(r"uni[0-9A-F]{4}", name):
                            info.mapping[gid] = chr(int(name[3:], 16))
                    for codepoint, name in (font.getBestCmap() or {}).items():
                        info.mapping[font.getGlyphID(name)] = chr(codepoint)
                    metrics = font["hmtx"].metrics
                    info.advances = {
                        gid: metrics[name][0] / units for gid, name in enumerate(order) if name in metrics
                    }
            except Exception as exc:  # malformed or non-TrueType font programs
                log.debug("font_recovery.font_unreadable", extra={"xref": xref, "err": str(exc)})
            self._fonts[xref] = info
        return self._fonts[xref]

    @staticmethod
    def _decode(candidates: list[_FontInfo], gid: int, size: float, width: float) -> str | None:
        for info in candidates:
            if gid not in info.mapping or gid not in info.advances:
                continue
            expected = info.advances[gid] * size
            if abs(expected - width) <= max(_WIDTH_TOLERANCE_PT, _WIDTH_TOLERANCE_REL * expected):
                return info.mapping[gid]
        return None

    def recover_page(self, page: pymupdf.Page, page_number: int) -> RecoveredPage:
        fonts: dict[str, list[_FontInfo]] = defaultdict(list)
        for xref, _ext, _type, base, *_ in page.get_fonts(full=True):
            info = self._font_info(xref)
            if info.mapping:
                fonts[base].append(info)
        chars: list[GlyphChar] = []
        decoded = visible = 0
        for span in page.get_texttrace():
            candidates = fonts.get(span["font"], [])
            previous_from_font = False
            for unicode, gid, origin, bbox in span["chars"]:
                if gid < 0:
                    # Continuation of a multi-character ToUnicode entry (e.g. the alef MuPDF emits
                    # after a lam-alef ligature). Redundant when the ligature was font-decoded.
                    if previous_from_font:
                        continue
                    char, key = chr(unicode), None
                elif (found := self._decode(candidates, gid, span["size"], bbox[2] - bbox[0])) is not None:
                    char, key = found, (span["font"], gid)
                else:
                    char, key = (chr(unicode) if unicode > 0 else "\ufffd"), None
                previous_from_font = key is not None
                if not char.isspace():
                    visible += 1
                    decoded += key is not None
                chars.append(GlyphChar(char, key, origin[0], origin[1]))
        lines = [_logical_order(line) for line in _group_lines(chars)]
        return RecoveredPage(page_number, lines, round(decoded / visible, 4) if visible else 0.0)


def _group_lines(chars: list[GlyphChar]) -> list[list[GlyphChar]]:
    lines: list[list[GlyphChar]] = []
    for char in sorted(chars, key=lambda c: c.y):
        if lines and abs(lines[-1][-1].y - char.y) <= _LINE_TOLERANCE:
            lines[-1].append(char)
        else:
            lines.append([char])
    return lines


def _logical_order(line: list[GlyphChar]) -> list[GlyphChar]:
    text = "".join(c.char for c in line)
    rtl = len(ARABIC_LETTER.findall(text)) >= len(LATIN_LETTER.findall(text))
    ordered = sorted(line, key=lambda c: -c.x if rtl else c.x)
    if not rtl:
        return ordered
    result: list[GlyphChar] = []
    i = 0
    while i < len(ordered):
        if _LTR_CHAR.match(ordered[i].char):
            j = i
            while j + 1 < len(ordered) and (
                _LTR_CHAR.match(ordered[j + 1].char)
                or (
                    ordered[j + 1].char in _LTR_JOINER
                    and j + 2 < len(ordered)
                    and _LTR_CHAR.match(ordered[j + 2].char)
                )
            ):
                j += 1
            result.extend(reversed(ordered[i : j + 1]))
            i = j + 1
        else:
            c = ordered[i]
            result.append(GlyphChar(c.char.translate(_MIRROR), c.key, c.x, c.y))
            i += 1
    return result


def learn_corrections(pages: list[RecoveredPage], ocr_texts: dict[int, str]) -> CorrectionReport:
    """Vote, per glyph, on what OCR reads where recovery and OCR disagree 1:1."""
    agree: Counter[GlyphKey] = Counter()
    disagree: dict[GlyphKey, Counter[str]] = defaultdict(Counter)
    for page in pages:
        ocr = ocr_texts.get(page.page_number)
        if not ocr:
            continue
        flat = [
            GlyphChar(ch, c.key, c.x, c.y)
            for line in page.lines
            for c in line + [GlyphChar("\n", None, 0, 0)]
            for ch in unicodedata.normalize("NFKC", c.char)
        ]
        recovered = "".join(c.char for c in flat)
        ocr = unicodedata.normalize("NFKC", ocr)
        matcher = difflib.SequenceMatcher(None, recovered, ocr, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for c in flat[i1:i2]:
                    if c.key:
                        agree[c.key] += 1
            elif tag == "replace" and i2 - i1 == j2 - j1:
                for c, o in zip(flat[i1:i2], ocr[j1:j2], strict=True):
                    if c.key and not o.isspace():
                        disagree[c.key][o] += 1

    report = CorrectionReport()
    for key, votes in disagree.items():
        source = _normalized_chars(key, pages)
        if len(source) != 1:
            continue  # ligatures expand to several characters; a 1:1 vote is meaningless
        target, count = votes.most_common(1)[0]
        if not _correctable(source, target):
            continue
        total = sum(votes.values())
        if count >= MIN_VOTES and count / total >= MIN_VOTE_SHARE and count > agree[key]:
            report.corrections[key] = target
            report.evidence[f"{key[0]}#{key[1]}"] = {
                "to": ord(target),
                "votes": count,
                "disagreements": total,
                "agreements": agree[key],
            }
    return report


def _category(char: str) -> str:
    if char.isdigit():
        return "digit"
    if ARABIC_LETTER.match(char) or LATIN_LETTER.match(char):
        return "letter"
    return "punct"


def _correctable(source: str, target: str) -> bool:
    """Which disagreements OCR is trusted to settle.

    OCR is a biased oracle: it systematically misreads Eastern Arabic digits as other digits and the
    Arabic comma as "»". Those disagreements are never "corrected". Accepted: letter -> letter, and
    digit -> ':' or '.' (a colon outline stored under the glyph name "eight" was observed).
    """
    s, t = _category(source), _category(target)
    if s == "letter" and t == "letter":
        return True
    return s == "digit" and target in ":."


def _normalized_chars(key: GlyphKey, pages: list[RecoveredPage]) -> str:
    for page in pages:
        for line in page.lines:
            for c in line:
                if c.key == key:
                    return unicodedata.normalize("NFKC", c.char)
    return ""


def agreement(recovered: str, ocr: str) -> float:
    """Similarity of two extractions after lossy normalization (letters and digits only)."""

    def squash(text: str) -> str:
        return re.sub(r"[^\w]", "", normalize_for_retrieval(text))

    a, b = squash(recovered), squash(ocr)
    if not a or not b:
        return 0.0
    return round(difflib.SequenceMatcher(None, a, b, autojunk=False).ratio(), 4)
