"""Relational model of the shared regulatory knowledge base.

* ``source_documents`` mirrors the curated registry (one row per instrument).
* ``document_versions`` holds one row per distinct source file (SHA-256). Re-processing the same file
  with a newer pipeline replaces its chunks in place; a new file creates a new version and the old
  one is kept (inactive) for history.
* ``chunks`` stores original text (shown and cited) next to the normalized retrieval text.
* ``chunk_embeddings`` uses an untyped ``vector`` column so several embedding models (of different
  dimensions) can be stored side by side and compared.

Tenant data (business profiles, uploaded documents) is deliberately absent: it never enters these
shared tables.
"""

from __future__ import annotations

from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SourceDocument(Base):
    __tablename__ = "source_documents"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    title_original: Mapped[str] = mapped_column(Text)
    title_en: Mapped[str | None] = mapped_column(Text)
    issuing_authority: Mapped[str] = mapped_column(Text)
    jurisdiction: Mapped[str] = mapped_column(String(16))
    original_language: Mapped[str] = mapped_column(String(16))
    translation_provenance: Mapped[str] = mapped_column(String(32))
    official_url: Mapped[str | None] = mapped_column(Text)
    discovered_via: Mapped[str | None] = mapped_column(Text)
    document_type: Mapped[str] = mapped_column(String(32), index=True)
    binding_nature: Mapped[str] = mapped_column(String(16))
    legal_status: Mapped[str] = mapped_column(String(16))
    status_note: Mapped[str | None] = mapped_column(Text)
    publication_date: Mapped[date | None] = mapped_column(Date)
    effective_date: Mapped[date | None] = mapped_column(Date)
    gazette_reference: Mapped[str | None] = mapped_column(Text)
    amendment_info: Mapped[str | None] = mapped_column(Text)
    usage_restrictions: Mapped[str | None] = mapped_column(Text)
    provenance_note: Mapped[str | None] = mapped_column(Text)
    product_categories: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    extraction_policy: Mapped[str] = mapped_column(String(16))
    local_file: Mapped[str] = mapped_column(Text)
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[list[DocumentVersion]] = relationship(back_populates="document")


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "sha256", name="uq_version_document_sha"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("source_documents.id", ondelete="CASCADE"), index=True)
    sha256: Mapped[str] = mapped_column(String(64))
    version_label: Mapped[str] = mapped_column(Text)
    pipeline_version: Mapped[str] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    file_size: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int] = mapped_column(Integer)
    extraction_method: Mapped[str] = mapped_column(String(16))
    extraction_status: Mapped[str] = mapped_column(String(16))
    extraction_report: Mapped[dict] = mapped_column(JSONB)
    structure_warnings: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped[SourceDocument] = relationship(back_populates="versions")
    chunks: Mapped[list[Chunk]] = relationship(back_populates="version", cascade="all, delete-orphan")


# At most one active version per document.
Index(
    "uq_version_active_per_document",
    DocumentVersion.document_id,
    unique=True,
    postgresql_where=DocumentVersion.is_active,
)


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (Index("ix_chunks_document_article", "document_id", "article_number"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(String(128), index=True)
    key: Mapped[str] = mapped_column(Text)
    chunk_type: Mapped[str] = mapped_column(String(32))
    article_number: Mapped[str | None] = mapped_column(String(32))
    number_source: Mapped[str | None] = mapped_column(String(16))
    section_path: Mapped[list[str]] = mapped_column(JSONB, default=list)
    heading: Mapped[str | None] = mapped_column(Text)
    definition_term: Mapped[str | None] = mapped_column(Text)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(16))
    text_original: Mapped[str] = mapped_column(Text)
    context_header: Mapped[str] = mapped_column(Text)
    text_retrieval: Mapped[str] = mapped_column(Text)
    part_index: Mapped[int] = mapped_column(Integer)
    part_count: Mapped[int] = mapped_column(Integer)
    parent_key: Mapped[str | None] = mapped_column(Text)
    cross_references: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    caveats: Mapped[list[str]] = mapped_column(JSONB, default=list)
    content_sha256: Mapped[str] = mapped_column(String(64))
    token_count: Mapped[int] = mapped_column(Integer)

    version: Mapped[DocumentVersion] = relationship(back_populates="chunks")
    embeddings: Mapped[list[ChunkEmbedding]] = relationship(
        back_populates="chunk", cascade="all, delete-orphan"
    )


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"

    chunk_id: Mapped[str] = mapped_column(ForeignKey("chunks.id", ondelete="CASCADE"), primary_key=True)
    model: Mapped[str] = mapped_column(String(128), primary_key=True, index=True)
    dimension: Mapped[int] = mapped_column(Integer)
    # Untyped on purpose (no fixed dimension); see the module docstring.
    embedding: Mapped[list[float]] = mapped_column(Vector())
    # Hash of the exact text that was embedded, so changed chunks are re-embedded.
    text_sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    chunk: Mapped[Chunk] = relationship(back_populates="embeddings")
