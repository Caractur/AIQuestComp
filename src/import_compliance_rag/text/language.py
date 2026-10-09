"""Script-based language identification.

The corpus is Arabic and English only, so counting letters by script is sufficient and fully
deterministic. A statistical detector would be needed only if other languages enter the corpus.
"""

from __future__ import annotations

from import_compliance_rag.schemas.regulatory import Language
from import_compliance_rag.text.arabic import ARABIC_LETTER, LATIN_LETTER

DOMINANCE = 0.8


def detect_language(text: str, min_letters: int = 3) -> Language:
    arabic = len(ARABIC_LETTER.findall(text))
    latin = len(LATIN_LETTER.findall(text))
    total = arabic + latin
    if total < min_letters:
        return Language.UNKNOWN
    if arabic / total >= DOMINANCE:
        return Language.AR
    if latin / total >= DOMINANCE:
        return Language.EN
    return Language.MIXED
