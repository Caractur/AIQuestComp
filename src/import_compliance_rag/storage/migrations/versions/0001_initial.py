"""Initial schema: sources, versions, chunks, embeddings.

Revision ID: 0001
Revises:
Create Date: 2026-10-09
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "source_documents",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("title_original", sa.Text, nullable=False),
        sa.Column("title_en", sa.Text),
        sa.Column("issuing_authority", sa.Text, nullable=False),
        sa.Column("jurisdiction", sa.String(16), nullable=False),
        sa.Column("original_language", sa.String(16), nullable=False),
        sa.Column("translation_provenance", sa.String(32), nullable=False),
        sa.Column("official_url", sa.Text),
        sa.Column("discovered_via", sa.Text),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("binding_nature", sa.String(16), nullable=False),
        sa.Column("legal_status", sa.String(16), nullable=False),
        sa.Column("status_note", sa.Text),
        sa.Column("publication_date", sa.Date),
        sa.Column("effective_date", sa.Date),
        sa.Column("gazette_reference", sa.Text),
        sa.Column("amendment_info", sa.Text),
        sa.Column("usage_restrictions", sa.Text),
        sa.Column("provenance_note", sa.Text),
        sa.Column("product_categories", ARRAY(sa.Text), nullable=False, server_default="{}"),
        sa.Column("extraction_policy", sa.String(16), nullable=False),
        sa.Column("local_file", sa.Text, nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_source_documents_document_type", "source_documents", ["document_type"])

    op.create_table(
        "document_versions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "document_id", sa.String(128),
            sa.ForeignKey("source_documents.id", ondelete="CASCADE"), nullable=False,
        ),  # fmt: skip
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("version_label", sa.Text, nullable=False),
        sa.Column("pipeline_version", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("page_count", sa.Integer, nullable=False),
        sa.Column("extraction_method", sa.String(16), nullable=False),
        sa.Column("extraction_status", sa.String(16), nullable=False),
        sa.Column("extraction_report", JSONB, nullable=False),
        sa.Column("structure_warnings", JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "sha256", name="uq_version_document_sha"),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_index(
        "uq_version_active_per_document", "document_versions", ["document_id"],
        unique=True, postgresql_where=sa.text("is_active"),
    )  # fmt: skip

    op.create_table(
        "chunks",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "version_id", sa.Integer,
            sa.ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=False,
        ),  # fmt: skip
        sa.Column("document_id", sa.String(128), nullable=False),
        sa.Column("key", sa.Text, nullable=False),
        sa.Column("chunk_type", sa.String(32), nullable=False),
        sa.Column("article_number", sa.String(32)),
        sa.Column("number_source", sa.String(16)),
        sa.Column("section_path", JSONB, nullable=False, server_default="[]"),
        sa.Column("heading", sa.Text),
        sa.Column("definition_term", sa.Text),
        sa.Column("page_start", sa.Integer),
        sa.Column("page_end", sa.Integer),
        sa.Column("language", sa.String(16), nullable=False),
        sa.Column("text_original", sa.Text, nullable=False),
        sa.Column("context_header", sa.Text, nullable=False),
        sa.Column("text_retrieval", sa.Text, nullable=False),
        sa.Column("part_index", sa.Integer, nullable=False),
        sa.Column("part_count", sa.Integer, nullable=False),
        sa.Column("parent_key", sa.Text),
        sa.Column("cross_references", JSONB, nullable=False, server_default="[]"),
        sa.Column("caveats", JSONB, nullable=False, server_default="[]"),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("token_count", sa.Integer, nullable=False),
    )
    op.create_index("ix_chunks_version_id", "chunks", ["version_id"])
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"])
    op.create_index("ix_chunks_document_article", "chunks", ["document_id", "article_number"])

    op.create_table(
        "chunk_embeddings",
        sa.Column("chunk_id", sa.Text, sa.ForeignKey("chunks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("model", sa.String(128), primary_key=True),
        sa.Column("dimension", sa.Integer, nullable=False),
        sa.Column("embedding", Vector(), nullable=False),
        sa.Column("text_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chunk_embeddings_model", "chunk_embeddings", ["model"])


def downgrade() -> None:
    op.drop_table("chunk_embeddings")
    op.drop_table("chunks")
    op.drop_table("document_versions")
    op.drop_table("source_documents")
