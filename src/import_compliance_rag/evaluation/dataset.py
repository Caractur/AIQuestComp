"""Retrieval evaluation cases.

Targets are version-independent: a document id plus an article (or treaty paragraph) number, so a
re-ingested or amended source does not invalidate the labels. ``grade`` allows graded relevance
(2 = directly answers, 1 = partially relevant / supporting).

Cases drafted from the texts by a model or a non-expert are ``review_status: draft`` until a domain
reviewer confirms them. Reports must never present draft results as validated.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from import_compliance_rag.schemas.regulatory import Language


class ReviewStatus(StrEnum):
    DRAFT = "draft"
    REVIEWED = "reviewed"


class RelevantTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    article_number: str | None = Field(
        None,
        description="None means the whole document is relevant; 'preamble' targets the text before "
        "the first article (e.g. a treaty annex footnote).",
    )
    grade: int = Field(1, ge=1, le=3)

    @property
    def unit(self) -> tuple[str, str | None]:
        return (self.document_id, self.article_number)


class EvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    query: str
    query_language: Language
    relevant: list[RelevantTarget] = Field(default_factory=list)
    # False for questions the corpus cannot answer; they have no relevant targets and are used to
    # see how retrieval scores separate answerable from unanswerable questions.
    answerable: bool = True
    tags: list[str] = Field(default_factory=list, description="e.g. paraphrase, identifier, negative")
    review_status: ReviewStatus = ReviewStatus.DRAFT
    notes: str | None = None

    @model_validator(mode="after")
    def _targets_match_answerability(self) -> EvalCase:
        if self.answerable and not self.relevant:
            raise ValueError(f"{self.id}: answerable cases need at least one relevant target")
        if not self.answerable and self.relevant:
            raise ValueError(f"{self.id}: unanswerable cases must not list relevant targets")
        return self

    @field_validator("query_language")
    @classmethod
    def _concrete_language(cls, value: Language) -> Language:
        if value not in (Language.AR, Language.EN):
            raise ValueError("query_language must be 'ar' or 'en'")
        return value


class EvalDataset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    description: str | None = None
    cases: list[EvalCase]

    @field_validator("cases")
    @classmethod
    def _unique_ids(cls, cases: list[EvalCase]) -> list[EvalCase]:
        ids = [c.id for c in cases]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"duplicate case ids: {sorted(duplicates)}")
        return cases


def load_cases(path: Path) -> EvalDataset:
    return EvalDataset.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
