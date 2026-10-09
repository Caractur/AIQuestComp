"""Structure-aware chunking of a parsed regulatory document.

Rules (see docs/architecture.md for the trade-offs):

* One chunk per article (or treaty paragraph) when it fits ``max_tokens``.
* Longer articles are split at clause boundaries; the article's lead-in stays in the first part and
  is repeated in ``context_header`` of the following parts so each part is understandable alone.
* Definition articles are split per defined term, so a single definition can be attached to
  evidence that uses the term.
* Amendment annotations ("هكذا اصبحت ...") become separate ``amendment_history`` chunks: they quote
  superseded wording and must never be mistaken for the text in force.
* Tables are rendered as Markdown with the header row repeated in every part.
* Text without recognizable structure falls back to overlapping windows.

Chunk ids are stable for a given source file: ``{document_id}@{sha12}#{key}``, where the key is
derived from the legal structure (``art-12``, ``art-12.p2``, ``art-2.def-5``, ``art-3.hist``).
Article numbers are never invented: inferred numbers keep ``number_source = "inferred"`` and a caveat.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter

from import_compliance_rag.config.settings import ChunkingSettings
from import_compliance_rag.ingestion.extract import ExtractedTable
from import_compliance_rag.ingestion.structure import (
    Line,
    NumberSource,
    ParsedStructure,
    Segment,
    find_cross_references,
    split_clauses,
)
from import_compliance_rag.schemas.regulatory import ChunkRecord, ChunkType, CrossReference, Language
from import_compliance_rag.text.arabic import normalize_digits
from import_compliance_rag.text.language import detect_language

LEAD_IN_HEADER_TOKENS = 60
MAX_TERM_WORDS = 6
_DEFINITION_LINE = re.compile(r"^\s*([^:]{1,80}?)\s*:\s*(.*)$")

INFERRED_NUMBER_CAVEAT = (
    "The article number was inferred from document order because the heading number was unreadable; "
    "verify it against the source document before citing."
)
HISTORY_CAVEAT = (
    "Amendment annotation from the consolidated text. Wording quoted here may be superseded and is "
    "not necessarily in force."
)


def count_tokens(text: str) -> int:
    """Approximate token count (whitespace-separated words)."""
    return len(text.split())


def build_chunks(
    *,
    document_id: str,
    sha256: str,
    title: str,
    language: Language,
    structure: ParsedStructure,
    tables: list[ExtractedTable],
    settings: ChunkingSettings,
) -> tuple[list[ChunkRecord], list[str]]:
    builder = _Builder(document_id, sha256[:12], title, language, settings)
    for segment in structure.segments:
        builder.add_segment(segment)
    for index, table in enumerate(tables, start=1):
        builder.add_table(index, table)
    return builder.chunks, builder.warnings


class _Builder:
    def __init__(
        self, document_id: str, sha12: str, title: str, language: Language, settings: ChunkingSettings
    ) -> None:
        self.document_id = document_id
        self.prefix = f"{document_id}@{sha12}#"
        self.title = title
        self.arabic = language is not Language.EN
        self.language = language
        self.settings = settings
        self.chunks: list[ChunkRecord] = []
        self.warnings: list[str] = []
        self._keys: Counter[str] = Counter()
        self._text_windows = 0

    # -- segments -------------------------------------------------------------------------------

    def add_segment(self, segment: Segment) -> None:
        if segment.kind == "text":
            self._add_windows(segment.lines, "text", ChunkType.TEXT, self.title)
            return
        if segment.kind == "preamble":
            if segment.lines:
                label = "الديباجة" if self.arabic else "Preamble"
                self._add_split(segment, "preamble", ChunkType.PREAMBLE, f"{self.title} | {label}")
            return

        base = f"{'art' if segment.kind == 'article' else 'para'}-{_slug(segment.number or '0')}"
        header = self._article_header(segment)
        if segment.lines:
            if not (segment.is_definitions and self._add_definitions(segment, base, header)):
                self._add_split(segment, base, ChunkType.ARTICLE, header)
        elif segment.raw_heading:
            self.warnings.append(f"{base}: heading without body text (page {segment.page_start})")
        if segment.history:
            label = "تعديلات (نص تاريخي)" if self.arabic else "Amendment history"
            self._emit_lines(
                segment, f"{base}.hist", ChunkType.AMENDMENT_HISTORY, f"{header} | {label}",
                segment.history, parent=base, extra_caveats=[HISTORY_CAVEAT],
            )  # fmt: skip

    def _article_header(self, segment: Segment) -> str:
        if segment.kind == "article":
            label = f"المادة {segment.number}" if self.arabic else f"Article {segment.number}"
        else:
            label = f"الفقرة {segment.number}" if self.arabic else f"Paragraph {segment.number}"
        parts = [self.title, *segment.section_path, label]
        if segment.title:
            parts.append(segment.title)
        return " | ".join(parts)

    def _add_split(self, segment: Segment, base: str, chunk_type: ChunkType, header: str) -> None:
        """One chunk if the body fits, otherwise parts cut at clause boundaries."""
        lines = segment.lines
        if count_tokens(_join(lines)) <= self.settings.max_tokens:
            self._emit_lines(segment, base, chunk_type, header, lines)
            return
        lead, clauses = split_clauses(lines)
        units = ([lead] if lead else []) + clauses
        packed = self._pack(units)
        lead_text = _truncate(_join(lead), LEAD_IN_HEADER_TOKENS) if lead else ""
        part_type = ChunkType.ARTICLE_PART if chunk_type is ChunkType.ARTICLE else chunk_type
        for k, part in enumerate(packed, start=1):
            part_header = header if k == 1 or not lead_text else f"{header}\n{lead_text}"
            self._emit_lines(
                segment, f"{base}.p{k}", part_type, part_header, part,
                parent=base, part=(k - 1, len(packed)),
            )  # fmt: skip

    def _pack(self, units: list[list[Line]]) -> list[list[Line]]:
        """Greedily pack clause units into parts of at most ``max_tokens``; split oversized units."""
        limit = self.settings.max_tokens
        parts: list[list[Line]] = []
        current: list[Line] = []
        for unit in units:
            size = count_tokens(_join(unit))
            if size > limit:
                if current:
                    parts.append(current)
                    current = []
                parts.extend(self._windows(unit))
                continue
            if current and count_tokens(_join(current)) + size > limit:
                parts.append(current)
                current = []
            current = current + unit
        if current:
            parts.append(current)
        return parts

    def _windows(self, lines: list[Line]) -> list[list[Line]]:
        """Overlapping word windows for text that has no usable boundaries."""
        limit = self.settings.max_tokens
        step = max(1, limit - self.settings.fallback_overlap_tokens)
        words = [(w, line.page) for line in lines for w in line.text.split()]
        windows: list[list[Line]] = []
        for start in range(0, len(words), step):
            window: list[Line] = []
            for word, page in words[start : start + limit]:
                if window and window[-1].page == page:
                    window[-1] = Line(f"{window[-1].text} {word}", page)
                else:
                    window.append(Line(word, page))
            windows.append(window)
            if start + limit >= len(words):
                break
        return windows

    def _add_windows(self, lines: list[Line], base: str, chunk_type: ChunkType, header: str) -> None:
        segment = Segment(kind="text", lines=lines)
        for window in self._windows(lines) if count_tokens(_join(lines)) > self.settings.max_tokens else [lines]:
            self._text_windows += 1
            self._emit_lines(segment, f"{base}-{self._text_windows}", chunk_type, header, window)

    def _add_definitions(self, segment: Segment, base: str, header: str) -> bool:
        """Split a definitions article per term. Returns False when no term list is recognized."""
        lead: list[Line] = []
        terms: list[tuple[str, list[Line]]] = []
        for line in segment.lines:
            if segment.title and not terms and line.text.strip().rstrip(" :") == segment.title:
                lead.append(line)
                continue
            match = _DEFINITION_LINE.match(line.text)
            # "term : definition" — a short term with text after the colon. Lead-in lines ending in
            # ':' ("... ما لم تدل القرينة على غير ذلك :") have nothing after it.
            term = match.group(1).strip() if match and match.group(2).strip() else ""
            if term and len(term.split()) <= MAX_TERM_WORDS:
                terms.append((term, [line]))
            elif terms:
                terms[-1][1].append(line)
            else:
                lead.append(line)
        if len(terms) < 2:
            return False
        lead_text = _join(lead)
        term_header = header if not lead_text else f"{header}\n{_truncate(lead_text, LEAD_IN_HEADER_TOKENS)}"
        for k, (term, lines) in enumerate(terms, start=1):
            # The lead-in text is kept once, in the first term's text; later terms carry it in the header.
            body, part_header = (lead + lines, header) if k == 1 else (lines, term_header)
            self._emit_lines(
                segment, f"{base}.def-{k}", ChunkType.DEFINITIONS, part_header, body,
                parent=base, part=(k - 1, len(terms)), term=term,
            )  # fmt: skip
        return True

    # -- tables ---------------------------------------------------------------------------------

    def add_table(self, index: int, table: ExtractedTable) -> None:
        header, *rows = table.rows
        width = max(len(r) for r in table.rows)
        header = header + [""] * (width - len(header))
        size = self.settings.table_max_rows
        groups = [rows[i : i + size] for i in range(0, len(rows), size)] or [[]]
        label = "جدول" if self.arabic else "Table"
        for k, group in enumerate(groups, start=1):
            text = _markdown_table(header, group, width)
            key = f"table-{index}" if len(groups) == 1 else f"table-{index}.p{k}"
            segment = Segment(kind="text", lines=[Line(text, table.page_number)])
            self._emit_lines(
                segment, key, ChunkType.TABLE, f"{self.title} | {label} {index}", segment.lines,
                parent=f"table-{index}" if len(groups) > 1 else None, part=(k - 1, len(groups)),
            )  # fmt: skip

    # -- emission -------------------------------------------------------------------------------

    def _emit_lines(
        self,
        segment: Segment,
        key: str,
        chunk_type: ChunkType,
        header: str,
        lines: list[Line],
        *,
        parent: str | None = None,
        part: tuple[int, int] = (0, 1),
        term: str | None = None,
        extra_caveats: list[str] | None = None,
    ) -> None:
        text = _join(lines)
        if not text.strip():
            return
        self._keys[key] += 1
        if self._keys[key] > 1:
            self.warnings.append(f"duplicate chunk key {key}; disambiguated as {key}~{self._keys[key]}")
            key = f"{key}~{self._keys[key]}"
        caveats = list(extra_caveats or [])
        if segment.number_source is NumberSource.INFERRED:
            caveats.append(INFERRED_NUMBER_CAVEAT)
        language = detect_language(text)
        self.chunks.append(
            ChunkRecord(
                id=self.prefix + key,
                document_id=self.document_id,
                chunk_type=chunk_type,
                article_number=normalize_digits(segment.number) if segment.number else None,
                number_source=segment.number_source.value if segment.number_source else None,
                section_path=segment.section_path,
                heading=segment.title,
                definition_term=term,
                page_start=lines[0].page,
                page_end=lines[-1].page,
                language=self.language if language is Language.UNKNOWN else language,
                text_original=text,
                context_header=header,
                part_index=part[0],
                part_count=part[1],
                parent_key=parent,
                cross_references=[
                    CrossReference(raw=raw, article_number=number, external=not internal)
                    for raw, number, internal in find_cross_references(text)
                ],
                caveats=caveats,
                content_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                token_count=count_tokens(text),
            )
        )


def _join(lines: list[Line]) -> str:
    return "\n".join(line.text for line in lines)


def _truncate(text: str, tokens: int) -> str:
    words = text.split()
    return text if len(words) <= tokens else " ".join(words[:tokens]) + " …"


def _slug(number: str) -> str:
    value = normalize_digits(number).replace("مكرر", "bis").strip()
    return re.sub(r"[^a-z0-9.]+", "-", value.lower()).strip("-") or "x"


def _markdown_table(header: list[str], rows: list[list[str]], width: int) -> str:
    def row(cells: list[str]) -> str:
        cells = [c.replace("|", "\\|").replace("\n", " ") for c in cells] + [""] * (width - len(cells))
        return "| " + " | ".join(cells) + " |"

    return "\n".join([row(header), "| " + " | ".join(["---"] * width) + " |", *(row(r) for r in rows)])
