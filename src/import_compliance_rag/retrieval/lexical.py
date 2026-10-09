"""Lexical retrieval: Arabic-aware tokenization and Okapi BM25.

Tokenization works on ``normalize_for_retrieval`` output (diacritics removed, alef variants and
digits unified, ة→ه, ى→ي) and then applies light Arabic stemming: common proclitics (ال, وال, بال,
كال, فال, لل) and a few inflectional suffixes are stripped when a stem of at least three letters
remains. This is deliberately conservative; it is not a morphological analyzer.

Numbers are kept as tokens because article numbers, years and HS codes are high-value query terms.
Dotted HS codes ("2009.11") also index their heading ("2009") so a heading query matches
subheadings.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from import_compliance_rag.text.arabic import normalize_for_retrieval

_TOKEN = re.compile(r"\d+(?:\.\d+)*|[^\W\d_]+")
_ARABIC_WORD = re.compile(r"^[ء-ي]+$")
_PREFIXES = ("وال", "فال", "بال", "كال", "لل", "ال")
_SUFFIXES = ("ات", "ون", "ين", "ان", "ها", "يه", "ه", "ي")
MIN_STEM = 3

# Function words only (after normalization). Content words are left to IDF.
_STOPWORDS = frozenset(
    """
    في من على الي عن او و ان ما لا لم لن هذا هذه ذلك تلك التي الذي الذين اللذين كل اي اذا اذ قد ثم
    كما مع بين عند غير حيث بما به بها له لها منه منها فيه فيها عليه عليها هو هي هم كان كانت يكون
    the a an of to in on for and or by with as at from that this these those is are be been was
    were it its any such which who shall may not no under into than other
    """.split()
)


def light_stem(word: str) -> str:
    if not _ARABIC_WORD.match(word):
        return word[:-1] if len(word) > 4 and word.endswith("s") and not word.endswith("ss") else word
    # A bare "و" proclitic is not stripped: it is too often a root letter ("وزارة", "وثيقة").
    for prefix in _PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) >= MIN_STEM:
            word = word[len(prefix) :]
            break
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= MIN_STEM:
            return word[: -len(suffix)]
    return word


def tokenize(text: str, normalized: bool = False) -> list[str]:
    if not normalized:
        text = normalize_for_retrieval(text)
    tokens: list[str] = []
    for raw in _TOKEN.findall(text):
        if raw[0].isdigit():
            tokens.append(raw)
            if "." in raw:
                tokens.append(raw.split(".", 1)[0])
            continue
        if raw in _STOPWORDS:
            continue
        stem = light_stem(raw)
        if stem not in _STOPWORDS:
            tokens.append(stem)
    return tokens


@dataclass(frozen=True)
class LexicalHit:
    doc_id: str
    score: float


class BM25Index:
    def __init__(self, docs: dict[str, list[str]], k1: float = 1.2, b: float = 0.75) -> None:
        self.k1, self.b = k1, b
        self._tf = {doc_id: Counter(tokens) for doc_id, tokens in docs.items()}
        self._len = {doc_id: len(tokens) for doc_id, tokens in docs.items()}
        self._avg = (sum(self._len.values()) / len(self._len)) if self._len else 0.0
        df: Counter[str] = Counter()
        for tf in self._tf.values():
            df.update(tf.keys())
        n = len(self._tf)
        self._idf = {term: math.log(1 + (n - f + 0.5) / (f + 0.5)) for term, f in df.items()}
        self._postings: dict[str, list[str]] = {}
        for doc_id, tf in self._tf.items():
            for term in tf:
                self._postings.setdefault(term, []).append(doc_id)

    def __len__(self) -> int:
        return len(self._tf)

    def search(self, query_tokens: list[str], top_k: int, allowed: set[str] | None = None) -> list[LexicalHit]:
        scores: dict[str, float] = {}
        for term in set(query_tokens):
            idf = self._idf.get(term)
            if idf is None:
                continue
            for doc_id in self._postings[term]:
                if allowed is not None and doc_id not in allowed:
                    continue
                tf = self._tf[doc_id][term]
                norm = self.k1 * (1 - self.b + self.b * self._len[doc_id] / (self._avg or 1))
                scores[doc_id] = scores.get(doc_id, 0.0) + idf * tf * (self.k1 + 1) / (tf + norm)
        ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:top_k]
        return [LexicalHit(doc_id, round(score, 6)) for doc_id, score in ranked]
