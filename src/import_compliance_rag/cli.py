"""Command-line interface: ``uv run import-compliance-rag --help``."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated

import typer

from import_compliance_rag.config.logging import configure_logging
from import_compliance_rag.config.settings import Settings, get_settings

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Jordan import compliance RAG.")


def _settings(test_db: bool = False) -> tuple[Settings, str]:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Arabic output on Windows consoles
    return settings, settings.test_database_url if test_db else settings.database_url


TestDb = Annotated[bool, typer.Option("--test-db", help="Use ICR_TEST_DATABASE_URL.")]


@app.command("db-init")
def db_init(test_db: TestDb = False) -> None:
    """Create or upgrade the database schema (pgvector extension and tables)."""
    from import_compliance_rag.storage.db import upgrade_schema

    _, url = _settings(test_db)
    upgrade_schema(url)
    typer.echo("schema is up to date")


@app.command("sources-sync")
def sources_sync(test_db: TestDb = False) -> None:
    """Load data/sources/registry.yaml into the database."""
    from import_compliance_rag.ingestion.pipeline import load_registry, sync_sources
    from import_compliance_rag.storage.db import session_scope

    settings, url = _settings(test_db)
    entries = load_registry(settings.source_registry_path)
    with session_scope(url) as session:
        counts = sync_sources(session, entries)
    missing = [e.id for e in entries if not (settings.raw_sources_dir / e.local_file).is_file()]
    typer.echo(f"{len(entries)} registry entries: {counts}")
    for doc_id in missing:
        typer.echo(f"  missing local file for {doc_id} (download it from official_url)")


@app.command()
def ingest(
    doc: Annotated[list[str] | None, typer.Option("--doc", help="Registry id (repeatable).")] = None,
    force: Annotated[bool, typer.Option(help="Re-process even if unchanged.")] = False,
    test_db: TestDb = False,
) -> None:
    """Extract, structure, chunk and store registry sources (idempotent)."""
    from import_compliance_rag.ingestion.pipeline import IngestionPipeline, load_registry
    from import_compliance_rag.storage.db import session_scope

    settings, url = _settings(test_db)
    entries = load_registry(settings.source_registry_path)
    if doc:
        unknown = set(doc) - {e.id for e in entries}
        if unknown:
            raise typer.BadParameter(f"unknown registry ids: {sorted(unknown)}")
        entries = [e for e in entries if e.id in doc]
    pipeline = IngestionPipeline(settings)
    for entry in entries:
        with session_scope(url) as session:
            result = pipeline.ingest(session, entry, force=force)
        typer.echo(
            f"{result.document_id}: {result.status} (version {result.version_id}, "
            f"{result.chunks} chunks, extraction {result.extraction_status})"
        )
        for warning in result.warnings:
            typer.echo(f"  warning: {warning}")


@app.command()
def embed(
    model: Annotated[str | None, typer.Option(help="Embedding model; default from settings.")] = None,
    batch_size: Annotated[int, typer.Option()] = 16,
    test_db: TestDb = False,
) -> None:
    """Compute embeddings for active chunks with one model (skips up-to-date chunks)."""
    from import_compliance_rag.retrieval.embedder import load_embedder
    from import_compliance_rag.retrieval.indexing import embed_chunks
    from import_compliance_rag.storage.db import session_scope

    settings, url = _settings(test_db)
    name = model or settings.retrieval.embedding_model
    embedder = load_embedder(name, settings.retrieval.embedding_device, settings.retrieval.embedding_batch_size)
    with session_scope(url) as session:
        counts = embed_chunks(session, embedder, batch_size=batch_size)
    typer.echo(f"{name} (dim {embedder.dimension}): {counts}")


def _mode(settings: Settings, mode: str | None) -> str:
    mode = mode or settings.retrieval.default_mode
    if mode not in ("hybrid", "dense", "lexical"):
        raise typer.BadParameter("mode must be dense, hybrid or lexical")
    return mode


def _retriever(settings: Settings, model: str | None, mode: str, rerank: bool):
    from import_compliance_rag.retrieval.embedder import load_embedder
    from import_compliance_rag.retrieval.search import HybridRetriever, Reranker

    r = settings.retrieval
    embedder = None if mode == "lexical" else load_embedder(model or r.embedding_model, r.embedding_device)
    reranker = Reranker(r.reranker_model, r.embedding_device) if rerank and r.reranker_model else None
    return HybridRetriever(r, embedder, reranker)


@app.command()
def search(
    query: str,
    top_k: Annotated[int | None, typer.Option("--top-k")] = None,
    mode: Annotated[str | None, typer.Option(help="dense | hybrid | lexical; default from settings")] = None,
    model: Annotated[str | None, typer.Option(help="Embedding model; default from settings.")] = None,
    doc: Annotated[list[str] | None, typer.Option("--doc", help="Restrict to registry ids.")] = None,
    doc_type: Annotated[list[str] | None, typer.Option("--type", help="Document types.")] = None,
    lang: Annotated[list[str] | None, typer.Option("--lang", help="Chunk languages (ar, en).")] = None,
    history: Annotated[bool, typer.Option(help="Include amendment-history chunks.")] = False,
    expand: Annotated[bool, typer.Option(help="Add definitions, sibling parts, cross-references.")] = True,
    rerank: Annotated[bool, typer.Option(help="Use the configured reranker, if any.")] = True,
    as_json: Annotated[bool, typer.Option("--json", help="Print the evidence package as JSON.")] = False,
    test_db: TestDb = False,
) -> None:
    """Retrieve evidence for a query (Arabic or English) with citations and caveats."""
    from import_compliance_rag.retrieval.search import SearchFilters
    from import_compliance_rag.storage.db import session_scope

    settings, url = _settings(test_db)
    mode = _mode(settings, mode)
    filters = SearchFilters(
        document_ids=doc or [], document_types=doc_type or [], languages=lang or [], include_history=history
    )
    retriever = _retriever(settings, model, mode, rerank)
    with session_scope(url) as session:
        package = retriever.search(session, query, filters, top_k=top_k, mode=mode, expand=expand)
    if as_json:
        typer.echo(package.model_dump_json(indent=2))
        return
    typer.echo(f"query ({package.query_language}): {package.query}")
    for warning in package.warnings:
        typer.echo(f"warning: {warning}")
    for n, item in enumerate(package.items, start=1):
        c = item.citation
        where = f"art. {c.article_number}" if c.article_number else item.chunk_type.value
        pages = f"p. {c.page_start}" + (f"-{c.page_end}" if c.page_end != c.page_start else "")
        if item.relation != "retrieved":
            tag = item.relation
        elif item.signal.exact_reference:
            tag = "exact reference"
        elif item.signal.rerank_score is not None:
            tag = f"rerank {item.signal.rerank_score:.3f}"
        else:
            tag = f"score {item.signal.fused_score:.4f}"
        typer.echo(f"\n[{n}] {c.document_id} {where} ({pages}) [{tag}] {item.chunk_id}")
        typer.echo("    " + item.text_original[:400].replace("\n", "\n    "))
        for caveat in item.caveats:
            typer.echo(f"    ! {caveat}")


@app.command("eval-retrieval")
def eval_retrieval(
    cases: Annotated[Path, typer.Option(help="Evaluation cases YAML.")] = Path("data/eval/retrieval_cases.yaml"),
    model: Annotated[str | None, typer.Option(help="Embedding model; default from settings.")] = None,
    mode: Annotated[str | None, typer.Option(help="dense | hybrid | lexical; default from settings")] = None,
    k: Annotated[list[int] | None, typer.Option("--k", help="Cut-offs (repeatable).")] = None,
    rerank: Annotated[bool, typer.Option()] = False,
    save: Annotated[bool, typer.Option(help="Write the run to data/eval/runs/.")] = True,
    test_db: TestDb = False,
) -> None:
    """Score retrieval against labelled cases; reported per query→document language direction."""
    from import_compliance_rag.evaluation.dataset import load_cases
    from import_compliance_rag.evaluation.runner import format_report, run_evaluation
    from import_compliance_rag.ingestion.pipeline import load_registry
    from import_compliance_rag.storage.db import session_scope

    settings, url = _settings(test_db)
    mode = _mode(settings, mode)
    dataset = load_cases(cases)
    registry = {e.id: e for e in load_registry(settings.source_registry_path)}
    retriever = _retriever(settings, model, mode, rerank)
    with session_scope(url) as session:
        report = run_evaluation(session, retriever, dataset, registry, ks=k or [1, 3, 5, 10], mode=mode)
    typer.echo(format_report(report))
    if save:
        runs = settings.data_dir / "eval" / "runs"
        runs.mkdir(parents=True, exist_ok=True)
        path = runs / f"{report['run_id']}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        typer.echo(f"\nrun saved to {path}")


@app.command()
def serve(
    host: Annotated[str, typer.Option(help="Interface to bind; keep 127.0.0.1 unless you know why.")] = "127.0.0.1",
    port: Annotated[int, typer.Option()] = 8765,
    web_dir: Annotated[Path, typer.Option(help="Static UI directory.")] = Path("web"),
    model: Annotated[str | None, typer.Option(help="Embedding model; default from settings.")] = None,
    rerank: Annotated[bool, typer.Option(help="Use the configured reranker (slow on CPU).")] = False,
    test_db: TestDb = False,
) -> None:
    """Serve the ImportReady UI and a local read-only search API."""
    from import_compliance_rag.web.server import Service
    from import_compliance_rag.web.server import serve as make_server

    settings, url = _settings(test_db)
    if not (web_dir / "index.html").is_file():
        raise typer.BadParameter(f"no index.html in {web_dir}")
    typer.echo("loading retrieval models ...")
    service = Service(settings, url, _retriever(settings, model, settings.retrieval.default_mode, rerank))
    server = make_server(service, web_dir.resolve(), host, port)
    typer.echo(f"ImportReady UI on http://{host}:{port}/  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
