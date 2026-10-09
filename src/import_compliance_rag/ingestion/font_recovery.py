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
from itertools import pairwise

import pymupdf
from fontTools.ttLib import TTFont
from pdfminer.pdfdevice import PDFTextDevice
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.utils import apply_matrix_pt

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
    decoded_ratio: float  # share of visible characters decoded through a font map or trusted encoding

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
        self._pdfminer_pages: list[PDFPage] | None = None
        self._rsrcmgr = PDFResourceManager()

    def _unembedded_origins(self, page: pymupdf.Page) -> set[tuple[int, int]]:
        """Origins (MuPDF page coordinates, rounded) of glyphs drawn with non-embedded fonts.

        Span font names do not identify the font object, and a page can carry an embedded Type0
        font and a non-embedded simple font under the same name. For equal-width glyphs (all digits
        in Times) the width check cannot tell them apart; observed in Law 21/2001, clause numbers
        "2." and "3." drawn with the non-embedded font were read through the embedded one as "0"
        and "1". The content stream says which font draws each glyph, so it is replayed here.
        """
        if self._pdfminer_pages is None:
            parser = PDFParser(io.BytesIO(self.doc.tobytes()))
            self._pdfminer_pages = list(PDFPage.create_pages(PDFDocument(parser)))
        recorder = _GlyphFontRecorder(self._rsrcmgr)
        PDFPageInterpreter(self._rsrcmgr, recorder).process_page(self._pdfminer_pages[page.number])
        x0, y0 = page.mediabox.x0, page.mediabox.y0  # pdfminer coordinates are relative to it
        to_page = page.transformation_matrix
        origins = set()
        for x, y, embedded in recorder.glyphs:
            if not embedded:
                point = pymupdf.Point(x + x0, y + y0) * to_page
                origins.add((round(point.x * 2), round(point.y * 2)))
        return origins

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
        substituted: set[str] = set()
        for xref, ext, _type, base, *_ in page.get_fonts(full=True):
            if ext == "n/a":
                substituted.add(base)
            info = self._font_info(xref)
            if info.mapping:
                fonts[base].append(info)
        # Text drawn with a non-embedded font comes from its standard encoding and is trusted.
        unembedded = self._unembedded_origins(page) if substituted else set()
        chars: list[GlyphChar] = []
        decoded = visible = 0
        for span in page.get_texttrace():
            ambiguous = span["font"] in substituted
            previous_from_font = False
            for unicode, gid, origin, bbox in span["chars"]:
                trusted = ambiguous and _near(origin, unembedded)
                candidates = [] if trusted else fonts.get(span["font"], [])
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
                    decoded += key is not None or trusted
                chars.append(GlyphChar(char, key, origin[0], origin[1]))
        lines = _reflow_definition_columns([_logical_order(line) for line in _group_lines(chars)])
        return RecoveredPage(page_number, lines, round(decoded / visible, 4) if visible else 0.0)


class _GlyphFontRecorder(PDFTextDevice):
    """Records each glyph drawn by the content stream with whether its font program is embedded."""

    def __init__(self, rsrcmgr: PDFResourceManager) -> None:
        super().__init__(rsrcmgr)
        self.glyphs: list[tuple[float, float, bool]] = []  # (x, y) in PDF user space, embedded

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate) -> float:  # noqa: ANN001
        x, y = apply_matrix_pt(matrix, (0, rise))
        descriptor = getattr(font, "descriptor", None) or {}
        embedded = any(k in descriptor for k in ("FontFile", "FontFile2", "FontFile3"))
        self.glyphs.append((x, y, embedded))
        return font.char_width(cid) * fontsize * scaling


def _near(origin: tuple[float, float], keys: set[tuple[int, int]]) -> bool:
    """Whether a glyph origin matches a recorded one (half-point grid, tolerant to rounding)."""
    kx, ky = round(origin[0] * 2), round(origin[1] * 2)
    return any((kx + dx, ky + dy) in keys for dx in (-1, 0, 1) for dy in (-1, 0, 1))


def _group_lines(chars: list[GlyphChar]) -> list[list[GlyphChar]]:
    lines: list[list[GlyphChar]] = []
    for char in sorted(chars, key=lambda c: c.y):
        if lines and abs(lines[-1][-1].y - char.y) <= _LINE_TOLERANCE:
            lines[-1].append(char)
        else:
            lines.append([char])
    return lines


# Definition articles are often laid out as a borderless table: term | ":" | definition, with the
# term vertically centred on its (possibly multi-line) definition. Read line by line, the term lands
# between definition lines ("def line 1 / term : / def line 2"). The colons sit in one aligned
# column, which is used to rebuild "term : definition" in reading order.
_MIN_ALIGNED_COLONS = 3
_COLON_X_TOLERANCE = 2.5
_COLUMN_GAP = 3.0  # definition text must end at least this far left of the colon column
_BLOCK_GAP_FACTOR = 1.2  # a vertical step above this multiple of the line pitch starts a new row
# Minimum distance (pt, between glyph origins) from the last definition glyph to the first term glyph
# on a line without the row's colon. Measured: ~17-23 pt in tables, 3-8 pt between words of prose.
_MIN_TERM_COLUMN_GAP = 10.0


def _reflow_definition_columns(lines: list[list[GlyphChar]]) -> list[list[GlyphChar]]:
    colon_xs = sorted(c.x for line in lines for c in line if c.char == ":")
    column = _densest(colon_xs, _COLON_X_TOLERANCE)
    if column is None:
        return lines
    count, col_x = column
    if count < _MIN_ALIGNED_COLONS:
        return lines

    def is_column_colon(c: GlyphChar) -> bool:
        return c.char == ":" and abs(c.x - col_x) <= _COLON_X_TOLERANCE

    def split(line: list[GlyphChar]) -> tuple[list[GlyphChar], list[GlyphChar]] | None:
        """(term part incl. colon, definition part) when the line fits the table, else None."""
        term = [c for c in line if c.x >= col_x - _COLON_X_TOLERANCE]
        definition = [c for c in line if c.x < col_x - _COLON_X_TOLERANCE]
        visible_term = [c for c in term if not c.char.isspace()]
        visible_def = [c for c in definition if not c.char.isspace()]
        if visible_def and max(c.x for c in visible_def) > col_x - _COLUMN_GAP - _COLON_X_TOLERANCE:
            return None
        # Text on both sides of the column without the row's colon is either a wrapped term next to
        # its definition (term column well to the right) or full-width prose that merely has a word
        # gap near the column (glyph origins only a few points apart).
        if visible_term and visible_def and not any(is_column_colon(c) for c in term):
            if min(c.x for c in visible_term) - max(c.x for c in visible_def) < _MIN_TERM_COLUMN_GAP:
                return None
        return term, definition

    out: list[list[GlyphChar]] = []
    i = 0
    while i < len(lines):
        # A table region is a run of lines that all fit the column layout and contains aligned colons.
        j = i
        while j < len(lines) and split(lines[j]) is not None:
            j += 1
        region = lines[i:j]
        colon_lines = [ln for ln in region if any(is_column_colon(c) for c in ln)]
        # The staggered layout shows itself through lines holding only "term :" (no definition text).
        # Without one, colons that merely line up (similar term lengths) are left alone.
        term_only = [ln for ln in colon_lines if not any(not c.char.isspace() for c in split(ln)[1])]
        if len(colon_lines) >= 2 and term_only:
            out.extend(_reflow_region(region, col_x, split))
            i = j
        else:
            out.append(lines[i])
            i += 1
    return out


def _densest(values: list[float], tolerance: float) -> tuple[int, float] | None:
    best: tuple[int, float] | None = None
    for k, v in enumerate(values):
        n = sum(1 for w in values[k:] if w - v <= 2 * tolerance)
        if best is None or n > best[0]:
            best = (n, v + tolerance)
    return best


def _reflow_region(region, col_x, split) -> list[list[GlyphChar]]:  # noqa: ANN001
    visible = lambda chars: any(not c.char.isspace() for c in chars)  # noqa: E731
    rows = [(line[0].y if line else 0.0, *split(line)) for line in region]
    # Line pitch from definition lines only: a term centred between two of them sits at half pitch.
    ys = [y for y, _t, d in rows if visible(d)]
    steps = [b - a for a, b in pairwise(ys) if b - a > _LINE_TOLERANCE]
    if not steps:
        return region
    pitch = min(steps)

    def has_colon(block: list[tuple[float, list[GlyphChar]]], chars: list[GlyphChar]) -> bool:
        return any(c.char == ":" for c in chars) and any(c.char == ":" for _y, cs in block for c in cs)

    def blocks(
        items: list[tuple[float, list[GlyphChar]]], one_colon: bool = False
    ) -> list[list[tuple[float, list[GlyphChar]]]]:
        grouped: list[list[tuple[float, list[GlyphChar]]]] = []
        for y, chars in items:
            if (
                grouped
                and y - grouped[-1][-1][0] <= pitch * _BLOCK_GAP_FACTOR
                and not (one_colon and has_colon(grouped[-1], chars))
            ):
                grouped[-1].append((y, chars))
            else:
                grouped.append([(y, chars)])
        return grouped

    def_blocks = blocks([(y, d) for y, _t, d in rows if visible(d)])
    term_blocks = blocks([(y, t) for y, t, _d in rows if visible(t)], one_colon=True)
    centre = lambda block: (block[0][0] + block[-1][0]) / 2  # noqa: E731

    assigned: dict[int, list[GlyphChar]] = {}
    orphans: list[tuple[float, list[GlyphChar]]] = []
    for term in term_blocks:
        tc = centre(term)
        candidates = [
            k for k, block in enumerate(def_blocks)
            if block[0][0] - pitch / 2 <= tc <= block[-1][0] + pitch / 2 and k not in assigned
        ]  # fmt: skip
        if not candidates:
            orphans.extend(term)
            continue
        k = min(candidates, key=lambda k: abs(centre(def_blocks[k]) - tc))
        assigned[k] = _join_term(term)

    out: list[tuple[float, list[GlyphChar]]] = list(orphans)
    for k, block in enumerate(def_blocks):
        first_y, first = block[0]
        if k in assigned:
            first = assigned[k] + [GlyphChar(" ", None, col_x, first_y)] + first
        out.append((first_y, first))
        out.extend(block[1:])
    return [chars for _y, chars in sorted(out, key=lambda item: item[0])]


def _join_term(term: list[tuple[float, list[GlyphChar]]]) -> list[GlyphChar]:
    """Concatenate a (possibly wrapped) term top to bottom and put its colon at the end."""
    words: list[GlyphChar] = []
    colon: list[GlyphChar] = []
    for _y, chars in term:
        part = [c for c in chars if c.char != ":"]
        colon += [c for c in chars if c.char == ":"]
        while part and part[-1].char.isspace():
            part.pop()
        while part and part[0].char.isspace():
            part.pop(0)
        if part:
            if words:
                words.append(GlyphChar(" ", None, part[0].x, part[0].y))
            words.extend(part)
    if colon:
        words += [GlyphChar(" ", None, colon[0].x, colon[0].y), colon[0]]
    return words


def _logical_order(line: list[GlyphChar]) -> list[GlyphChar]:
    # Font-decoded glyphs are often presentation forms (U+FB50..U+FEFF); fold them before counting.
    text = unicodedata.normalize("NFKC", "".join(c.char for c in line))
    arabic = len(ARABIC_LETTER.findall(text))
    # A line without Arabic letters (e.g. a date "9/ 5/ 2001") is laid out left-to-right.
    rtl = arabic > 0 and arabic >= len(LATIN_LETTER.findall(text))
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
