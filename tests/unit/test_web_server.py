from contextlib import contextmanager
from http import HTTPStatus

import pytest

from import_compliance_rag.config.settings import Settings
from import_compliance_rag.web import server
from import_compliance_rag.web.server import MAX_QUERY_CHARS, MAX_TOP_K, ApiError, Service


class FakePackage:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def model_dump(self, mode):
        return self.kwargs


class FakeRetriever:
    def __init__(self):
        self.calls = []

    def search(self, session, query, filters, top_k, expand):
        self.calls.append((query, filters, top_k, expand))
        return FakePackage(query=query, top_k=top_k)


@pytest.fixture()
def service(monkeypatch):
    @contextmanager
    def no_db(url):
        yield None

    monkeypatch.setattr(server, "session_scope", no_db)
    return Service(Settings(), "postgresql://unused", FakeRetriever())


def test_search_validates_and_clamps_parameters(service):
    with pytest.raises(ApiError) as missing:
        service.search({"q": ["   "]})
    assert missing.value.status is HTTPStatus.BAD_REQUEST
    with pytest.raises(ApiError):
        service.search({"q": ["x" * (MAX_QUERY_CHARS + 1)]})
    with pytest.raises(ApiError):
        service.search({"q": ["fees"], "top_k": ["many"]})

    assert service.search({"q": ["fees"], "top_k": ["500"]})["top_k"] == MAX_TOP_K
    assert service.search({"q": ["fees"], "top_k": ["0"]})["top_k"] == 1


def test_search_passes_filters_and_flags(service):
    service.search({"q": [" رسوم "], "doc": ["a", "b"], "history": ["1"], "expand": ["0"]})
    query, filters, top_k, expand = service.retriever.calls[-1]
    assert query == "رسوم"
    assert filters.document_ids == ["a", "b"] and filters.include_history
    assert top_k == 8 and expand is False
