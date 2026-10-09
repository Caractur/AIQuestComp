"""Reciprocal rank fusion (Cormack et al., 2009)."""

from __future__ import annotations


def fuse_ranks(
    rank_maps: list[dict[str, int]], k: int = 60, weights: list[float] | None = None
) -> list[tuple[str, float]]:
    """Fuse per-retriever ranks (1-based): score(d) = sum over retrievers of w / (k + rank).

    Ties are broken by best single rank, then by id, so the output is deterministic.
    """
    weights = weights or [1.0] * len(rank_maps)
    scores: dict[str, float] = {}
    best: dict[str, int] = {}
    for ranks, weight in zip(rank_maps, weights, strict=True):
        for doc_id, rank in ranks.items():
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k + rank)
            best[doc_id] = min(best.get(doc_id, rank), rank)
    return sorted(scores.items(), key=lambda item: (-item[1], best[item[0]], item[0]))


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Fuse ranked id lists (position 1 = best)."""
    return fuse_ranks([{doc_id: r for r, doc_id in enumerate(ranking, start=1)} for ranking in rankings], k)
