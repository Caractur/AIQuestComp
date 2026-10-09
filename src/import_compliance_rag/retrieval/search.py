"""Bilingual hybrid retrieval producing citation-ready evidence packages.

Pipeline: metadata filters → dense (pgvector, cosine) and lexical (BM25) candidate lists → reciprocal
rank fusion → removal of exact duplicate texts → optional cross-encoder rerank → context expansion
(sibling parts of split articles, definitions of terms used, internally cross-referenced articles)
→ ``EvidencePackage`` with citations and caveats.

Nothing here generates text. Citations are assembled from stored metadata only, and every item
carries the caveats a reader needs (unverified legal status, recovered or OCR'd text, inferred
article numbers, historical amendment text).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from import_compliance_rag.config.settings import RetrievalSettings
from import_compliance_rag.retrieval.embedder import Embedder
from import_compliance_rag.retrieval.fusion import fuse_ranks
from import_compliance_rag.retrieval.indexing import embedding_input
from import_compliance_rag.retrieval.lexical import BM25Index, tokenize
from import_compliance_rag.retrieval.references import parse_article_reference, resolve_instrument
from import_compliance_rag.schemas.regulatory import (
    BindingNature,
    ChunkType,
    Citation,
    DocumentType,
    EvidenceItem,
    EvidencePackage,
    ExtractionMethod,
    Language,
    LegalStatus,
    RetrievalSignal,
    TranslationProvenance,
)
from import_compliance_rag.storage.models import Chunk, ChunkEmbedding, DocumentVersion, SourceDocument
from import_compliance_rag.text.arabic import normalize_for_retrieval
from import_compliance_rag.text.language import detect_language

log = logging.getLogger(__name__)

SearchMode = Literal["hybrid", "dense", "lexical"]

MAX_DEFINITIONS_PER_ITEM = 2
MAX_DEFINITIONS_TOTAL = 6
MAX_CROSS_REFERENCES_PER_ITEM = 2
RERANK_POOL_FACTOR = 3

CAVEAT_STATUS_UNKNOWN = (
    "Legal status not verified: whether this text is current, and complete with all amendments, has "
    "not been confirmed against the Official Gazette or the issuing authority."
)
CAVEAT_SUPERSEDED = "This document is recorded as superseded."
CAVEAT_FONT_RECOVERY = (
    "Text was recovered from the embedded fonts of a PDF whose text layer is corrupted, and verified "
    "against OCR. Confirm the exact wording against the source PDF before quoting it."
)
CAVEAT_OCR = "Text was produced by OCR. Confirm the exact wording against the source PDF before quoting it."
CAVEAT_MIXED = (
    "Text on these pages comes from different extraction methods (text layer, font recovery or OCR). "
    "Confirm the exact wording against the source PDF before quoting it."
)
CAVEAT_TRANSLATION ="This text is a translation that has not been verified as official."


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_ids: list[str] = Field(default_factory=list)
    document_types: list[DocumentType] = Field(default_factory=list)
    binding_natures: list[BindingNature] = Field(default_factory=list)
    legal_statuses: list[LegalStatus] = Field(default_factory=list)
    languages: list[Language] = Field(default_factory=list, description="Chunk language")
    product_categories: list[str] = Field(default_factory=list, description="Match any")
    include_history: bool = Field(False, description="Also return amendment-history chunks")


@dataclass
class _Row:
    chunk: Chunk
    version: DocumentVersion
    document: SourceDocument


@dataclass
class _Candidate:
    chunk_id: str
    signal: RetrievalSignal
    relation: str = "retrieved"
    related_to: str | None = None


@dataclass
class _LexicalCache:
    fingerprint: tuple = ()
    index: BM25Index | None = None
    definitions: dict[int, list[tuple[str, str]]] = field(default_factory=dict)


class Reranker:
    """Cross-encoder reranking (e.g. ``BAAI/bge-reranker-v2-m3``), loaded only when configured."""

    def __init__(self, model_name: str, device: str = "cpu", max_length: int = 1024) -> None:
        from sentence_transformers import CrossEncoder

        self.name = model_name
        self._model = CrossEncoder(model_name, device=device, max_length=max_length)

    def score(self, query: str, texts: list[str]) -> list[float]:
        return [float(s) for s in self._model.predict([(query, t) for t in texts], show_progress_bar=False)]


class HybridRetriever:
    def __init__(
        self,
        settings: RetrievalSettings,
        embedder: Embedder | None = None,
        reranker: Reranker | None = None,
    ) -> None:
        self.settings = settings
        self.embedder = embedder
        self.reranker = reranker
        self._cache = _LexicalCache()

    # -- public API -----------------------------------------------------------------------------

    def search(
        self,
        session: Session,
        query: str,
        filters: SearchFilters | None = None,
        top_k: int | None = None,
        mode: SearchMode | None = None,
        expand: bool | None = None,
    ) -> EvidencePackage:
        filters = filters or SearchFilters()
        mode = mode or self.settings.default_mode
        top_k = top_k or self.settings.final_top_k
        expand = self.settings.expand_related if expand is None else expand
        warnings: list[str] = []
        query = query.strip()

        allowed = set(session.scalars(self._filtered(select(Chunk.id), filters)))
        dense: list[tuple[str, float]] = []
        lexical: list[tuple[str, float]] = []
        if mode in ("hybrid", "dense"):
            if self.embedder is None:
                warnings.append("dense retrieval skipped: no embedding model configured")
            else:
                dense = self._dense(session, query, filters)
                if not dense and allowed:
                    warnings.append(
                        f"dense retrieval returned nothing: no embeddings for model {self.embedder.name} "
                        "(run the embed command)"
                    )
        if mode in ("hybrid", "lexical") or (mode == "dense" and not dense and allowed):
            if mode == "dense":
                warnings.append("dense retrieval unavailable; fell back to lexical retrieval")
            lexical = self._lexical(session, query, allowed)

        dense_rank = {cid: (r, s) for r, (cid, s) in enumerate(dense, start=1)}
        lexical_rank = {cid: (r, s) for r, (cid, s) in enumerate(lexical, start=1)}
        rows = self._load(session, list(dense_rank.keys() | lexical_rank.keys()))
        # BM25 is monolingual: a chunk in another language than the query can never match lexically.
        # Plain RRF would count that as a miss and bury every cross-language hit (measured: Arabic
        # queries never surfaced the English treaty text). For such chunks the dense rank stands in
        # for the unavailable lexical rank; same-language chunks keep their real lexical evidence.
        query_language = detect_language(query)
        imputed: set[str] = set()
        lexical_ranks = {cid: r for cid, (r, _s) in lexical_rank.items()}
        if mode == "hybrid" and query_language in (Language.AR, Language.EN):
            for cid, (r, _s) in dense_rank.items():
                language = rows[cid].chunk.language
                if language != query_language.value and language != Language.MIXED.value:
                    lexical_ranks.setdefault(cid, r)
                    imputed.add(cid)
        fused = fuse_ranks(
            [{cid: r for cid, (r, _s) in dense_rank.items()}, lexical_ranks],
            k=self.settings.rrf_k,
            weights=[1.0, self.settings.lexical_weight],
        )

        candidates: list[_Candidate] = []
        seen_texts: set[str] = set()
        for cid, score in fused:
            row = rows[cid]
            if row.chunk.content_sha256 in seen_texts:  # exact duplicate text only
                continue
            seen_texts.add(row.chunk.content_sha256)
            d, lx = dense_rank.get(cid), lexical_rank.get(cid)
            signal = RetrievalSignal(
                dense_rank=d[0] if d else None,
                dense_score=round(d[1], 6) if d else None,
                lexical_rank=lx[0] if lx else None,
                lexical_score=lx[1] if lx else None,
                lexical_rank_imputed=cid in imputed,
                fused_score=round(score, 6),
                matched_queries=[query],
            )
            candidates.append(_Candidate(cid, signal))

        if self.reranker is not None and candidates:
            pool = candidates[: top_k * RERANK_POOL_FACTOR]
            scores = self.reranker.score(query, [embedding_input(rows[c.chunk_id].chunk) for c in pool])
            for candidate, s in zip(pool, scores, strict=True):
                candidate.signal.rerank_score = round(s, 6)
            candidates = sorted(pool, key=lambda c: -(c.signal.rerank_score or 0.0))
        if self.settings.resolve_article_references:
            referenced = self._referenced_chunks(session, query, filters)
            if referenced:
                rows.update(self._load(session, [cid for cid in referenced if cid not in rows]))
                previous = {c.chunk_id: c for c in candidates}
                top = []
                for cid in referenced:
                    candidate = previous.pop(cid, None) or _Candidate(cid, RetrievalSignal(fused_score=0.0))
                    candidate.signal.exact_reference = True
                    top.append(candidate)
                candidates = top + [c for c in candidates if c.chunk_id in previous]
        candidates = candidates[:top_k]

        if expand and candidates:
            candidates += self._expand(session, candidates, rows, filters)
            rows.update(self._load(session, [c.chunk_id for c in candidates if c.chunk_id not in rows]))

        items = [self._item(rows[c.chunk_id], c) for c in candidates]
        if not items:
            warnings.append("no evidence found for this query and these filters")
        return EvidencePackage(
            query=query,
            query_language=query_language,
            query_variants=[query],
            filters=filters.model_dump(mode="json"),
            items=items,
            embedding_model=self.embedder.name if self.embedder and mode != "lexical" else None,
            reranker_model=self.reranker.name if self.reranker else None,
            warnings=warnings,
            created_at=datetime.now(UTC),
        )

    # -- candidate generation -------------------------------------------------------------------

    @staticmethod
    def _filtered(statement, filters: SearchFilters):  # noqa: ANN001, ANN205
        statement = (
            statement.join(DocumentVersion, DocumentVersion.id == Chunk.version_id)
            .join(SourceDocument, SourceDocument.id == Chunk.document_id)
            .where(DocumentVersion.is_active)
        )
        conditions = []
        if not filters.include_history:
            conditions.append(Chunk.chunk_type != ChunkType.AMENDMENT_HISTORY.value)
        if filters.document_ids:
            conditions.append(Chunk.document_id.in_(filters.document_ids))
        if filters.document_types:
            conditions.append(SourceDocument.document_type.in_([t.value for t in filters.document_types]))
        if filters.binding_natures:
            conditions.append(SourceDocument.binding_nature.in_([b.value for b in filters.binding_natures]))
        if filters.legal_statuses:
            conditions.append(SourceDocument.legal_status.in_([s.value for s in filters.legal_statuses]))
        if filters.languages:
            conditions.append(Chunk.language.in_([lang.value for lang in filters.languages]))
        if filters.product_categories:
            conditions.append(SourceDocument.product_categories.overlap(filters.product_categories))
        return statement.where(and_(*conditions)) if conditions else statement

    def _dense(self, session: Session, query: str, filters: SearchFilters) -> list[tuple[str, float]]:
        assert self.embedder is not None
        vector = self.embedder.embed_query(query)
        distance = ChunkEmbedding.embedding.cosine_distance(vector)
        statement = self._filtered(
            select(Chunk.id, distance.label("distance")).join(
                ChunkEmbedding,
                (ChunkEmbedding.chunk_id == Chunk.id)
                & (ChunkEmbedding.model == self.embedder.name)
                & (ChunkEmbedding.dimension == len(vector)),
            ),
            filters,
        )
        rows = session.execute(statement.order_by(distance, Chunk.id).limit(self.settings.dense_top_k)).all()
        return [(cid, 1.0 - float(dist)) for cid, dist in rows]

    def _referenced_chunks(self, session: Session, query: str, filters: SearchFilters) -> list[str]:
        """Chunks of an article the query names explicitly together with its instrument."""
        reference = parse_article_reference(query)
        if reference is None:
            return []
        statement = select(SourceDocument.id, SourceDocument.title_original, SourceDocument.title_en)
        if filters.document_ids:
            statement = statement.where(SourceDocument.id.in_(filters.document_ids))
        titles = {doc_id: f"{title} {title_en or ''}" for doc_id, title, title_en in session.execute(statement)}
        document_id = resolve_instrument(reference.remainder, titles)
        if document_id is None:
            return []
        return list(
            session.scalars(
                self._filtered(select(Chunk.id), filters)
                .where(Chunk.document_id == document_id, Chunk.article_number == reference.article_number)
                .order_by(Chunk.part_index, Chunk.id)
            )
        )

    def _lexical(self, session: Session, query: str, allowed: set[str]) -> list[tuple[str, float]]:
        index = self._lexical_index(session)
        hits = index.search(tokenize(query), self.settings.lexical_top_k, allowed)
        return [(h.doc_id, h.score) for h in hits]

    def _fingerprint(self, session: Session) -> tuple:
        return tuple(
            session.execute(
                select(DocumentVersion.id, DocumentVersion.processed_at, DocumentVersion.pipeline_version)
                .where(DocumentVersion.is_active)
                .order_by(DocumentVersion.id)
            ).all()
        )

    def _lexical_index(self, session: Session) -> BM25Index:
        fingerprint = self._fingerprint(session)
        if self._cache.index is None or self._cache.fingerprint != fingerprint:
            docs = session.execute(
                select(Chunk.id, Chunk.text_retrieval)
                .join(DocumentVersion, DocumentVersion.id == Chunk.version_id)
                .where(DocumentVersion.is_active)
            ).all()
            self._cache = _LexicalCache(
                fingerprint, BM25Index({cid: tokenize(text, normalized=True) for cid, text in docs})
            )
            log.info("lexical.index_built", extra={"chunks": len(docs)})
        return self._cache.index

    # -- expansion ------------------------------------------------------------------------------

    def _expand(
        self, session: Session, retrieved: list[_Candidate], rows: dict[str, _Row], filters: SearchFilters
    ) -> list[_Candidate]:
        included = {c.chunk_id for c in retrieved}
        added: list[_Candidate] = []

        def add(chunk_id: str, relation: str, related_to: str) -> None:
            if chunk_id not in included:
                included.add(chunk_id)
                added.append(_Candidate(chunk_id, RetrievalSignal(fused_score=0.0), relation, related_to))

        definitions_added = 0
        for candidate in retrieved:
            chunk = rows[candidate.chunk_id].chunk
            # Sibling parts of a split article or table, so the full provision is available.
            if chunk.parent_key and chunk.chunk_type in (ChunkType.ARTICLE_PART.value, ChunkType.TABLE.value):
                for sibling in session.scalars(
                    select(Chunk.id)
                    .where(Chunk.version_id == chunk.version_id, Chunk.parent_key == chunk.parent_key)
                    .order_by(Chunk.part_index)
                ):
                    add(sibling, "sibling_part", chunk.id)
            # Articles this chunk refers to within the same instrument.
            refs = [r["article_number"] for r in chunk.cross_references if not r["external"] and r["article_number"]]
            for number in list(dict.fromkeys(refs))[:MAX_CROSS_REFERENCES_PER_ITEM]:
                if number == chunk.article_number:
                    continue
                target = session.scalar(
                    select(Chunk.id)
                    .where(
                        Chunk.version_id == chunk.version_id,
                        Chunk.article_number == number,
                        Chunk.chunk_type != ChunkType.AMENDMENT_HISTORY.value,
                    )
                    .order_by(Chunk.part_index)
                    .limit(1)
                )
                if target:
                    add(target, "cross_reference", chunk.id)
            # Definitions of terms used in the chunk (longest, i.e. most specific, terms first).
            if chunk.chunk_type != ChunkType.DEFINITIONS.value and definitions_added < MAX_DEFINITIONS_TOTAL:
                text = normalize_for_retrieval(chunk.text_original)
                matches = [
                    (term, cid) for term, cid in self._definitions(session, chunk.version_id) if term in text
                ]
                for _term, cid in sorted(matches, key=lambda m: -len(m[0]))[:MAX_DEFINITIONS_PER_ITEM]:
                    if definitions_added >= MAX_DEFINITIONS_TOTAL:
                        break
                    before = len(added)
                    add(cid, "definition", chunk.id)
                    definitions_added += len(added) - before
        return added

    def _definitions(self, session: Session, version_id: int) -> list[tuple[str, str]]:
        if version_id not in self._cache.definitions:
            rows = session.execute(
                select(Chunk.definition_term, Chunk.id).where(
                    Chunk.version_id == version_id, Chunk.definition_term.is_not(None)
                )
            ).all()
            self._cache.definitions[version_id] = [
                (normalize_for_retrieval(term), cid) for term, cid in rows if term and term.strip()
            ]
        return self._cache.definitions[version_id]

    # -- assembly -------------------------------------------------------------------------------

    @staticmethod
    def _load(session: Session, chunk_ids: list[str]) -> dict[str, _Row]:
        if not chunk_ids:
            return {}
        result = session.execute(
            select(Chunk, DocumentVersion, SourceDocument)
            .join(DocumentVersion, DocumentVersion.id == Chunk.version_id)
            .join(SourceDocument, SourceDocument.id == Chunk.document_id)
            .where(Chunk.id.in_(chunk_ids))
        ).all()
        return {chunk.id: _Row(chunk, version, document) for chunk, version, document in result}

    def _item(self, row: _Row, candidate: _Candidate) -> EvidenceItem:
        chunk, version, document = row.chunk, row.version, row.document
        method, review_pages = _page_extraction(version, chunk.page_start, chunk.page_end)
        citation = Citation(
            chunk_id=chunk.id,
            document_id=document.id,
            document_title=document.title_original,
            issuing_authority=document.issuing_authority,
            document_type=DocumentType(document.document_type),
            binding_nature=BindingNature(document.binding_nature),
            legal_status=LegalStatus(document.legal_status),
            version_id=version.id,
            version_label=version.version_label,
            content_sha256=chunk.content_sha256,
            article_number=chunk.article_number,
            section_path=chunk.section_path,
            page_start=chunk.page_start,
            page_end=chunk.page_end,
            source_url=document.official_url,
            retrieved_at=document.retrieved_at,
            extraction_method=method,
            language=Language(chunk.language),
            translation_provenance=TranslationProvenance(document.translation_provenance),
        )
        return EvidenceItem(
            chunk_id=chunk.id,
            text_original=chunk.text_original,
            chunk_type=ChunkType(chunk.chunk_type),
            citation=citation,
            signal=candidate.signal if candidate.relation == "retrieved" else None,
            relation=candidate.relation,
            related_to=candidate.related_to,
            caveats=_caveats(chunk, document, method, review_pages),
        )


def _page_extraction(
    version: DocumentVersion, page_start: int | None, page_end: int | None
) -> tuple[ExtractionMethod, list[int]]:
    pages = version.extraction_report.get("pages", [])
    lo, hi = page_start or 1, page_end or page_start or 1
    selected = [p for p in pages if lo <= p["page_number"] <= hi]
    methods = {p["method"] for p in selected} or {version.extraction_method}
    method = ExtractionMethod(methods.pop()) if len(methods) == 1 else ExtractionMethod.MIXED
    return method, [p["page_number"] for p in selected if p.get("needs_review")]


def _caveats(chunk: Chunk, document: SourceDocument, method: ExtractionMethod, review_pages: list[int]) -> list[str]:
    caveats = list(chunk.caveats)
    if document.legal_status == LegalStatus.UNKNOWN.value:
        caveats.append(CAVEAT_STATUS_UNKNOWN)
    elif document.legal_status == LegalStatus.SUPERSEDED.value:
        caveats.append(CAVEAT_SUPERSEDED)
    if document.binding_nature != BindingNature.BINDING.value:
        caveats.append(f"Source binding nature is '{document.binding_nature}', not a binding legal instrument.")
    if method is ExtractionMethod.FONT_RECOVERY:
        caveats.append(CAVEAT_FONT_RECOVERY)
    elif method is ExtractionMethod.OCR:
        caveats.append(CAVEAT_OCR)
    elif method is ExtractionMethod.MIXED:
        caveats.append(CAVEAT_MIXED)
    if review_pages:
        caveats.append(f"Extraction of page(s) {', '.join(map(str, review_pages))} is flagged for human review.")
    if document.translation_provenance in (
        TranslationProvenance.MACHINE_TRANSLATION.value,
        TranslationProvenance.UNVERIFIED_TRANSLATION.value,
    ):
        caveats.append(CAVEAT_TRANSLATION)
    return caveats
