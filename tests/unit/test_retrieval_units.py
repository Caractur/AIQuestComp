import math

import pytest

from import_compliance_rag.evaluation.metrics import dedupe, ndcg_at_k, precision_at_k, recall_at_k, reciprocal_rank
from import_compliance_rag.retrieval.embedder import HashingEmbedder, load_embedder
from import_compliance_rag.retrieval.fusion import fuse_ranks, reciprocal_rank_fusion
from import_compliance_rag.retrieval.lexical import BM25Index, light_stem, tokenize


def test_tokenize_normalizes_stems_and_drops_stopwords():
    assert tokenize("الاستيراد والتصدير في المملكة") == ["استيراد", "تصدير", "مملك"]
    # Singular and plural / definite and indefinite forms meet on one stem.
    assert tokenize("رخصة")[0] == tokenize("الرخص")[0] == "رخص"


def test_light_stem_keeps_short_words_and_root_waw():
    assert light_stem("وزير") == "وزير"
    assert light_stem("وزاره") == "وزار"
    assert light_stem("الوزاره") == "وزار"
    assert light_stem("بال") == "بال"


def test_tokenize_keeps_numbers_and_hs_headings():
    tokens = tokenize("HS subheading 2009.11 المادة ٧٣")
    assert "2009.11" in tokens and "2009" in tokens and "73" in tokens


def test_tokenize_english_plural():
    assert tokenize("importers licences") == ["importer", "licence"]


def test_bm25_ranks_matching_document_first_and_respects_allowed():
    index = BM25Index(
        {
            "a": tokenize("رسوم اصدار رخصة الاستيراد عشرة دنانير"),
            "b": tokenize("حظر استيراد البضاعة بقرار من مجلس الوزراء"),
            "c": tokenize("مدة سريان الرخصة سنة واحدة"),
        }
    )
    hits = index.search(tokenize("كم رسوم رخصة الاستيراد"), top_k=3)
    assert hits[0].doc_id == "a"
    assert [h.doc_id for h in index.search(tokenize("رخصة"), top_k=3, allowed={"c"})] == ["c"]
    assert index.search(tokenize("unrelated"), top_k=3) == []


def test_rrf_scores_and_deterministic_ties():
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "a", "d"]], k=60)
    scores = dict(fused)
    assert scores["a"] == pytest.approx(1 / 61 + 1 / 62)
    assert scores["d"] == pytest.approx(1 / 63)
    assert [d for d, _ in fused][:2] == ["a", "b"]  # equal score, tie broken by best rank then id
    assert fuse_ranks([{"x": 1}, {"x": 1}], k=60)[0][1] == pytest.approx(2 / 61)


def test_metrics_known_values():
    ranked = ["x", "a", "y", "b"]
    relevant = {"a": 2, "b": 1}
    assert recall_at_k(ranked, relevant, 2) == 0.5
    assert precision_at_k(ranked, relevant, 4) == 0.5
    assert reciprocal_rank(ranked, relevant) == 0.5
    dcg = 3 / math.log2(3) + 1 / math.log2(5)
    ideal = 3 / math.log2(2) + 1 / math.log2(3)
    assert ndcg_at_k(ranked, relevant, 4) == pytest.approx(dcg / ideal)
    assert reciprocal_rank(["z"], relevant) == 0.0
    assert dedupe(["a", "b", "a", "c"]) == ["a", "b", "c"]


def test_hashing_embedder_is_deterministic_and_normalized():
    embedder = load_embedder("test/hashing-64")
    assert isinstance(embedder, HashingEmbedder) and embedder.dimension == 64
    v1, v2 = embedder.embed_documents(["رخصة الاستيراد", "رخصة الاستيراد"])
    assert v1 == v2
    assert sum(x * x for x in v1) == pytest.approx(1.0)
    same = sum(a * b for a, b in zip(v1, embedder.embed_query("رخصة استيراد"), strict=True))
    other = sum(a * b for a, b in zip(v1, embedder.embed_query("textile apparel"), strict=True))
    assert same > other
