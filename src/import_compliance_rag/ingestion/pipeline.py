"""Registry sync and idempotent ingestion of regulatory sources.

Versioning rules:

* A document version is identified by the SHA-256 of the source file.
* Same file + same ``PIPELINE_VERSION``: nothing to do (the version is re-activated if needed).
* Same file + newer pipeline: the version is re-processed in place (its chunks and their embeddings
  are replaced; chunk ids stay the same because they are derived from the file hash).
* New file: a new version is created and becomes active; older versions are kept, inactive, so past
  evidence remains traceable.

Derived artifacts (extraction report, page texts, chunks) are written to
``data/derived/<document id>/<sha12>/`` for inspection and review.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from import_compliance_rag.config.settings import Settings
from import_compliance_rag.ingestion.chunking import build_chunks
from import_compliance_rag.ingestion.extract import DocumentExtractor, ExtractedDocument
from import_compliance_rag.ingestion.ocr import TesseractOcr
from import_compliance_rag.ingestion.structure import parse_structure
from import_compliance_rag.schemas.regulatory import ChunkRecord, ExtractionStatus, SourceRegistryEntry
from import_compliance_rag.storage.models import Chunk, DocumentVersion, SourceDocument
from import_compliance_rag.text.arabic import normalize_for_retrieval

log = logging.getLogger(__name__)

# Bump whenever extraction, structure parsing or chunking would produce different output.
PIPELINE_VERSION = "2026.10.2"


class RegistryError(ValueError):
    pass


def load_registry(path: Path) -> list[SourceRegistryEntry]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    if not isinstance(raw, list):
        raise RegistryError(f"{path}: expected a list of entries")
    entries = [SourceRegistryEntry.model_validate(item) for item in raw]
    seen: set[str] = set()
    for entry in entries:
        if entry.id in seen:
            raise RegistryError(f"{path}: duplicate id {entry.id}")
        seen.add(entry.id)
    return entries


def sync_sources(session: Session, entries: list[SourceRegistryEntry]) -> dict[str, int]:
    """Upsert registry entries into ``source_documents``. Entries are never deleted automatically."""
    counts = {"created": 0, "updated": 0}
    for entry in entries:
        values = _document_values(entry)
        row = session.get(SourceDocument, entry.id)
        if row is None:
            session.add(SourceDocument(**values))
            counts["created"] += 1
        else:
            changed = False
            for name, value in values.items():
                if getattr(row, name) != value:
                    setattr(row, name, value)
                    changed = True
            counts["updated"] += changed
    session.flush()
    return counts


def _document_values(entry: SourceRegistryEntry) -> dict:
    data = entry.model_dump(mode="json")
    data["publication_date"] = entry.publication_date
    data["effective_date"] = entry.effective_date
    data["retrieved_at"] = entry.retrieved_at
    return data


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


@dataclass
class IngestResult:
    document_id: str
    status: str  # skipped | created | reprocessed | reactivated | missing_file | failed
    version_id: int | None = None
    sha256: str | None = None
    chunks: int = 0
    extraction_status: str | None = None
    warnings: list[str] = field(default_factory=list)


class IngestionPipeline:
    def __init__(self, settings: Settings, extractor: DocumentExtractor | None = None) -> None:
        self.settings = settings
        self.extractor = extractor or DocumentExtractor(
            TesseractOcr.from_settings(settings.ocr),
            min_page_quality=settings.text_quality.min_page_quality,
            min_line_coverage=settings.ocr.min_line_coverage,
            min_recovery_agreement=settings.ocr.min_recovery_agreement,
            verification_dpi=settings.ocr.verification_dpi,
        )

    def ingest(self, session: Session, entry: SourceRegistryEntry, force: bool = False) -> IngestResult:
        path = self.settings.raw_sources_dir / entry.local_file
        if not path.is_file():
            return IngestResult(entry.id, "missing_file", warnings=[f"source file not found: {path}"])
        sync_sources(session, [entry])
        sha = file_sha256(path)
        version = session.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == entry.id, DocumentVersion.sha256 == sha
            )
        )
        if version is not None and version.pipeline_version == PIPELINE_VERSION and not force:
            status = "skipped"
            if not version.is_active and version.extraction_status != ExtractionStatus.FAILED:
                self._activate(session, version)
                status = "reactivated"
            return IngestResult(
                entry.id, status, version.id, sha, len(version.chunks), version.extraction_status
            )

        log.info("ingest.start", extra={"document": entry.id, "sha256": sha[:12]})
        extracted = self.extractor.extract(path, entry.extraction_policy, entry.original_language)
        structure = parse_structure(
            [(p.page_number, p.text) for p in extracted.pages], entry.original_language
        )
        chunks, chunk_warnings = build_chunks(
            document_id=entry.id,
            sha256=sha,
            title=entry.title_original,
            language=entry.original_language,
            structure=structure,
            tables=extracted.tables,
            settings=self.settings.chunking,
        )
        warnings = structure.warnings + chunk_warnings
        self._write_artifacts(entry.id, sha, extracted, chunks, warnings)

        status = "created" if version is None else "reprocessed"
        if version is None:
            version = DocumentVersion(document_id=entry.id, sha256=sha, is_active=False)
            session.add(version)
        else:
            session.execute(delete(Chunk).where(Chunk.version_id == version.id))
        report = extracted.report
        version.version_label = f"sha256:{sha[:12]}"
        version.pipeline_version = PIPELINE_VERSION
        version.file_size = path.stat().st_size
        version.page_count = report.page_count
        version.extraction_method = report.method.value
        version.extraction_status = report.status.value
        version.extraction_report = report.model_dump(mode="json")
        version.structure_warnings = warnings
        session.flush()

        failed = report.status is ExtractionStatus.FAILED or not chunks
        if failed:
            version.is_active = False
            status = "failed"
        else:
            session.add_all(_chunk_row(c, version.id, self.settings) for c in chunks)
            self._activate(session, version)
        session.flush()
        log.info(
            "ingest.done",
            extra={"document": entry.id, "status": status, "chunks": len(chunks), "version": version.id},
        )
        return IngestResult(
            entry.id, status, version.id, sha, 0 if failed else len(chunks), report.status.value, warnings
        )

    @staticmethod
    def _activate(session: Session, version: DocumentVersion) -> None:
        # Deactivate first: at most one active version per document is enforced by a unique index.
        session.execute(
            update(DocumentVersion)
            .where(DocumentVersion.document_id == version.document_id, DocumentVersion.id != version.id)
            .values(is_active=False)
        )
        session.flush()
        version.is_active = True

    def _write_artifacts(
        self,
        document_id: str,
        sha: str,
        extracted: ExtractedDocument,
        chunks: list[ChunkRecord],
        warnings: list[str],
    ) -> None:
        folder = self.settings.derived_dir / document_id / sha[:12]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "extraction_report.json").write_text(
            extracted.report.model_dump_json(indent=2), encoding="utf-8"
        )
        (folder / "pages.jsonl").write_text(
            "\n".join(
                json.dumps({"page": p.page_number, "method": p.method.value, "text": p.text}, ensure_ascii=False)
                for p in extracted.pages
            ),
            encoding="utf-8",
        )
        (folder / "chunks.jsonl").write_text(
            "\n".join(c.model_dump_json() for c in chunks), encoding="utf-8"
        )
        (folder / "manifest.json").write_text(
            json.dumps(
                {"pipeline_version": PIPELINE_VERSION, "sha256": sha, "warnings": warnings},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )


def _chunk_row(chunk: ChunkRecord, version_id: int, settings: Settings) -> Chunk:
    retrieval = settings.retrieval
    return Chunk(
        id=chunk.id,
        version_id=version_id,
        document_id=chunk.document_id,
        key=chunk.key,
        chunk_type=chunk.chunk_type.value,
        article_number=chunk.article_number,
        number_source=chunk.number_source,
        section_path=chunk.section_path,
        heading=chunk.heading,
        definition_term=chunk.definition_term,
        page_start=chunk.page_start,
        page_end=chunk.page_end,
        language=chunk.language.value,
        text_original=chunk.text_original,
        context_header=chunk.context_header,
        text_retrieval=normalize_for_retrieval(
            chunk.embedding_text,
            ta_marbuta=retrieval.arabic_normalize_ta_marbuta,
            alef_maqsura=retrieval.arabic_normalize_alef_maqsura,
        ),
        part_index=chunk.part_index,
        part_count=chunk.part_count,
        parent_key=chunk.parent_key,
        cross_references=[ref.model_dump() for ref in chunk.cross_references],
        caveats=chunk.caveats,
        content_sha256=chunk.content_sha256,
        token_count=chunk.token_count,
    )
