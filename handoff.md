# Handoff — Jordan Import Compliance RAG

_Last updated: 2026-10-09, end of the second working session (retrieval tuning added at the end). Source of truth for decisions and
state. Read this first. Design details and their evidence: `docs/architecture.md`. Setup: `README.md`._

## 1. What this project is

An evidence-grounded, bilingual (Arabic/English) regulatory RAG platform for businesses importing
goods into Jordan. The key rules from the original product brief are in §7.

**Milestone scope (agreed):** scaffold → database → ingestion → bilingual hybrid retrieval with
tests, then **stop for owner review** before business profiles, generation and API.
**Status: the milestone is implemented and tested. We are at the review stop.**

**Owner decisions:**

| Topic | Decision |
|---|---|
| LLM provider | **Decide later.** No LLM calls exist; generation is not implemented. |
| Embeddings/reranking | Local open models, chosen by measurement on draft cases (`docs/architecture.md` §5): **`BAAI/bge-m3` primary** (beat `intfloat/multilingual-e5-large` on every set); **`BAAI/bge-reranker-v2-m3`** gives the best quality but is opt-in, because it takes ~28 s/query on CPU. All three models are in the Hugging Face cache. |
| Source documents | Both: Claude fetches from official sites; the owner adds documents they have. |
| Stop point | After retrieval + tests (reached). |

## 2. Environment

The project moved from Fedora/podman (session 1) to **Windows 11 + Docker Desktop** (session 2).

- **uv**: installed with `python -m pip install --user uv` (in
  `%APPDATA%\Python\Python314\Scripts`, which is not on PATH by default). Python **3.12.15** is
  uv-managed. `uv python install` here failed to create its minor-version junction; this was
  worked around with `uv venv --python %APPDATA%\uv\python\cpython-3.12.15-windows-x86_64-none\python.exe`.
  After that, `uv run …` works normally.
- **PostgreSQL 17 + pgvector 0.8.7**: container `icr-postgres` on `127.0.0.1:5433`, databases
  `icr` and `icr_test` (dev credentials `icr` / `icr_dev_password`). Start with
  `MSYS_NO_PATHCONV=1 bash scripts/dev_db.sh` from Git Bash.
- **Tesseract** (ara + eng) in image `localhost/icr-tesseract:latest` (built from
  `docker/ocr.Containerfile`). `.env` sets `ICR_OCR__CONTAINER_IMAGE`; the OCR adapter runs
  `docker run` itself, so no shell wrapper is needed. `scripts/tesseract_container.sh` still works on Linux.
- **bge-m3** is in the Hugging Face cache; use `HF_HUB_OFFLINE=1`. Torch is the CPU build
  (pytorch-cpu index). The machine has 32 threads, 64 GB RAM and an RTX 4070 (unused).
- Timings here: ingest of all 4 sources ≈ 48 s (Agriculture Law ≈ 43 s); bge-m3 embedding of
  ~200 chunks on CPU ≈ 80 s.
- `.env` is local (git-ignored). `.env.example` documents every setting.

## 3. Regulatory sources (real, official)

Registry: **`data/sources/registry.yaml`** (written this session; validated against
`SourceRegistryEntry`). Files are in `data/sources/raw/<id>/source.pdf` (git-ignored); their SHA-256
prefixes were re-verified this session. **The legal status of all four is `unknown`** until a human
verifies currency and amendments.

| id | Document | Lang | SHA-256 (12) | Extraction |
|---|---|---|---|---|
| `mit-import-export-law-21-2001` | Import and Export Law 21/2001 (Gazette 4494, p. 2453, 1/7/2001; amended by Law 18/2003) | ar | `6e9799434dc8` | font recovery, 3 pages, agreement ≥ 0.98 |
| `mit-import-export-licenses-system-114-2004` | Licences and Cards Bylaw 114/2004 (Gazette 4677, p. 4603, 30/9/2004; amended by Bylaw 58/2005) | ar | `66cc2f117a84` | font recovery, 4 pages, ≥ 0.98 |
| `moa-agriculture-law-13-2015` | Agriculture Law 13/2015 (Gazette 5337, p. 1868, 16/4/2015; amended by Laws 12/2017 and 2/2020) | ar | `d522d79735e9` | font recovery, 33 pages, ≥ 0.84 |
| `ustr-jordan-fta-rules-of-origin` | US–Jordan FTA Annex 2.2 Rules of Origin | en | `5438c7a9f4b1` | clean text layer, 5 pages |
| `trc-type-approval-instructions-2-2025` | TRC Type Approval Instructions No. 2/2025 (Official Gazette p. 4477; issue no. not verified) | ar | — | OCR + font recovery (pp. 4, 6); 24 articles, several numbers **inferred** from sequence |
| `trc-type-approval-annexes-2-2025` | Annexes 1–4: form, fees (25 / 50 JOD), exemptions, private use | ar | — | scanned, OCR only (confidence 42–83, flagged for review) |
| `trc-technical-standards-specifications` | TRC technical standards list (151 pp., ETSI/EN codes) | mixed | — | clean text layer |

TRC documents were added by Ahmad (2026-10-10). Spot-checks against the rendered pages confirmed the
fee amounts, Annex 3 item (و) "Wireless Mouse", Art. 5(b)(3)/(5) and 5(e), and the standards page
numbers; the label article is Art. 11. The TRC Instructions' text layer is mojibake that passed the old
quality check; a function-word ratio check (`text/quality.py`) now rejects such pages. Inline headings
("المادة (5): ...", OCR variants, tatweel) are parsed (`ingestion/structure.py`). `PIPELINE_VERSION` is
`2026.10.6`; the knowledge base holds 7 instruments / 572 passages embedded with bge-m3.

The amendment references come from the documents' own annotations, not from an independent check.
**Still needed:** JSMO technical regulations, JFDA food/cosmetics import requirements, the Customs
Law and the tariff (`traderepository.customs.gov.jo/english/document/Taariff_of_2021.pdf`, linked but
not downloaded). Dead links: JSMO Law 22/2000, JFDA Drug and Pharmacy Law. The owner may have PDFs.

## 4. Key technical findings

Findings 1–5 are from session 1 and still hold: corrupted text layers; tesseract silently dropping
lines; use `-l ara` not `ara+eng`; tesseract misreading bold Eastern numerals; font-cmap recovery
verified by OCR, with majority-vote corrections restricted to letter→letter and digit→`:`/`.`.

New in session 2 (details in `docs/architecture.md` §1–4):

6. **Same-name embedded and non-embedded fonts** made Law 21 clause numbers read ".0"/".1"
   instead of ".2"/".3". This is fixed by replaying the content stream with pdfminer to get the
   real font per glyph. A glyph-id heuristic was tried and rejected after it produced a coincidental
   false match in Bylaw 114.
7. **Line direction** depended on a tie. Presentation forms are now counted after NFKC, and lines
   without letters (dates) are LTR.
8. **Agriculture Law definition table** (Art. 2) is now reflowed into "term : definition"
   order. Session 1's known limitation §4.6 is resolved.
9. **Amendment notes quote superseded text** (e.g. Bylaw 114, Art. 12: old 5-dinar fee vs current
   15). These are split into `amendment_history` chunks and excluded from search by default.
10. **Plain RRF breaks cross-lingual retrieval**, because BM25 cannot match across languages. The
    dense rank is now imputed as the lexical rank for chunks in the other language.
11. `find_cross_references` had marked internal references as external when another law was named
    shortly after. Fixed.

## 5. Code state

Package `src/import_compliance_rag/`. `uv run ruff check src` passes. **`uv run pytest`: 66 passed**
(55 unit, 5 regression on the real PDFs, 4 integration against `icr_test`).

| Area | Files | State |
|---|---|---|
| Config/schemas | `config/`, `schemas/regulatory.py` | Done. Added: `OcrSettings.container_image/engine`, `ChunkType.AMENDMENT_HISTORY`, `ChunkRecord.number_source/definition_term/caveats`, `RetrievalSignal.lexical_rank_imputed`. |
| Text | `text/` | Done (unchanged). |
| Extraction | `ingestion/extract.py`, `font_recovery.py`, `ocr.py` | Done, run on all 4 PDFs and checked against rendered pages. |
| Structure | `ingestion/structure.py` | Done. Amendment history split; cross-reference fix. |
| Chunking | `ingestion/chunking.py` | Done. Corpus: 202 chunks; 0 inferred article numbers; 0 warnings. |
| Pipeline | `ingestion/pipeline.py` | Done. Registry load/sync, idempotent versioned ingest, artifacts in `data/derived/<doc>/<sha12>/`. `PIPELINE_VERSION = "2026.10.2"`. |
| Storage | `storage/models.py`, `db.py`, `migrations/` | Done. Alembic migration `0001`; models match the migrated schema. |
| Retrieval | `retrieval/embedder.py`, `lexical.py`, `fusion.py`, `references.py`, `indexing.py`, `search.py` | Done. **Default mode `dense`** + explicit article-reference resolution; hybrid (weighted, language-aware RRF) and lexical modes available; reranker opt-in. Dense falls back to lexical if no embeddings exist. |
| Evaluation | `evaluation/dataset.py`, `metrics.py`, `runner.py`; `data/eval/retrieval_cases.yaml`, `retrieval_cases_hard.yaml` | Done. **37 + 34 cases, all `draft`.** Tags, unanswerable cases and score-separation AUROC are supported. |
| CLI | `cli.py` (`import-compliance-rag …`) | `db-init`, `sources-sync`, `ingest`, `embed`, `search`, `eval-retrieval`. |
| Docs | `README.md`, `docs/architecture.md` | Done. |
| Web UI | `web/` (static UI), `src/import_compliance_rag/web/server.py` + `serve` CLI command | **MUTABIQ UI**, matching the MUTABIQ deck: Overview, an illustrative Assessment (DEMO-X1 sample data; TRC not indexed, so no real clauses are cited), live Evidence search, and Knowledge base. Original guide character built from the MUTABIQ mark (playful-web-experiences skill). Local read-only API on 127.0.0.1. Tests: `node --test web/js/core.test.mjs` (14), `tests/unit/test_web_server.py`. Checked with headless Chrome at 1280 and 375 px (layout, overflow, interactions, transitions, reduced motion, offline states) and WCAG AA contrast. |

The dev database `icr` contains the ingested corpus with bge-m3 embeddings. Eval runs are in
`data/eval/runs/` (git-ignored).

**Draft evaluation (indicative only; cases not reviewed), MRR on the hard set:** lexical 0.51,
e5-large dense 0.81, bge-m3 dense 0.86, equal-weight hybrid 0.78, **dense + references 0.91
(default)**, dense + references + reranker 0.96. The lexical component hurt paraphrases at every
weight tried. Retrieval scores alone do not reliably flag unanswerable questions (dense-score AUROC
0.81, reranker 0.95). Full table and reading in `docs/architecture.md` §5.

## 6. What is verified vs. not

Verified this session:
- Extraction of all 4 sources, checked against page renders where it mattered: clause numbers, headings
  (1–14, 1–16, 1–73 + 63 مكرر), the definitions table, dates.
- Idempotent ingest and versioning (re-ingest skips; forced reprocessing keeps ids; a changed file
  creates a new version; a revert re-activates the old one). Tested on `icr_test` and run on `icr`.
- Search returns citations with page, version hash and URL, plus caveats. Filters, history
  exclusion, expansion and cross-language imputation work. All covered by integration tests.

Not verified / not done:
- **Evaluation cases are drafts.** They need owner or expert review before any figure is quoted.
- Model, fusion and reranker choices rest on 63 draft answerable cases, written by the same author from
  the texts they query; small groups (2–5 cases) for the English-target directions.
- The reranker is too slow on CPU for interactive use; a CUDA torch build has not been tried.
- Legal status of all sources is unknown. No currency check against the Official Gazette has been done.
- Font recovery is verified per page by OCR agreement, not character by character; recovered text
  carries a caveat telling readers to check exact wording against the PDF.
- Tables inside recovered/OCR'd pages are not extracted as tables (none occur in the current corpus).
- Nothing new has been committed to git this session (only the session-1 commit exists).

## 7. Non-negotiable rules from the brief

- Never invent regulations, citations, URLs, evaluation results or integrations.
- Preserve original text; normalized text is for retrieval only. Distinguish binding vs guidance;
  record legal-status uncertainty; never present machine translation as official.
- Response language (`ar` / `en` / `ar_en`) must not change the assessment.
- Statuses: `required`, `potentially_applicable`, `insufficient_evidence`, `not_applicable`,
  `human_review_required`. No "fully compliant" claims; a file being present does not mean the document is valid.
- Multi-tenant isolation is mandatory; uploaded documents are untrusted and never become shared
  regulatory knowledge.
- No agent frameworks / LangChain; small replaceable components.

## 8. Next steps (after owner review)

1. Owner review: the registry entries, the draft evaluation cases (promote to `reviewed`), and
   spot-checks of the recovered Arabic text against the PDFs.
2. Evaluation written by people who have not read the texts (importers, trade lawyers), including
   multi-document questions, so that the retrieval choices in `docs/architecture.md` §5 can be
   confirmed or revised. Owner decision needed: switch to a CUDA torch build to make the reranker
   practical (GPU available), or keep it opt-in.
3. More sources (§3), especially the customs law and tariff (tables!), JSMO and JFDA, and verifying
   the legal status of existing ones.
4. Later phases from the brief: business and product profiles, tenancy (Postgres RLS), grounded
   generation behind a provider interface (LLM still to be chosen), API, security tests.

## 9. Prompt for the next session

> Read `handoff.md` first, then `docs/architecture.md`. The ingestion + retrieval milestone is done
> and at the owner-review stop. Ask the owner for review outcomes (registry, draft eval cases,
> spot-checks) before starting §8. Follow §7. Do not fabricate sources, citations or evaluation
> results; keep unreviewed eval cases `draft`.
