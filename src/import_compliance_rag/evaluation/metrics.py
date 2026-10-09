"""Ranking metrics over de-duplicated retrieval units (document, article).

All functions take the ranked list of retrieved units (duplicates already removed, best rank kept)
and the graded relevance judgments ``{unit: grade}``.
"""

from __future__ import annotations

import math
from collections.abc import Hashable, Sequence

Unit = Hashable


def recall_at_k(ranked: Sequence[Unit], relevant: dict[Unit, int], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for u in ranked[:k] if u in relevant) / len(relevant)


def precision_at_k(ranked: Sequence[Unit], relevant: dict[Unit, int], k: int) -> float:
    """Fraction of the top ``k`` positions holding a relevant unit (divides by ``k``)."""
    if k <= 0:
        return 0.0
    return sum(1 for u in ranked[:k] if u in relevant) / k


def reciprocal_rank(ranked: Sequence[Unit], relevant: dict[Unit, int]) -> float:
    for rank, unit in enumerate(ranked, start=1):
        if unit in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(ranked: Sequence[Unit], relevant: dict[Unit, int], k: int) -> float:
    """nDCG with exponential gain (2^grade - 1) and log2 discount."""

    def dcg(grades: Sequence[int]) -> float:
        return sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(grades))

    actual = dcg([relevant.get(u, 0) for u in ranked[:k]])
    ideal = dcg(sorted(relevant.values(), reverse=True)[:k])
    return actual / ideal if ideal else 0.0


def dedupe(units: Sequence[Unit]) -> list[Unit]:
    seen: set[Unit] = set()
    out = []
    for unit in units:
        if unit not in seen:
            seen.add(unit)
            out.append(unit)
    return out
