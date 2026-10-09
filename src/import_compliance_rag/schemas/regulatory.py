"""Schemas for the shared regulatory knowledge base: sources, versions, chunks, citations, evidence.

These models are the contract between ingestion, retrieval and (later) generation. Identifiers are
stable and language-independent; original text is always kept alongside any derived representation.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints

StableId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9\-]{2,120}$")]


class Language(StrEnum):
    AR = "ar"
    EN = "en"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class DocumentType(StrEnum):
    LAW = "law"  # قانون
    BYLAW = "bylaw"  # نظام (regulation issued under a law)
    INSTRUCTIONS = "instructions"  # تعليمات
    TECHNICAL_REGULATION = "technical_regulation"  # قاعدة فنية
    STANDARD = "standard"  # مواصفة
    DECISION = "decision"  # قرار
    CIRCULAR = "circular"  # تعميم
    AGREEMENT = "agreement"  # treaty / trade agreement
    PROCEDURE_GUIDE = "procedure_guide"
    GUIDANCE = "guidance"
    TARIFF = "tariff"
    OTHER = "other"


class BindingNature(StrEnum):
    """Whether a source is a legal instrument or explanatory material."""

    BINDING = "binding"
    GUIDANCE = "guidance"
    SECONDARY = "secondary"  # third-party summaries, reports
    UNKNOWN = "unknown"


class LegalStatus(StrEnum):
    """Legal currency of a document. 'unknown' until a human verifies it against official records."""

    CURRENT = "current"
    SUPERSEDED = "superseded"
    UNKNOWN = "unknown"


class TranslationProvenance(StrEnum):
    ORIGINAL = "original"
    OFFICIAL_TRANSLATION = "official_translation"
    VERIFIED_HUMAN_TRANSLATION = "verified_human_translation"
    MACHINE_TRANSLATION = "machine_translation"
    UNVERIFIED_TRANSLATION = "unverified_translation"


class ExtractionMethod(StrEnum):
    TEXT_LAYER = "text_layer"
    FONT_RECOVERY = "font_recovery"  # glyphs decoded via the embedded font, verified against OCR
    OCR = "ocr"
    MIXED = "mixed"
    PLAIN_TEXT = "plain_text"


class ExtractionStatus(StrEnum):
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"  # some pages degraded or unverified; see the extraction report
    FAILED = "failed"


class ExtractionPolicy(StrEnum):
    """Per-document override for how text is obtained."""

    AUTO = "auto"  # use the text layer when it passes quality checks, otherwise OCR
    TEXT_LAYER = "text_layer"
    OCR = "ocr"


class ChunkType(StrEnum):
    PREAMBLE = "preamble"
    ARTICLE = "article"
    ARTICLE_PART = "article_part"
    DEFINITIONS = "definitions"
    TABLE = "table"
    TEXT = "text"  # unstructured fallback


class SourceRegistryEntry(BaseModel):
    """A human-curated registry record. Lives in data/sources/registry.yaml and is synced to the DB."""

    model_config = ConfigDict(extra="forbid")

    id: StableId
    title_original: str
    title_en: str | None = Field(
        None, description="Descriptive English title for navigation; not an official translation."
    )
    issuing_authority: str
    jurisdiction: str = "JO"
    original_language: Language
    translation_provenance: TranslationProvenance = TranslationProvenance.ORIGINAL
    official_url: HttpUrl | None = None
    discovered_via: str | None = None
    document_type: DocumentType
    binding_nature: BindingNature = BindingNature.UNKNOWN
    legal_status: LegalStatus = LegalStatus.UNKNOWN
    status_note: str | None = None
    publication_date: date | None = None
    effective_date: date | None = None
    gazette_reference: str | None = None
    amendment_info: str | None = None
    usage_restrictions: str | None = None
    provenance_note: str | None = None
    product_categories: list[str] = Field(default_factory=list)
    extraction_policy: ExtractionPolicy = ExtractionPolicy.AUTO
    local_file: str = Field(description="Path relative to the raw sources directory.")
    retrieved_at: datetime | None = None


class PageExtraction(BaseModel):
    page_number: int  # 1-based
    method: ExtractionMethod
    text_layer_quality: float | None = None
    ocr_confidence: float | None = None
    ocr_strategy: str | None = Field(None, description="'full_page' or 'line_bands'")
    line_coverage: float | None = Field(
        None, description="OCR lines / visual lines in the PDF; below ~0.9 suggests dropped text."
    )
    verification_agreement: float | None = Field(
        None, description="Similarity between font-recovered text and independent OCR (0..1)."
    )
    needs_review: bool = False
    char_count: int
    warnings: list[str] = Field(default_factory=list)


class ExtractionReport(BaseModel):
    method: ExtractionMethod
    status: ExtractionStatus
    page_count: int
    pages: list[PageExtraction]
    detected_language: Language
    tables_found: int = 0
    glyph_corrections: dict[str, dict[str, int]] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class CrossReference(BaseModel):
    raw: str
    article_number: str | None = None
    external: bool = False  # refers to another instrument


class ChunkRecord(BaseModel):
    """A retrievable unit of a specific document version."""

    id: str
    document_id: str
    version_id: int | None = None
    chunk_type: ChunkType
    article_number: str | None = None
    section_path: list[str] = Field(default_factory=list)
    heading: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    language: Language
    text_original: str
    context_header: str = ""
    part_index: int = 0
    part_count: int = 1
    parent_key: str | None = None
    cross_references: list[CrossReference] = Field(default_factory=list)
    content_sha256: str
    token_count: int


class Citation(BaseModel):
    """Everything needed to point a reader back at the authoritative source. Never generated by an LLM."""

    chunk_id: str
    document_id: str
    document_title: str
    issuing_authority: str
    document_type: DocumentType
    binding_nature: BindingNature
    legal_status: LegalStatus
    version_id: int
    version_label: str
    content_sha256: str
    article_number: str | None = None
    section_path: list[str] = Field(default_factory=list)
    page_start: int | None = None
    page_end: int | None = None
    source_url: str | None = None
    retrieved_at: datetime | None = None
    extraction_method: ExtractionMethod
    language: Language
    translation_provenance: TranslationProvenance


class RetrievalSignal(BaseModel):
    dense_rank: int | None = None
    dense_score: float | None = None
    lexical_rank: int | None = None
    lexical_score: float | None = None
    fused_score: float
    rerank_score: float | None = None
    matched_queries: list[str] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    chunk_id: str
    text_original: str
    chunk_type: ChunkType
    citation: Citation
    signal: RetrievalSignal | None = None
    relation: str = Field(
        "retrieved",
        description="'retrieved' for search hits; 'definition', 'sibling_part' or 'cross_reference' "
        "for context added by expansion.",
    )
    related_to: str | None = None
    caveats: list[str] = Field(default_factory=list)


class EvidencePackage(BaseModel):
    query: str
    query_language: Language
    query_variants: list[str]
    filters: dict
    items: list[EvidenceItem]
    embedding_model: str | None
    reranker_model: str | None
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime
