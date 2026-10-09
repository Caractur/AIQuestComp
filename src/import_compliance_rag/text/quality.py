"""Detect corrupted PDF text layers before they reach the index.

Official Jordanian PDFs are frequently exported from Word with broken font-to-Unicode maps. The
text layer then looks plausible to a machine but is wrong: the لا ligature comes out reversed
(``االستيراد`` instead of ``الاستيراد``), digits are scrambled (``لسنة1002`` for 2001), or the
whole page is legacy-encoded mojibake. Article numbers from such a layer cannot be cited, so the
page must be OCR'd instead.

Signals (all computed over Arabic-script tokens):

* reversed lam-alef: tokens starting with ``اال`` (optionally after a one-letter proclitic).
  Practically no valid Arabic word starts this way.
* malformed tokens: a combining mark at the start of a token, digits glued inside letters, or
  characters from the U+0656..U+065F range that do not occur in Modern Standard Arabic prose.

For Latin text the signals are ``(cid:NN)`` glyph placeholders and U+FFFD replacement characters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_ARABIC_TOKEN = re.compile(r"\S*[؀-ۿ]\S*")
_REVERSED_LAM_ALEF = re.compile(r"^[وفبكل]?اال")
_LEADING_MARK = re.compile(r"^[ً-ٰٟ]")
_DIGIT_INSIDE_LETTERS = re.compile(r"[ء-ي][0-9٠-٩]+[ء-ي]")
_RARE_MARKS = re.compile(r"[ٖ-ٟ]")
_CID = re.compile(r"\(cid:\d+\)")

REVERSED_LAM_ALEF_WEIGHT = 20.0


@dataclass(frozen=True)
class TextQuality:
    score: float  # 1.0 = no corruption signals, 0.0 = unusable
    arabic_tokens: int
    reversed_lam_alef: int
    malformed_tokens: int
    replacement_chars: int
    reasons: list[str] = field(default_factory=list)


def assess_text_layer(text: str) -> TextQuality:
    tokens = _ARABIC_TOKEN.findall(text)
    reversed_la = sum(1 for t in tokens if _REVERSED_LAM_ALEF.match(t))
    malformed = sum(
        1
        for t in tokens
        if _LEADING_MARK.match(t) or _DIGIT_INSIDE_LETTERS.search(t) or _RARE_MARKS.search(t)
    )
    replacement = text.count("�") + len(_CID.findall(text))

    penalties: list[float] = []
    reasons: list[str] = []
    if tokens:
        la_rate = reversed_la / len(tokens)
        bad_rate = malformed / len(tokens)
        penalties += [la_rate * REVERSED_LAM_ALEF_WEIGHT, bad_rate]
        if reversed_la:
            reasons.append(f"reversed lam-alef in {reversed_la}/{len(tokens)} tokens")
        if malformed:
            reasons.append(f"malformed Arabic in {malformed}/{len(tokens)} tokens")
    visible = max(1, len(text.strip()))
    if replacement:
        penalties.append(replacement * 5 / visible * 10)
        reasons.append(f"{replacement} replacement or (cid) glyphs")
    if not text.strip():
        reasons.append("empty text layer")
        return TextQuality(0.0, 0, 0, 0, 0, reasons)

    score = max(0.0, 1.0 - sum(penalties))
    return TextQuality(round(score, 4), len(tokens), reversed_la, malformed, replacement, reasons)
