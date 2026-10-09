import pytest
from pydantic import ValidationError

from import_compliance_rag.evaluation.dataset import EvalCase, EvalDataset
from import_compliance_rag.evaluation.runner import score_separation


def test_unanswerable_cases_must_not_have_targets_and_answerable_cases_must():
    EvalCase(id="neg", query="q", query_language="en", answerable=False, tags=["negative"])
    with pytest.raises(ValidationError, match="must not list"):
        EvalCase(
            id="neg", query="q", query_language="en", answerable=False,
            relevant=[{"document_id": "d", "article_number": "1"}],
        )  # fmt: skip
    with pytest.raises(ValidationError, match="need at least one"):
        EvalCase(id="pos", query="q", query_language="en")


def test_dataset_rejects_duplicate_ids_and_mixed_language():
    case = {"id": "a", "query": "q", "query_language": "ar", "relevant": [{"document_id": "d"}]}
    with pytest.raises(ValidationError, match="duplicate"):
        EvalDataset(cases=[case, case])
    with pytest.raises(ValidationError):
        EvalCase(**{**case, "query_language": "mixed"})


def _case(answerable, dense):
    return {"answerable": answerable, "top_scores": {"dense": dense, "rerank": None, "lexical": None}}


def test_score_separation_auroc():
    perfect = score_separation([_case(True, 0.9), _case(True, 0.8), _case(False, 0.5)])
    assert perfect["dense"]["auroc"] == 1.0
    mixed = score_separation([_case(True, 0.6), _case(True, 0.4), _case(False, 0.5), _case(False, 0.6)])
    # pairs: (0.6>0.5)=1, (0.6=0.6)=0.5, (0.4<0.5)=0, (0.4<0.6)=0 -> 1.5 / 4
    assert mixed["dense"]["auroc"] == 0.375
    assert "rerank" not in mixed  # no scores of that kind
