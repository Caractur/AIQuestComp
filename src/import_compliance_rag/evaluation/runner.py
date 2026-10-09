"""Run retrieval over evaluation cases and aggregate metrics per language direction and tag."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from statistics import mean

from sqlalchemy.orm import Session

from import_compliance_rag.evaluation.dataset import EvalCase, EvalDataset, ReviewStatus
from import_compliance_rag.evaluation.metrics import (
    dedupe,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    reciprocal_rank,
)
from import_compliance_rag.retrieval.search import HybridRetriever
from import_compliance_rag.schemas.regulatory import ChunkType, EvidencePackage, SourceRegistryEntry

DRAFT_BANNER = (
    "DRAFT RESULTS - computed on evaluation cases that have not been reviewed by a domain expert. "
    "They indicate relative behaviour only and must not be reported as validated retrieval quality."
)
PREAMBLE = "preamble"


def direction(case: EvalCase, registry: dict[str, SourceRegistryEntry]) -> str:
    """'<query language>-><target document language>', e.g. 'en->ar'; 'mixed' or 'none' targets allowed."""
    if not case.answerable:
        return f"{case.query_language.value}->none"
    targets = {registry[t.document_id].original_language.value for t in case.relevant if t.document_id in registry}
    target = targets.pop() if len(targets) == 1 else "mixed"
    return f"{case.query_language.value}->{target}"


def _top_scores(package: EvidencePackage) -> dict[str, float | None]:
    signals = [i.signal for i in package.items if i.signal is not None]
    dense = [s.dense_score for s in signals if s.dense_score is not None]
    rerank = [s.rerank_score for s in signals if s.rerank_score is not None]
    lexical = [s.lexical_score for s in signals if s.lexical_score is not None]
    return {
        "dense": round(max(dense), 4) if dense else None,
        "rerank": round(max(rerank), 4) if rerank else None,
        "lexical": round(max(lexical), 4) if lexical else None,
    }


def _units(package: EvidencePackage, whole_docs: set[str]) -> list[tuple[str, str | None]]:
    units = []
    for item in package.items:
        doc, art = item.citation.document_id, item.citation.article_number
        if doc in whole_docs:
            units.append((doc, None))
        elif art is None and item.chunk_type is ChunkType.PREAMBLE:
            units.append((doc, PREAMBLE))
        else:
            units.append((doc, art))
    return dedupe(units)


def run_evaluation(
    session: Session,
    retriever: HybridRetriever,
    dataset: EvalDataset,
    registry: dict[str, SourceRegistryEntry],
    ks: list[int],
    mode: str = "hybrid",
) -> dict:
    depth = max(ks)
    per_case = []
    for case in dataset.cases:
        package = retriever.search(session, case.query, top_k=max(depth, 10), mode=mode, expand=False)
        result = {
            "id": case.id,
            "direction": direction(case, registry),
            "tags": case.tags,
            "answerable": case.answerable,
            "review_status": case.review_status.value,
            "query": case.query,
            "top_scores": _top_scores(package),
        }
        whole_docs = {t.document_id for t in case.relevant if t.article_number is None}
        ranked = _units(package, whole_docs)
        result["retrieved"] = [list(u) for u in ranked[:depth]]
        if case.answerable:
            relevant = {t.unit: t.grade for t in case.relevant}
            metrics = {"mrr": reciprocal_rank(ranked, relevant)}
            for k in ks:
                metrics[f"recall@{k}"] = recall_at_k(ranked, relevant, k)
                metrics[f"precision@{k}"] = precision_at_k(ranked, relevant, k)
                metrics[f"ndcg@{k}"] = ndcg_at_k(ranked, relevant, k)
            result["relevant"] = [list(u) for u in relevant]
            result["metrics"] = {name: round(value, 4) for name, value in metrics.items()}
        per_case.append(result)

    answered = [r for r in per_case if r["answerable"]]
    groups: dict[str, list[dict]] = defaultdict(list)
    for result in answered:
        groups[result["direction"]].append(result)
        for tag in result["tags"]:
            groups[f"tag:{tag}"].append(result)
        groups["all"].append(result)
    order = lambda name: (name == "all", name.startswith("tag:"), name)  # noqa: E731
    summary = {
        name: {
            "cases": len(results),
            **{metric: round(mean(r["metrics"][metric] for r in results), 4) for metric in results[0]["metrics"]},
        }
        for name, results in sorted(groups.items(), key=lambda g: order(g[0]))
    }
    statuses = {c.review_status for c in dataset.cases}
    retrieval = retriever.settings
    return {
        "run_id": datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + f"-{mode}",
        "created_at": datetime.now(UTC).isoformat(),
        "validated": statuses == {ReviewStatus.REVIEWED},
        "notice": None if statuses == {ReviewStatus.REVIEWED} else DRAFT_BANNER,
        "config": {
            "mode": mode,
            "embedding_model": retriever.embedder.name if retriever.embedder and mode != "lexical" else None,
            "reranker_model": retriever.reranker.name if retriever.reranker else None,
            "dense_top_k": retrieval.dense_top_k,
            "lexical_top_k": retrieval.lexical_top_k,
            "rrf_k": retrieval.rrf_k,
            "ks": ks,
        },
        "dataset": {
            "version": dataset.version,
            "cases": len(dataset.cases),
            "answerable": len(answered),
            "review_status": {s.value: sum(c.review_status is s for c in dataset.cases) for s in ReviewStatus},
        },
        "summary": summary,
        "score_separation": score_separation(per_case),
        "cases": per_case,
    }


def score_separation(per_case: list[dict]) -> dict[str, dict]:
    """How well each top score separates answerable from unanswerable questions.

    ``auroc`` is the share of (answerable, unanswerable) pairs in which the answerable question got
    the higher top score (ties count half): 1.0 = a threshold could separate them perfectly.
    """
    out = {}
    for kind in ("dense", "rerank", "lexical"):
        pos = [r["top_scores"][kind] for r in per_case if r["answerable"] and r["top_scores"][kind] is not None]
        neg = [r["top_scores"][kind] for r in per_case if not r["answerable"] and r["top_scores"][kind] is not None]
        if not pos or not neg:
            continue
        wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
        out[kind] = {
            "answerable_mean": round(mean(pos), 4),
            "answerable_min": round(min(pos), 4),
            "unanswerable_mean": round(mean(neg), 4),
            "unanswerable_max": round(max(neg), 4),
            "auroc": round(wins / (len(pos) * len(neg)), 4),
        }
    return out


def format_report(report: dict) -> str:
    lines = []
    if report["notice"]:
        lines += [f"*** {report['notice']} ***", ""]
    config, data = report["config"], report["dataset"]
    lines.append(
        f"mode={config['mode']} embedding={config['embedding_model']} reranker={config['reranker_model']} "
        f"cases={data['cases']} (answerable {data['answerable']}) {data['review_status']}"
    )
    ks = config["ks"]
    columns = ["mrr"] + [f"recall@{k}" for k in ks] + [f"ndcg@{k}" for k in ks]
    lines.append(f"{'group':<16} {'n':>3} " + " ".join(f"{c:>10}" for c in columns))
    for name, row in report["summary"].items():
        lines.append(f"{name:<16} {row['cases']:>3} " + " ".join(f"{row[c]:>10.3f}" for c in columns))
    for kind, stats in report["score_separation"].items():
        lines.append(
            f"top {kind} score: answerable mean {stats['answerable_mean']} (min {stats['answerable_min']}), "
            f"unanswerable mean {stats['unanswerable_mean']} (max {stats['unanswerable_max']}), "
            f"AUROC {stats['auroc']}"
        )
    misses = [c for c in report["cases"] if c["answerable"] and c["metrics"]["mrr"] == 0]
    if misses:
        lines.append(f"\nno relevant unit retrieved for {len(misses)} case(s): {', '.join(c['id'] for c in misses)}")
    return "\n".join(lines)
