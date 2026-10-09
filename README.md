# Jordan Import Compliance RAG

Evidence-grounded, bilingual (Arabic/English) retrieval over Jordanian import regulations. Given a
question in Arabic or English, it returns the relevant provisions in their original language, with
citations (document, article, page, version hash, source URL) and the caveats a reader needs.

**Current milestone:** ingestion → bilingual hybrid retrieval → evaluation, with tests. Business
profiles, tenancy, answer generation and the API are later phases. No LLM is called anywhere yet.

See [`docs/architecture.md`](docs/architecture.md) for design decisions and their evidence, and
[`handoff.md`](handoff.md) for the project state and what comes next.

## What is in the corpus

| id | Document | Language |
|---|---|---|
| `mit-import-export-law-21-2001` | Import and Export Law No. 21 of 2001 (as amended) | ar |
| `mit-import-export-licenses-system-114-2004` | Import and Export Licences and Cards Bylaw No. 114 of 2004 | ar |
| `moa-agriculture-law-13-2015` | Agriculture Law No. 13 of 2015 (as amended) | ar |
| `ustr-jordan-fta-rules-of-origin` | US–Jordan FTA, Annex 2.2 Rules of Origin | en |

All four are real documents from official sites, listed with URLs and provenance in
[`data/sources/registry.yaml`](data/sources/registry.yaml). **Their legal status is `unknown`**: no
one has yet verified that they are current and complete. Every search result says so.

## Setup

Requirements: [uv](https://docs.astral.sh/uv/), Docker or Podman.

```bash
uv sync --extra ml            # Python 3.12 venv; --extra ml adds sentence-transformers + CPU torch
cp .env.example .env          # then adjust; never commit .env
```

**Database** (PostgreSQL 17 + pgvector, local dev credentials only):

```bash
bash scripts/dev_db.sh        # Git Bash on Windows: MSYS_NO_PATHCONV=1 bash scripts/dev_db.sh
uv run import-compliance-rag db-init
```

**OCR** (needed only for PDFs whose text cannot be recovered otherwise, and to verify recovered
text). Either install tesseract with Arabic data natively, or build the container image and point
the settings at it:

```bash
docker build -t localhost/icr-tesseract:latest -f docker/ocr.Containerfile docker
# .env: ICR_OCR__CONTAINER_IMAGE=localhost/icr-tesseract:latest
```

**Source files**: copies of the four official PDFs are in `pdfs/` (`<id>.pdf`). Ingestion reads them
from `data/sources/raw/<id>/source.pdf` (git-ignored), so copy them into place once:

```bash
for f in pdfs/*.pdf; do id=$(basename "$f" .pdf); mkdir -p "data/sources/raw/$id"; cp "$f" "data/sources/raw/$id/source.pdf"; done
```

Each file's SHA-256 prefix is listed in the registry's `provenance_note`; the originals are at each
`official_url`.

## Usage

```bash
uv run import-compliance-rag sources-sync                 # registry -> database
uv run import-compliance-rag ingest                       # extract, structure, chunk (idempotent)
uv run import-compliance-rag embed --model BAAI/bge-m3    # embeddings for active chunks
uv run import-compliance-rag search "ما هي رسوم اصدار رخصة الاستيراد؟"
uv run import-compliance-rag search "Is registration required to import pesticides?" --json
uv run import-compliance-rag eval-retrieval              # writes data/eval/runs/<run>.json
uv run import-compliance-rag eval-retrieval --cases data/eval/retrieval_cases_hard.yaml
```

Search defaults to dense retrieval (bge-m3) with explicit article-reference lookup ("المادة 9 من قانون
الاستيراد والتصدير"). Useful options: `--mode dense|hybrid|lexical`, `--rerank` (with
`ICR_RETRIEVAL__RERANKER_MODEL=BAAI/bge-reranker-v2-m3`; best quality, but slow on CPU), `--doc <id>`, `--type law`, `--lang ar`,
`--history` (include amendment notes, which can quote superseded wording), `--no-expand`.

Set `HF_HUB_OFFLINE=1` once the model is in the Hugging Face cache to avoid network calls.

## Web UI (MUTABIQ)

```bash
uv run import-compliance-rag serve        # http://127.0.0.1:8765/ (loads bge-m3 first, ~10 s)
```

A static front end in `web/` (plain HTML, CSS and ES modules; no build step), served together with a
read-only local JSON API (`/api/health`, `/api/search`, `/api/sources`) bound to 127.0.0.1. It follows
the MUTABIQ deck ("Every requirement, backed by evidence." / كل متطلب، له دليل.).

* **Overview**: the deck's story: problem, five-step solution, two inputs and two outputs, trust by
  design, and what this prototype does today versus what is illustrated.
* **Assessment**: the technical trial as an interactive flow (Inputs, Findings, Application) for the
  fictional DemoTel DEMO-X1 smartphone. **Illustrative**: sample data, and placeholder requirements for
  the TRC trial scope. TRC Instructions No. 2 of 2025 are not in the knowledge base, so no finding cites a
  real clause. Uses the deck's statuses: Supported, Missing evidence, Conflict, Needs verification,
  Not applicable.
* **Evidence search**: live retrieval over the knowledge base, with the original provisions,
  citations, nested definitions and referenced articles, and caveats; nothing is generated. Shared
  links re-run the search (`#/ask?q=...`).
* **Knowledge base**: the indexed instruments (live from the database, or from the registry file when
  the service is down), what is built versus planned, and the texts not indexed yet (TRC first).

Design: the deck's palette (navy `#0b2440`, teal `#17b8a6`, gold `#e3b04b`, light `#f4f7f6`), IBM Plex
Sans / Sans Arabic / Mono (SIL OFL, self-hosted woff2 in `web/fonts`), and an original guide character
drawn from the MUTABIQ mark, whose prop matches each page. Page changes use a short covered transition
(about 0.6 s) that the latest click always wins, with a timeout fallback. Reduced-motion preferences,
hidden tabs and the header's *Pause motion* control skip or stop decorative motion. Older links
(`#/dossier`) redirect. The UI must be served over HTTP: ES modules do not load from `file://`.

## Tests

```bash
uv run pytest            # all Python tests
node --test web/js/core.test.mjs   # UI logic: routing, navigation lifecycle, assessment rules
uv run pytest tests/unit # no database or PDFs needed
```

* `tests/unit`: normalization, quality checks, structure parsing, chunking, BM25, fusion, metrics,
  font-recovery layout logic, OCR invocation.
* `tests/regression`: defects found on the real PDFs (skipped if the PDFs are not downloaded).
* `tests/integration`: ingestion idempotency and versioning, embeddings, search with citations,
  filters and expansion against `ICR_TEST_DATABASE_URL` (skipped if the database is down).
  **The test database schema is dropped and recreated.**

## Evaluation status

`data/eval/retrieval_cases.yaml` (37 cases) and `retrieval_cases_hard.yaml` (34: paraphrases,
identifier lookups and unanswerable questions) cover ar→ar, en→ar, ar→en and en→en. **All are drafts**
written from the extracted texts and not yet reviewed by a domain expert, so results are
indicative only and reports carry a banner saying so. See `docs/architecture.md` for the latest
draft numbers and what they were used to decide.
