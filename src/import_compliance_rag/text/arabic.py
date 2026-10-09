"""Arabic/English text handling.

Two representations are kept for every piece of regulatory text:

* ``clean_original`` — the extracted text with only invisible artifacts removed (bidi control marks,
  stray whitespace). This is what citations show and must stay faithful to the source.
* ``normalize_for_retrieval`` — an aggressive, lossy form used only for lexical matching. It is
  never shown to users and never used as citation text.
"""

from __future__ import annotations

import re
import unicodedata

# Bidi controls and zero-width characters inserted by PDF tools and OCR engines.
_INVISIBLE = re.compile("[​-‏‪-‮⁦-⁩﻿]")
_TATWEEL = "ـ"
# Harakat, tanween, shadda, sukun, Quranic marks and dagger alef.
_DIACRITICS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭ]")
_ALEF_VARIANTS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا"})
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_PUNCT = str.maketrans({"،": ",", "؛": ";", "؟": "?", "٪": "%", "«": '"', "»": '"'})
_SPACES = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")

ARABIC_LETTER = re.compile("[ء-يٱ-ۓ]")
LATIN_LETTER = re.compile("[A-Za-z]")


def clean_original(text: str) -> str:
    """Remove invisible artifacts without changing any visible character."""
    text = _INVISIBLE.sub("", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def normalize_digits(text: str) -> str:
    """Map Eastern Arabic and Persian digits to ASCII digits."""
    return text.translate(_DIGITS)


def normalize_for_retrieval(
    text: str, *, ta_marbuta: bool = True, alef_maqsura: bool = True
) -> str:
    """Lossy normalization for lexical retrieval only.

    Unicode NFKC folds Arabic presentation forms (including the لا ligature) into base letters.
    Hamza on waw/ya (ؤ, ئ) is deliberately preserved: folding it merges unrelated words.
    """
    text = unicodedata.normalize("NFKC", text)
    text = _INVISIBLE.sub("", text)
    text = text.replace(_TATWEEL, "")
    text = _DIACRITICS.sub("", text)
    text = text.translate(_ALEF_VARIANTS).translate(_DIGITS).translate(_PUNCT)
    if ta_marbuta:
        text = text.replace("ة", "ه")
    if alef_maqsura:
        text = text.replace("ى", "ي")
    text = text.lower()
    return _SPACES.sub(" ", text).strip()
