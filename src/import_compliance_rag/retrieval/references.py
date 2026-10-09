"""Explicit article references in queries ("المادة 13 من نظام رخص ...", "Article 11 of the ... Law").

When a query names an article *and* an instrument, the user wants that provision; similarity search
may not rank it first (article numbers are weak lexical evidence: "13" also occurs in the title of
Agriculture Law No. 13, which every chunk of that law carries in its header). The instrument is
resolved by token overlap with registry titles, and only when the match is unambiguous.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from import_compliance_rag.retrieval.lexical import tokenize
from import_compliance_rag.text.arabic import normalize_digits

_AR_REFERENCE = re.compile(r"(?:ال)?ماد(?:ة|ه)\s*\(?\s*([0-9٠-٩]{1,3})\s*\)?\s*(مكرر)?")
_EN_REFERENCE = re.compile(r"\b(?:article|art\.|paragraph|para\.)\s*(\d{1,3})\b", re.I)
MIN_TITLE_OVERLAP = 2
_INSTRUMENT_TYPES = frozenset(
    tokenize("قانون نظام تعليمات اتفاقية قرار law bylaw regulation instructions agreement annex decision")
)


@dataclass(frozen=True)
class ArticleReference:
    article_number: str  # as stored in chunks: "13", "63 مكرر"
    remainder: str  # the query with the reference removed, used to identify the instrument


def parse_article_reference(query: str) -> ArticleReference | None:
    """The single article reference in ``query``; None when there is none or more than one."""
    matches = [(m, True) for m in _AR_REFERENCE.finditer(query)] + [(m, False) for m in _EN_REFERENCE.finditer(query)]
    if len(matches) != 1:
        return None
    match, arabic = matches[0]
    number = normalize_digits(match.group(1)).lstrip("0") or "0"
    if arabic and match.group(2):
        number = f"{number} مكرر"
    remainder = (query[: match.start()] + " " + query[match.end() :]).strip()
    return ArticleReference(number, remainder)


def resolve_instrument(remainder: str, titles: dict[str, str]) -> str | None:
    """Document id whose title shares the most tokens with ``remainder``, if unambiguous.

    The shared tokens must include the instrument type (قانون, نظام, Law, Annex, ...) or a number from
    the title (instrument number or year): topic words alone ("رخصة الاستيراد") describe a subject that
    several instruments regulate, not an instrument.
    """
    query_tokens = set(tokenize(remainder))
    if not query_tokens:
        return None
    scored = []
    for doc_id, title in titles.items():
        shared = query_tokens & set(tokenize(title))
        names_instrument = any(t in _INSTRUMENT_TYPES or t[0].isdigit() for t in shared)
        scored.append((len(shared) if names_instrument else 0, doc_id))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < MIN_TITLE_OVERLAP:
        return None
    if len(scored) > 1 and scored[1][0] == scored[0][0]:
        return None
    return scored[0][1]
