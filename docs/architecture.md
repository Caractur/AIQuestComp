# Architecture

Status as of 2026-10-09 (pipeline version `2026.10.2`). Components are small and replaceable; there
is no agent framework and no LLM call anywhere in this phase.

```
registry.yaml ──► sources-sync ──► source_documents
raw PDFs ──► extract ──► structure ──► chunk ──► document_versions / chunks ──► embed ──► chunk_embeddings
                                                                │                         │
query ──► filters ──► BM25 (Python, cached) ─┐                  │                         │
                └──► pgvector cosine ────────┴► language-aware RRF ► dedupe ► (rerank) ► expand ► EvidencePackage
```

## 1. Extraction (`ingestion/extract.py`, `font_recovery.py`, `ocr.py`)

Official Jordanian PDFs are often Word exports with a broken ToUnicode map. Their text layer looks
plausible and is wrong: reversed لا, scrambled digits, or legacy mojibake. `text/quality.py`
detects this. Per page, the extractor tries, in order:

1. **The text layer**, if it passes the quality check.
2. **Font recovery.** Each drawn glyph is decoded through the embedded TrueType font's own cmap,
   which is intact even when the PDF's ToUnicode is not. The result is verified against an
   independent OCR pass and accepted only at ≥ 0.75 agreement. This recovers Eastern Arabic
   numerals that OCR cannot read.
3. **OCR** (tesseract, `-l ara` for Arabic documents), with line-band OCR so dropped lines are
   detected.

All 45 pages of the three Arabic documents currently go through font recovery, with OCR agreement
of 0.84–0.998.

Defects found and fixed in this session, each pinned by `tests/regression/test_real_sources.py`:

* **Same-name fonts.** A page can carry an embedded Type0 "Times New Roman" and a non-embedded
  simple "Times New Roman". Span names do not say which font object drew a glyph, and the width
  check cannot separate equal-width glyphs (all digits in Times). Law 21 clause numbers ".2" and
  ".3" were read as ".0" and ".1". A glyph-id heuristic (substitute glyph order) was tried and
  rejected: in Bylaw 114 an embedded '2' (gid 21) is labelled '4', and gid 21 is also '4' in the
  substitute, so it matched by coincidence. The fix replays the page's content stream with pdfminer,
  which reports the actual font object per glyph, and matches glyphs by origin.
* **Reading direction.** Font-decoded glyphs are presentation forms (U+FBxx–U+FExx), which the
  Arabic letter regex does not match. Lines were RTL only through a 0 ≥ 0 tie. Letters are now
  counted after NFKC, and lines without Arabic letters (dates) are LTR.
* **Borderless definition tables** (Agriculture Law, Art. 2, pp. 1–4). Each term is vertically
  centred on its multi-line definition, so line-by-line reading put it between definition lines.
  The reflow detects an aligned colon column, groups definition lines into rows by line pitch,
  and attaches each (possibly wrapped) term to the row it is centred on. It runs only when some
  line holds a bare "term :". Colons that merely line up, as in Law 21 and Bylaw 114, are left
  alone. Two discriminators were tried and fell short before the current one (see code comments).
  OCR agreement on p. 2 drops to 0.84 because OCR still reads the staggered order.

The OCR adapter can run tesseract natively or in the `docker/ocr.Containerfile` image
(`ICR_OCR__CONTAINER_IMAGE`). The container mode is portable to Windows and needs no shell wrapper.

## 2. Structure and chunking (`ingestion/structure.py`, `chunking.py`)

* Articles (`المادة n`, Eastern or Western digits, `مكرر`) and treaty paragraphs are parsed. Every
  number records `parsed` or `inferred`; inferred numbers carry a caveat into citations. The
  current corpus has **0 inferred** numbers.
* **Amendment history is separated from current text.** Consolidated texts append notes
  ("-هكذا اصبحت ... حيث كان نصها كما يلي:") that quote superseded wording. In Bylaw 114, Art. 12,
  the current card fee is 15 dinars and the note quotes the old 5 dinars. Notes become
  `amendment_history` chunks, excluded from search unless `include_history` is set.
* One chunk per article when it fits (`max_tokens` = 450 whitespace tokens). Longer articles split
  at clause boundaries; the lead-in stays in part 1 and is repeated in the `context_header` of
  later parts. Clauses that are too long fall back to overlapping windows.
* Definitions are split per term, with the lead-in kept once. This enables definition expansion.
* Tables (only from trustworthy text layers) become Markdown with the header repeated per part.
* Ids are `{doc}@{sha12}#{key}` (`art-12`, `art-12.p2`, `art-2.def-5`, `art-12.hist`,
  `art-63-bis`, `para-9.p1`). They are stable for a given source file.
* `text_original` is what gets cited. The `context_header` (title | article | heading) is prepended
  only for embedding and lexical indexing. `text_retrieval` is the normalized form; it is never shown.

Trade-off: token counts are whitespace words, not model tokens. That's fine at bge-m3's 8k context
(embedding input is capped at 2,048 model tokens), but a smaller-context model would need real
tokenization.

## 3. Storage (`storage/`)

`source_documents` mirrors the registry. `document_versions` has one row per (document, SHA-256);
a partial unique index allows only one active version per document. `chunks` holds both texts plus
metadata. `chunk_embeddings` uses an **untyped** `vector` column keyed by (chunk, model), so
models of different dimensions can sit side by side. Migrations: Alembic, shipped inside the package.

Ingestion is idempotent:
* same file and same pipeline version → skip (re-activate the version if a revert happened);
* same file and newer pipeline → reprocess in place (same chunk ids);
* new file → new active version, old versions kept inactive.

Re-processing currently drops that version's embeddings (cascade). They are recomputed by `embed`;
preserving embeddings for unchanged chunk text is a possible optimisation.

There is no ANN index: exact cosine search over ~200 chunks takes milliseconds. At scale, add a
partial HNSW index per model on `embedding::vector(<dim>)`.

## 4. Retrieval (`retrieval/`)

**Default: dense (bge-m3) + explicit article-reference resolution**, with the cross-encoder reranker as
an opt-in quality step. Hybrid and lexical modes remain available (`--mode`, `ICR_RETRIEVAL__DEFAULT_MODE`).
How this was chosen is in §5.

* **Dense:** local `BAAI/bge-m3` (1024-d, normalized, cosine), via a small `Embedder` interface.
  `HashingEmbedder` is a deterministic stand-in for tests only. If no embeddings exist for the
  configured model, dense mode falls back to lexical retrieval and warns.
* **Article references.** When a query names an article *and* an instrument ("المادة 13 من نظام رخص
  وبطاقات الاستيراد والتصدير", "Article 11 of the Import and Export Law No. 21 of 2001"), that article is
  ranked first (`exact_reference` in the signal). The instrument is matched by token overlap with
  registry titles (article number excluded). It resolves only when unambiguous: at least 2 shared
  tokens including the instrument type or a title number/year, and a unique best match. Topic words
  alone ("رخصة الاستيراد") never pin an instrument. This was needed because article numbers are weak
  similarity evidence: "13" is also in the title of Agriculture Law No. 13, which every chunk of that
  law carries in its header.
* **Lexical:** BM25 (k1 1.2, b 0.75) over normalized text. It uses light Arabic stemming (proclitics
  ال/وال/بال/كال/فال/لل and a few suffixes, minimum stem of 3 letters; a bare و is *not* stripped,
  because وزارة → زار would split one word into two stems), numbers kept as tokens, and HS headings
  indexed from dotted codes. The index is built in memory from active chunks and cached until the
  set of active versions changes.
* **Hybrid mode: language-aware weighted RRF** (k = 60, `lexical_weight`). BM25 is monolingual, so a
  chunk in another language than the query cannot match lexically, and plain RRF counts that as a
  miss: plain fusion dropped ar→en from MRR 1.00 (dense alone) to **0.00**. For other-language
  chunks, the dense rank stands in for the missing lexical rank (`lexical_rank_imputed`).
* Exact-duplicate texts are removed (same content hash only).
* **Reranker** (opt-in, `ICR_RETRIEVAL__RERANKER_MODEL=BAAI/bge-reranker-v2-m3`, CLI `--rerank`):
  rescores the top 30 candidates, with input capped at 1,024 tokens. It gives the best quality
  measured (§5) but costs about 28 s per query on this CPU (32 threads), which is not interactive.
  It needs a GPU build of torch to be practical (the machine has an RTX 4070; the project currently
  pins CPU torch).
* **Expansion** marks every added item with its relation to the retrieved item: sibling parts of a
  split article, internally cross-referenced articles (up to 2 per item), and definitions of terms
  used (most specific first, up to 2 per item and 6 in total).
* **Evidence package:** citations come from stored metadata only. Caveats cover unverified legal
  status, font-recovered or OCR'd text, pages flagged for review, inferred numbers, amendment
  history, non-binding sources and unverified translations.
* Query translation and glossary expansion are not implemented. Cross-lingual retrieval relies on
  bge-m3.

## 5. Evaluation (`evaluation/`)

Targets are version-independent (document + article, or `preamble`). Metrics: Recall@k,
Precision@k, MRR and nDCG@k (graded, exponential gain), reported per direction (ar→ar, en→ar, ar→en,
en→en) and per tag. Unanswerable cases (`answerable: false`) are scored differently: the report
gives the AUROC of each top score (dense, rerank, lexical) for telling answerable from unanswerable
questions. Reports carry a DRAFT banner unless every case is `reviewed`.

Two case sets, **all drafts written by Claude, not reviewed. The figures below are indicative only**:

* `retrieval_cases.yaml`: 37 cases whose wording largely echoes the target article (easy).
* `retrieval_cases_hard.yaml`: 34 cases, made up of 18 paraphrases using everyday wording, 8
  identifier lookups (article numbers, fee amounts, HS codes, repealed-law numbers) and 8 unanswerable
  questions (tariff rates, JSMO, JFDA, sales tax, other agreements).

Results (2026-10-09, bge-m3 unless noted, top 10; `data/eval/runs/experiment-20261009T191004Z.json`):

| configuration | easy MRR | hard MRR | hard paraphrase | hard identifier | hard R@3 | unanswerable AUROC |
|---|---|---|---|---|---|---|
| lexical | 0.568 | 0.509 | 0.388 | 0.781 | 0.519 | 0.53 (BM25 score) |
| e5-large dense | 0.963 | 0.814 | 0.880 | 0.667 | 0.904 | 0.77 |
| bge-m3 dense | 0.987 | 0.857 | 0.903 | 0.754 | 0.904 | 0.81 |
| hybrid, lexical weight 1 | 0.973 | 0.777 | 0.771 | 0.792 | 0.865 | 0.81 |
| hybrid, weight 0.25 | 0.987 | 0.813 | 0.795 | 0.854 | 0.942 | 0.81 |
| **dense + references (default)** | 0.987 | 0.913 | 0.903 | 0.938 | 0.942 | 0.81 |
| hybrid 0.25 + references | 0.987 | 0.839 | 0.795 | 0.938 | 0.942 | 0.81 |
| dense + references + reranker | 1.000 | **0.962** | **0.944** | **1.000** | **0.981** | **0.95** (rerank score) |

How to read it:

* **bge-m3 over e5-large**: better on every set, most of all for hard Arabic→English (0.75 vs 0.17).
  e5-large also truncates input at 512 tokens.
* **The lexical component hurts paraphrases at every weight tried**, and its benefit on identifiers
  is smaller than what explicit reference resolution gives. Hence dense is the default.
* **The reranker is clearly best**, both for ranking and for separating unanswerable questions.
  Its CPU latency is the blocker (§4).
* **Unanswerable detection needs more than retrieval similarity.** With dense scores, a topically
  close unanswerable question (EU-agreement rules of origin → US–Jordan rules of origin, 0.64) outscores
  many answerable ones (minimum 0.48). The reranker separates better but not perfectly: answerable
  min 0.02, unanswerable max 0.26. A future `insufficient_evidence` decision should not rest on a
  similarity threshold alone.
* Remaining misses with dense + references are near-misses: an adjacent treaty paragraph ranked
  above the right one, which still appears in the top 4.

Caveats: 63 answerable cases in total, written by the same author from the texts they query. The
ar→en and en→en groups have only 2–5 hard cases each. A reviewed set, ideally with questions written
by importers or trade lawyers who have not read the texts, is needed before these numbers support
claims.
