"""Engine/session helpers and schema migration entry point."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


@lru_cache(maxsize=8)
def get_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True)


@contextmanager
def session_scope(url: str) -> Iterator[Session]:
    """A transactional session: committed on success, rolled back on error."""
    session = sessionmaker(bind=get_engine(url), expire_on_commit=False)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def upgrade_schema(url: str, revision: str = "head") -> None:
    """Apply Alembic migrations (creates the pgvector extension and all tables)."""
    from alembic import command
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["database_url"] = url
    command.upgrade(config, revision)
