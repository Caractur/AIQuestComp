from __future__ import annotations

from pathlib import Path

import pytest

from import_compliance_rag.config.settings import Settings

ROOT = Path(__file__).resolve().parents[1]
RAW_SOURCES = ROOT / "data" / "sources" / "raw"


def raw_pdf(document_id: str) -> Path:
    path = RAW_SOURCES / document_id / "source.pdf"
    if not path.is_file():
        pytest.skip(f"source PDF not downloaded: {path}")
    return path


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = Settings().test_database_url
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(url)
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        engine.dispose()
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"test database unavailable ({exc.__class__.__name__}); start it with scripts/dev_db.sh")
    return url
