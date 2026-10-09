"""Compute and store chunk embeddings for one model (idempotent)."""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from import_compliance_rag.retrieval.embedder import Embedder
from import_compliance_rag.storage.models import Chunk, ChunkEmbedding, DocumentVersion

log = logging.getLogger(__name__)


def embedding_input(chunk: Chunk) -> str:
    """Exactly what is embedded for a chunk: its context header followed by the original text."""
    return f"{chunk.context_header}\n{chunk.text_original}" if chunk.context_header else chunk.text_original


def embed_chunks(session: Session, embedder: Embedder, batch_size: int = 32) -> dict[str, int]:
    """Embed chunks of active versions that have no (or a stale) embedding for ``embedder``."""
    rows = session.execute(
        select(Chunk, ChunkEmbedding)
        .join(DocumentVersion, DocumentVersion.id == Chunk.version_id)
        .outerjoin(
            ChunkEmbedding,
            (ChunkEmbedding.chunk_id == Chunk.id) & (ChunkEmbedding.model == embedder.name),
        )
        .where(DocumentVersion.is_active)
        .order_by(Chunk.id)
    ).all()
    pending: list[tuple[Chunk, ChunkEmbedding | None, str, str]] = []
    for chunk, existing in rows:
        text = embedding_input(chunk)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if existing is None or existing.text_sha256 != digest or existing.dimension != embedder.dimension:
            pending.append((chunk, existing, text, digest))

    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        vectors = embedder.embed_documents([text for _c, _e, text, _d in batch])
        for (chunk, existing, _text, digest), vector in zip(batch, vectors, strict=True):
            if existing is None:
                session.add(
                    ChunkEmbedding(
                        chunk_id=chunk.id,
                        model=embedder.name,
                        dimension=len(vector),
                        embedding=vector,
                        text_sha256=digest,
                    )
                )
            else:
                existing.embedding, existing.dimension, existing.text_sha256 = vector, len(vector), digest
        session.flush()
        log.info("embed.batch", extra={"model": embedder.name, "done": start + len(batch), "total": len(pending)})
    return {"embedded": len(pending), "up_to_date": len(rows) - len(pending)}
