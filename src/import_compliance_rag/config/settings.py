"""Environment-based configuration. Values come from ICR_* environment variables or a .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class OcrSettings(BaseModel):
    tesseract_cmd: str = "tesseract"
    dpi: int = Field(300, ge=150, le=600)
    languages: str = "ara+eng"  # used when the document language is unknown
    page_segmentation_mode: int = 6
    timeout_seconds: int = 300
    # Flag a page when OCR returns fewer lines than this fraction of the text layer's visual lines.
    min_line_coverage: float = 0.9
    # Font recovery is accepted for a page only if it agrees with independent OCR at least this much.
    min_recovery_agreement: float = 0.75
    verification_dpi: int = 200


class ChunkingSettings(BaseModel):
    # Token counts are approximate (whitespace tokens); see docs/architecture.md for the trade-offs.
    max_tokens: int = Field(450, ge=64)
    min_tokens: int = Field(40, ge=0)
    fallback_overlap_tokens: int = Field(60, ge=0)
    table_max_rows: int = Field(25, ge=1)


class TextQualitySettings(BaseModel):
    # A page whose text layer scores below this is re-extracted with OCR (when OCR is available).
    min_page_quality: float = Field(0.85, ge=0.0, le=1.0)


class RetrievalSettings(BaseModel):
    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cpu"
    embedding_batch_size: int = 8
    reranker_model: str | None = None
    dense_top_k: int = 40
    lexical_top_k: int = 40
    rrf_k: int = 60
    final_top_k: int = 10
    expand_related: bool = True
    arabic_normalize_ta_marbuta: bool = True
    arabic_normalize_alef_maqsura: bool = True


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ICR_", env_nested_delimiter="__", env_file=".env", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://icr:icr_dev_password@127.0.0.1:5433/icr"
    test_database_url: str = "postgresql+psycopg://icr:icr_dev_password@127.0.0.1:5433/icr_test"
    data_dir: Path = Path("data")
    log_level: str = "INFO"
    log_json: bool = True

    ocr: OcrSettings = OcrSettings()
    chunking: ChunkingSettings = ChunkingSettings()
    text_quality: TextQualitySettings = TextQualitySettings()
    retrieval: RetrievalSettings = RetrievalSettings()

    @property
    def source_registry_path(self) -> Path:
        return self.data_dir / "sources" / "registry.yaml"

    @property
    def raw_sources_dir(self) -> Path:
        return self.data_dir / "sources" / "raw"

    @property
    def derived_dir(self) -> Path:
        return self.data_dir / "derived"


@lru_cache
def get_settings() -> Settings:
    return Settings()
