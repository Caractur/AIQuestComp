"""Local preview server: static UI from ``web/`` plus a read-only JSON API over the retriever.

Endpoints (GET only):
* ``/api/health``  - service status, retrieval configuration and corpus size.
* ``/api/search``  - ``q`` (required, <= 500 chars), ``top_k`` (1-20), ``history`` (0/1),
                     ``expand`` (0/1), ``doc`` (repeatable registry id). Returns an EvidencePackage.
* ``/api/sources`` - registered documents with their active version.

Intended for local use: binds to 127.0.0.1 by default, has no authentication and no write
endpoints. It is not the production API (a later phase in handoff.md).
"""

from __future__ import annotations

import json
import logging
import threading
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select

from import_compliance_rag.config.settings import Settings
from import_compliance_rag.retrieval.search import HybridRetriever, SearchFilters
from import_compliance_rag.storage.db import session_scope
from import_compliance_rag.storage.models import Chunk, DocumentVersion, SourceDocument

log = logging.getLogger(__name__)

MAX_QUERY_CHARS = 500
MAX_TOP_K = 20


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


class Service:
    """Holds the retriever (models loaded once) and serializes searches."""

    def __init__(self, settings: Settings, database_url: str, retriever: HybridRetriever) -> None:
        self.settings = settings
        self.database_url = database_url
        self.retriever = retriever
        self._lock = threading.Lock()  # the lexical cache and model calls are not thread-safe

    def health(self) -> dict:
        with session_scope(self.database_url) as session:
            documents = session.scalar(
                select(func.count()).select_from(DocumentVersion).where(DocumentVersion.is_active)
            )
            chunks = session.scalar(
                select(func.count())
                .select_from(Chunk)
                .join(DocumentVersion, DocumentVersion.id == Chunk.version_id)
                .where(DocumentVersion.is_active)
            )
        r = self.retriever
        return {
            "status": "ok",
            "mode": r.settings.default_mode,
            "embedding_model": r.embedder.name if r.embedder else None,
            "reranker_model": r.reranker.name if r.reranker else None,
            "documents": documents,
            "chunks": chunks,
            "generation": None,  # no answer generation exists; results are original provisions
        }

    def search(self, params: dict[str, list[str]]) -> dict:
        query = (params.get("q") or [""])[0].strip()
        if not query:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Enter a question to search for.")
        if len(query) > MAX_QUERY_CHARS:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Questions are limited to {MAX_QUERY_CHARS} characters.")
        try:
            top_k = int((params.get("top_k") or ["8"])[0])
        except ValueError as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, "top_k must be a number.") from exc
        top_k = max(1, min(top_k, MAX_TOP_K))
        flag = lambda name, default: (params.get(name) or [default])[0] in ("1", "true", "yes")  # noqa: E731
        filters = SearchFilters(document_ids=params.get("doc", []), include_history=flag("history", "0"))
        with self._lock, session_scope(self.database_url) as session:
            package = self.retriever.search(session, query, filters, top_k=top_k, expand=flag("expand", "1"))
        return package.model_dump(mode="json")

    def sources(self) -> list[dict]:
        with session_scope(self.database_url) as session:
            rows = session.execute(
                select(SourceDocument, DocumentVersion, func.count(Chunk.id))
                .outerjoin(
                    DocumentVersion,
                    (DocumentVersion.document_id == SourceDocument.id) & DocumentVersion.is_active,
                )
                .outerjoin(Chunk, Chunk.version_id == DocumentVersion.id)
                .group_by(SourceDocument.id, DocumentVersion.id)
                .order_by(SourceDocument.id)
            ).all()
            return [
                {
                    "id": doc.id,
                    "title_original": doc.title_original,
                    "title_en": doc.title_en,
                    "issuing_authority": doc.issuing_authority,
                    "document_type": doc.document_type,
                    "binding_nature": doc.binding_nature,
                    "legal_status": doc.legal_status,
                    "status_note": doc.status_note,
                    "original_language": doc.original_language,
                    "gazette_reference": doc.gazette_reference,
                    "amendment_info": doc.amendment_info,
                    "official_url": doc.official_url,
                    "version_label": version.version_label if version else None,
                    "page_count": version.page_count if version else None,
                    "extraction_method": version.extraction_method if version else None,
                    "chunks": chunks,
                }
                for doc, version, chunks in rows
            ]


class Handler(SimpleHTTPRequestHandler):
    service: Service

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        try:
            params = parse_qs(url.query)
            if url.path == "/api/health":
                body = self.service.health()
            elif url.path == "/api/search":
                body = self.service.search(params)
            elif url.path == "/api/sources":
                body = self.service.sources()
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "Unknown endpoint.")
            self._json(HTTPStatus.OK, body)
        except ApiError as exc:
            self._json(exc.status, {"error": str(exc)})
        except Exception:  # never leak internals to the page
            log.exception("api.error", extra={"path": url.path})
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The search service failed. See the server log."})

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, status: HTTPStatus, body: object) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        log.debug("http", extra={"request": format % args})


Handler.extensions_map = {
    **SimpleHTTPRequestHandler.extensions_map,
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
}


def serve(service: Service, web_dir: Path, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"service": service})
    server = ThreadingHTTPServer((host, port), partial(handler, directory=str(web_dir)))
    return server
