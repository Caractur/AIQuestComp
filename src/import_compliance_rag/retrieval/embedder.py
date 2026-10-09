"""Embedding models behind a small interface.

* ``SentenceTransformerEmbedder`` runs local open models (default ``BAAI/bge-m3``; also
  ``intfloat/multilingual-e5-large`` for comparison). Nothing is sent to external services.
* ``HashingEmbedder`` is deterministic and dependency-free; it exists for tests and offline smoke
  runs and has no semantic (cross-lingual) ability. Never use it to judge retrieval quality.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

from import_compliance_rag.text.arabic import normalize_for_retrieval

# Models trained with instruction prefixes; bge-m3 needs none.
_PREFIXES: dict[str, tuple[str, str]] = {
    "intfloat/multilingual-e5-large": ("query: ", "passage: "),
    "intfloat/multilingual-e5-base": ("query: ", "passage: "),
    "intfloat/multilingual-e5-small": ("query: ", "passage: "),
}


class Embedder(Protocol):
    name: str
    dimension: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    def __init__(
        self, model_name: str, device: str = "cpu", batch_size: int = 8, max_seq_length: int = 2048
    ) -> None:
        from sentence_transformers import SentenceTransformer  # heavy import, only when used

        self.name = model_name
        self.batch_size = batch_size
        self._model = SentenceTransformer(model_name, device=device)
        self._model.max_seq_length = min(max_seq_length, self._model.max_seq_length or max_seq_length)
        dimension = getattr(self._model, "get_embedding_dimension", None) or (
            self._model.get_sentence_embedding_dimension  # sentence-transformers < 5.2
        )
        self.dimension = int(dimension())
        self._query_prefix, self._doc_prefix = _PREFIXES.get(model_name, ("", ""))

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = self._model.encode(
            [self._doc_prefix + t for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [v.tolist() for v in vectors]

    def embed_query(self, text: str) -> list[float]:
        vector = self._model.encode(
            [self._query_prefix + text], normalize_embeddings=True, show_progress_bar=False
        )[0]
        return vector.tolist()


class HashingEmbedder:
    """Character 3-gram feature hashing into a fixed-size, L2-normalized vector."""

    def __init__(self, dimension: int = 256) -> None:
        self.name = f"test/hashing-{dimension}"
        self.dimension = dimension

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dimension
        for word in re.findall(r"\w+", normalize_for_retrieval(text)):
            padded = f" {word} "
            for i in range(max(1, len(padded) - 2)):
                gram = padded[i : i + 3].encode("utf-8")
                bucket = int.from_bytes(hashlib.blake2b(gram, digest_size=4).digest(), "big")
                vector[bucket % self.dimension] += 1.0 if bucket & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


def load_embedder(model_name: str, device: str = "cpu", batch_size: int = 8) -> Embedder:
    if model_name.startswith("test/hashing-"):
        return HashingEmbedder(int(model_name.rsplit("-", 1)[1]))
    return SentenceTransformerEmbedder(model_name, device=device, batch_size=batch_size)
