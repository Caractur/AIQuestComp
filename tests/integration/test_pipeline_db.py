"""Ingestion, versioning, embedding and search against the PostgreSQL test database.

Uses small plain-text sources written to a temporary directory and the deterministic hashing
embedder, so no PDFs, OCR or model downloads are needed. The test database schema is recreated.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select, text

from import_compliance_rag.config.settings import Settings
from import_compliance_rag.ingestion.pipeline import IngestionPipeline, load_registry, sync_sources
from import_compliance_rag.retrieval.embedder import HashingEmbedder
from import_compliance_rag.retrieval.indexing import embed_chunks
from import_compliance_rag.retrieval.search import CAVEAT_STATUS_UNKNOWN, HybridRetriever, SearchFilters
from import_compliance_rag.schemas.regulatory import ChunkType, DocumentType, SourceRegistryEntry
from import_compliance_rag.storage.db import get_engine, session_scope, upgrade_schema
from import_compliance_rag.storage.models import Chunk, ChunkEmbedding, DocumentVersion

pytestmark = pytest.mark.integration

LAW_TEXT = """قانون تجريبي للاستيراد
المادة 1
يسمى هذا القانون قانون الاستيراد التجريبي .
المادة 2
يكون للكلمات والعبارات التالية حيثما وردت في هذا القانون المعاني المخصصة لها ادناه :
الوزارة : وزارة الصناعة والتجارة .
بطاقة المستورد : الوثيقة التي تمنحها الوزارة للمستورد المسجل .
المادة 3
تكون مدة سريان رخصة الاستيراد سنة واحدة .
المادة 4
تستوفي الوزارة رسما مقداره خمسة عشر دينارا لاصدار بطاقة المستورد وفقا لاحكام المادة (3) من هذا القانون .
-هكذا اصبحت هذه المادة بعد تعديلها حيث كان نصها كما يلي:
تستوفي الوزارة رسما مقداره خمسة دنانير لاصدار بطاقة المستورد .
"""

TREATY_TEXT = """RULES OF ORIGIN
1.
This Agreement shall apply to any article if the domestic content is not less than 35 percent.
2.
Simple combining or packaging operations do not confer origin.
"""


def _entries(raw: Path) -> list[SourceRegistryEntry]:
    (raw / "law").mkdir(parents=True)
    (raw / "treaty").mkdir(parents=True)
    (raw / "law" / "source.txt").write_text(LAW_TEXT, encoding="utf-8")
    (raw / "treaty" / "source.txt").write_text(TREATY_TEXT, encoding="utf-8")
    return [
        SourceRegistryEntry(
            id="test-import-law",
            title_original="قانون تجريبي للاستيراد",
            issuing_authority="Test authority",
            original_language="ar",
            document_type=DocumentType.LAW,
            binding_nature="binding",
            publication_date=date(2001, 7, 1),
            local_file="law/source.txt",
        ),
        SourceRegistryEntry(
            id="test-treaty-annex",
            title_original="Test treaty annex",
            issuing_authority="Test authority",
            original_language="en",
            document_type=DocumentType.AGREEMENT,
            binding_nature="binding",
            local_file="treaty/source.txt",
        ),
    ]


@pytest.fixture()
def env(tmp_path: Path, test_database_url: str):
    engine = create_engine(test_database_url)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    engine.dispose()
    get_engine.cache_clear()
    upgrade_schema(test_database_url)
    settings = Settings(data_dir=tmp_path / "data")
    entries = _entries(settings.raw_sources_dir)
    yield settings, test_database_url, entries
    get_engine.cache_clear()


def _ingest_all(settings, url, entries, force=False):
    pipeline = IngestionPipeline(settings)
    results = []
    for entry in entries:
        with session_scope(url) as session:
            results.append(pipeline.ingest(session, entry, force=force))
    return results


def test_ingest_is_idempotent_and_versions_new_files(env):
    settings, url, entries = env
    first = _ingest_all(settings, url, entries)
    assert [r.status for r in first] == ["created", "created"]
    assert (settings.derived_dir / "test-import-law" / first[0].sha256[:12] / "chunks.jsonl").is_file()

    second = _ingest_all(settings, url, entries)
    assert [r.status for r in second] == ["skipped", "skipped"]
    assert [r.version_id for r in second] == [r.version_id for r in first]

    with session_scope(url) as session:
        ids_before = set(session.scalars(select(Chunk.id).where(Chunk.version_id == first[0].version_id)))
    forced = _ingest_all(settings, url, entries[:1], force=True)
    assert forced[0].status == "reprocessed" and forced[0].version_id == first[0].version_id
    with session_scope(url) as session:
        ids_after = set(session.scalars(select(Chunk.id).where(Chunk.version_id == first[0].version_id)))
    assert ids_before == ids_after  # stable ids for the same file

    # A changed file creates a new active version; the old one is kept inactive.
    path = settings.raw_sources_dir / "law" / "source.txt"
    path.write_text(LAW_TEXT.replace("سنة واحدة", "سنتين"), encoding="utf-8")
    changed = _ingest_all(settings, url, entries[:1])
    assert changed[0].status == "created" and changed[0].version_id != first[0].version_id
    with session_scope(url) as session:
        versions = session.scalars(
            select(DocumentVersion).where(DocumentVersion.document_id == "test-import-law").order_by(DocumentVersion.id)
        ).all()
        assert [v.is_active for v in versions] == [False, True]

    # Reverting to the original file re-activates its version instead of duplicating it.
    path.write_text(LAW_TEXT, encoding="utf-8")
    reverted = _ingest_all(settings, url, entries[:1])
    assert reverted[0].status == "reactivated" and reverted[0].version_id == first[0].version_id


def test_registry_sync_and_loading(env, tmp_path: Path):
    settings, url, entries = env
    with session_scope(url) as session:
        assert sync_sources(session, entries) == {"created": 2, "updated": 0}
        assert sync_sources(session, entries) == {"created": 0, "updated": 0}
    registry = tmp_path / "registry.yaml"
    registry.write_text(
        "- id: dup-doc\n  title_original: a\n  issuing_authority: b\n  original_language: ar\n"
        "  document_type: law\n  local_file: x.pdf\n" * 2,
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate id"):
        load_registry(registry)


def test_embedding_and_search_with_citations_filters_and_expansion(env):
    settings, url, entries = env
    _ingest_all(settings, url, entries)
    embedder = HashingEmbedder(128)
    with session_scope(url) as session:
        assert embed_chunks(session, embedder)["embedded"] > 0
        assert embed_chunks(session, embedder) == {"embedded": 0, "up_to_date": session.scalar(
            select(func.count()).select_from(ChunkEmbedding))}

    # The hashing embedder is not semantic; hybrid mode exercises dense, lexical and fusion paths at once.
    assert settings.retrieval.default_mode == "dense"
    retriever = HybridRetriever(settings.retrieval.model_copy(update={"default_mode": "hybrid"}), embedder)
    with session_scope(url) as session:
        package = retriever.search(session, "خمسة عشر دينارا لاصدار بطاقة المستورد", top_k=3)
        top = package.items[0]
        assert top.relation == "retrieved"
        assert top.citation.document_id == "test-import-law" and top.citation.article_number == "4"
        assert top.citation.version_label.startswith("sha256:")
        assert top.citation.legal_status == "unknown" and CAVEAT_STATUS_UNKNOWN in top.caveats
        # Superseded wording from the amendment note is excluded by default ...
        assert all(i.chunk_type is not ChunkType.AMENDMENT_HISTORY for i in package.items)
        assert all("خمسة دنانير" not in i.text_original for i in package.items)
        # ... and context is expanded: the cross-referenced article and the definition of a used term.
        relations = {(i.relation, i.citation.article_number) for i in package.items}
        assert ("cross_reference", "3") in relations
        assert any(i.relation == "definition" and i.related_to == top.chunk_id for i in package.items)

        history = retriever.search(
            session, "خمسة دنانير بطاقة المستورد", SearchFilters(include_history=True), top_k=5, expand=False
        )
        assert any(i.chunk_type is ChunkType.AMENDMENT_HISTORY for i in history.items)

        filtered = retriever.search(
            session, "domestic content 35 percent", SearchFilters(document_ids=["test-treaty-annex"]), expand=False
        )
        assert filtered.items and {i.citation.document_id for i in filtered.items} == {"test-treaty-annex"}
        assert filtered.items[0].citation.article_number == "1"

        # Cross-language candidates get their dense rank as a stand-in lexical rank.
        cross = retriever.search(session, "رسم بطاقة المستورد", top_k=10, expand=False)
        english = [i for i in cross.items if i.citation.document_id == "test-treaty-annex"]
        assert english and all(i.signal.lexical_rank_imputed for i in english)
        assert not any(i.signal.lexical_rank_imputed for i in cross.items if i.citation.language == "ar")

        # An explicit "article N of <instrument>" reference puts that article first.
        referenced = retriever.search(session, "المادة 3 من قانون تجريبي للاستيراد", top_k=3, expand=False)
        assert referenced.items[0].citation.article_number == "3"
        assert referenced.items[0].signal.exact_reference
        assert not any(i.signal.exact_reference for i in referenced.items[1:])
        unresolved = retriever.search(session, "المادة 3 من قانون الجمارك", top_k=3, expand=False)
        assert not any(i.signal.exact_reference for i in unresolved.items)

        lexical_only = retriever.search(session, "سريان رخصة الاستيراد", mode="lexical", expand=False)
        assert lexical_only.embedding_model is None
        assert lexical_only.items[0].citation.article_number == "3"


def test_search_without_embeddings_warns_and_falls_back_to_lexical(env):
    settings, url, entries = env
    _ingest_all(settings, url, entries)
    retriever = HybridRetriever(settings.retrieval, HashingEmbedder(64))
    with session_scope(url) as session:
        package = retriever.search(session, "سريان رخصة الاستيراد", expand=False)
    assert any("no embeddings" in w for w in package.warnings)
    assert package.items[0].citation.article_number == "3"
    with session_scope(url) as session:
        dense = retriever.search(session, "سريان رخصة الاستيراد", mode="dense", expand=False)
    assert any("fell back to lexical" in w for w in dense.warnings)
    assert dense.items[0].citation.article_number == "3"
