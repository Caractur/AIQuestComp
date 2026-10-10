# MUTABIQ (مُطابِق): Jordan Import Compliance, backed by evidence

**Team ZAA, AI Quest 2026.** _Every requirement, backed by evidence. كل متطلب، له دليل._

MUTABIQ helps a business that imports a regulated product into Jordan find the rules that apply,
check each requirement against its evidence, and prepare the application for the authority. Each
finding points to a real article in an official text. The authority still makes the decision.

This repository has two parts:

1. **A working bilingual (Arabic/English) retrieval engine** over seven official Jordanian texts:
   import law, import licensing bylaw, agriculture law, US–Jordan FTA rules of origin, and the TRC
   type-approval instructions, annexes and technical standards. It extracts and repairs the PDFs, splits them
   into articles, definitions and amendment notes, embeds them with `BAAI/bge-m3`, and returns the
   original provisions with full citations (document, article, page, file hash, source URL).
2. **The MUTABIQ web app**: overview, an interactive TRC type-approval assessment for a smartphone,
   live evidence search, and the knowledge base.

| | |
|---|---|
| Presentation | [`docs/MUTABIQ-presentation.pdf`](docs/MUTABIQ-presentation.pdf) |
| Design decisions and measurements | [`docs/architecture.md`](docs/architecture.md) |
| Project state and decisions log | [`handoff.md`](handoff.md) |

---

## Contents

1. [Quick start: run the demo](#1-quick-start-run-the-demo)
2. [Demo walkthrough](#2-demo-walkthrough)
3. [What is real and what is illustrative](#3-what-is-real-and-what-is-illustrative)
4. [Requirements](#4-requirements)
5. [Troubleshooting](#5-troubleshooting)
6. [How it works](#6-how-it-works)
7. [Project structure](#7-project-structure)
8. [Command-line reference](#8-command-line-reference)
9. [HTTP API](#9-http-api)
10. [Rebuilding the knowledge base from the PDFs](#10-rebuilding-the-knowledge-base-from-the-pdfs)
11. [Configuration](#11-configuration)
12. [Tests and evaluation](#12-tests-and-evaluation)
13. [Limitations](#13-limitations)

---

## 1. Quick start: run the demo

You need **Git**, **Docker** (Docker Desktop on Windows/macOS, with the engine running) and
**[uv](https://docs.astral.sh/uv/getting-started/installation/)** (the Python package manager; it
downloads Python 3.12 by itself). Details in [§4](#4-requirements).

```bash
git clone https://github.com/Caractur/AIQuestComp.git
cd AIQuestComp
docker compose up -d --wait          # PostgreSQL + pgvector, pre-loaded with the knowledge base
uv sync --extra ml                   # Python 3.12 environment with the embedding model runtime
uv run import-compliance-rag serve   # starts the app
```

Then open **http://127.0.0.1:8765/**.

The same commands work in PowerShell, Command Prompt, Git Bash, macOS Terminal and Linux shells.

What to expect:

* `docker compose up` creates the database and restores [`db/icr_snapshot.sql.gz`](db/) on its
  first start (a few seconds). It already contains the 7 indexed instruments, 572 passages and their
  embeddings, so **no OCR, ingestion or embedding run is needed**.
* `uv sync --extra ml` downloads several hundred MB of packages (PyTorch CPU build, sentence-transformers, transformers).
* On its **first start**, `serve` downloads the `BAAI/bge-m3` embedding model from Hugging Face
  (about 2.3 GB, cached under `~/.cache/huggingface`). Later starts take about 10 seconds. The app is
  ready when the terminal prints `MUTABIQ UI on http://127.0.0.1:8765/`.
* Stop the app with `Ctrl+C`. Stop the database with `docker compose down`, or delete it
  with `docker compose down -v`.

> **Short on time or bandwidth?** Run without the model, using keyword (BM25) search only:
> `uv sync` (no `--extra ml`), then set `ICR_RETRIEVAL__DEFAULT_MODE=lexical` before `serve`
> (see [§5](#5-troubleshooting)). Everything works, but cross-language search (English question →
> Arabic law) needs the model.

To check the setup without the browser:

```bash
uv run import-compliance-rag search "ما هي رسوم اصدار رخصة الاستيراد؟"
uv run import-compliance-rag search "Is registration required to import pesticides?"
```

## 2. Demo walkthrough

The app opens in Arabic. The **English** button in the header switches language, and the whole
interface is bilingual.

1. **Overview** (`نظرة عامة`): the problem, the five-step solution, inputs and outputs, the
   trust-by-design principles, and what this prototype does today versus what is illustrated.
2. **Assessment** (`تقييم المطابقة`): a full TRC type-approval case for a smartphone.
   * **1 · Inputs**: a saved company profile (entered once) and the product. Choose one of three
     sample products: the DemoTel DEMO-X1 5G phone, an IoT gateway, or a Bluetooth mouse that is
     exempt under Annex 3. Change the **test report** state (matching, naming another model, or
     missing) or the **EIRP** value, then press **Run Technical Assessment**.
   * **2 · Findings**: each requirement with its legal source (for example *Instructions No. 2 of
     2025, Art. 5(b)(3)*), applicability, evidence, next step and owner. Statuses: Supported, Missing
     evidence, Conflict, Needs verification, Not applicable. Try the mismatched test report to see a
     **Conflict**, or the mouse to see the exemption.
   * **3 · Application**: the TRC Annex 1 form, pre-filled from the profile and the findings, with
     the Annex 2 fees and a readiness checklist. **Print draft (PDF)** prints it with a DRAFT watermark.
3. **Evidence search** (`البحث في التشريعات`): live retrieval over the real texts. Ask in Arabic or
   English, or click an example. Each result shows the original provision, article, pages, file
   hash, extraction method and caveats, plus the definitions and articles it refers to. Nothing is
   generated. Search options restrict the search to one instrument or include amendment notes.
   Links to searches can be shared (`#/ask?q=...`).
4. **Knowledge base** (`قاعدة المعرفة`): the indexed instruments, read live from the database,
   with gazette references, amendments, version hashes and links to the official PDFs. It also
   lists the texts that are not indexed yet.

Good questions to try in Evidence search:

* `ما هي رسوم الموافقة النوعية لأجهزة الاتصالات؟` (TRC type-approval fees)
* `هل يجوز التنازل عن رخصة الاستيراد لشخص آخر؟` (can an import licence be transferred?)
* `Can goods pass through a third country and still get FTA treatment?`
* `Is registration required to import pesticides?` (English question, Arabic law)
* `المادة 9 من قانون الاستيراد والتصدير` (direct article lookup)

## 3. What is real and what is illustrative

| Real (runs on the official texts) | Illustrative (sample data) |
|---|---|
| Extraction, repair and structuring of 7 official PDFs (Arabic and English) | The companies, devices, documents and values in the Assessment |
| Bilingual semantic search with article-level citations, page numbers, file hashes and caveats | Spec extraction from a product link or catalogue (sample specs are loaded instead) |
| Knowledge base page, read live from PostgreSQL | LLM reasoning over the retrieved text (planned; no LLM is called anywhere in this code) |
| The Assessment's legal citations (TRC Instructions No. 2/2025, Annexes, standards list), checked against the PDFs | The Assessment's rule checks, which are deterministic code for this one trial case |

**Legal status of all sources is `unknown`**: no one has yet confirmed against the Official Gazette
that they are current. Every search result says so. MUTABIQ prepares a file for review and never
claims that a product is compliant.

## 4. Requirements

**System**

| Requirement | Notes |
|---|---|
| Windows 10/11, macOS (Apple Silicon) or Linux (x86-64 / ARM64) | Developed and tested on Windows 11. PyTorch's CPU index has no wheels for Intel Macs. |
| [Git](https://git-scm.com/downloads) | to clone the repository |
| [Docker](https://docs.docker.com/get-docker/) with Compose v2 (or Podman) | runs PostgreSQL 17 + pgvector (image `pgvector/pgvector:pg17`) |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) ≥ 0.12 | installs Python 3.12 and the locked dependencies (`uv.lock`) |
| ~5 GB free disk, 8 GB RAM | model (2.3 GB), PyTorch, Docker image |
| Internet on the first run | packages and the model; afterwards it runs offline |
| A modern browser | Chrome, Edge, Firefox or Safari |
| Node.js ≥ 18 (optional) | only for the UI unit tests |

Install uv:

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
# or, with any Python: pip install uv
```

**Python dependencies** (declared in [`pyproject.toml`](pyproject.toml), pinned in [`uv.lock`](uv.lock)):

* Core: `sqlalchemy`, `alembic`, `psycopg[binary]`, `pgvector`, `pydantic`, `pydantic-settings`,
  `typer`, `pyyaml`, `pymupdf`, `pdfplumber`, `fonttools`.
* `ml` extra (embeddings): `sentence-transformers`, `torch` (CPU build from the PyTorch index).
* Dev: `pytest`, `ruff`.

The front end (`web/`) is plain HTML, CSS and JavaScript modules with self-hosted fonts. There is no
build step and nothing is fetched from a CDN.

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `docker compose` fails with "Cannot connect to the Docker daemon" | Start Docker Desktop and wait until it says it is running. |
| Port **5433** already in use | Pick another port for both the database and the app. PowerShell: `$env:ICR_DB_PORT="5544"; $env:ICR_DATABASE_URL="postgresql+psycopg://icr:icr_dev_password@127.0.0.1:5544/icr"`. Bash: `export ICR_DB_PORT=5544 ICR_DATABASE_URL=postgresql+psycopg://icr:icr_dev_password@127.0.0.1:5544/icr`. Then rerun `docker compose up -d --wait` and `serve`. |
| Port **8765** already in use | `uv run import-compliance-rag serve --port 8780` |
| A container named `mutabiq-postgres` already exists | `docker rm -f mutabiq-postgres`, then `docker compose up -d --wait`. |
| `uv` is not recognised | Open a new terminal after installing uv, or use `python -m uv ...`. |
| `SSL: CERTIFICATE_VERIFY_FAILED` while downloading the model | A proxy or antivirus is intercepting HTTPS. Allow `huggingface.co`, or download the model on another network. Once it is in the cache, set `HF_HUB_OFFLINE=1` (PowerShell: `$env:HF_HUB_OFFLINE="1"`). |
| The model download is too slow | Use keyword search: `uv sync`, then PowerShell `$env:ICR_RETRIEVAL__DEFAULT_MODE="lexical"`, or Bash `export ICR_RETRIEVAL__DEFAULT_MODE=lexical`, then `uv run import-compliance-rag serve`. |
| The page loads, but search says the service is unavailable | The `serve` terminal shows the error. Usually the database is not running: `docker compose ps`. |
| Opening `web/index.html` directly shows a blank page | Use `serve`. JavaScript modules do not load from `file://`. |
| Empty knowledge base after an earlier, different setup | `docker compose down -v` deletes the old volume. The next `up` restores the snapshot again. |

## 6. How it works

```
registry.yaml ─► sources-sync ─► source_documents
official PDFs ─► extract ─► structure ─► chunk ─► document_versions / chunks ─► embed (bge-m3) ─► chunk_embeddings
                                                                                                │
question ─► language detection ─► pgvector cosine (dense) ─┬─► article-reference resolution ─► expand ─► EvidencePackage
                                └► BM25 (optional hybrid) ─┘    ("المادة 9 من ...")            (definitions,
                                                                                                cross-references, caveats)
```

1. **Extraction** (`ingestion/extract.py`, `font_recovery.py`, `ocr.py`). Official Jordanian PDFs
   often have a broken text layer: reversed لا, scrambled digits, legacy mojibake. Each page is
   quality-checked (`text/quality.py`). If the check fails, the text is recovered from the embedded
   fonts' own glyph tables and verified against an independent Tesseract OCR pass. OCR alone is the last resort.
2. **Structure and chunking** (`ingestion/structure.py`, `chunking.py`). Articles (Eastern or Western
   digits, `مكرر`), clauses, definition tables and treaty paragraphs are parsed. Amendment notes that
   quote superseded wording are kept as separate `amendment_history` chunks, excluded from search by
   default. Each chunk keeps its article number, pages, language and whether its number was parsed or inferred.
3. **Storage** (`storage/`). PostgreSQL + pgvector, with Alembic migrations. Ingestion is idempotent
   and versioned by file SHA-256: a changed PDF creates a new version, and old versions stay
   available for audit.
4. **Retrieval** (`retrieval/`). The default is dense search with `BAAI/bge-m3` plus explicit
   article-reference resolution. It was the best of the configurations measured in
   `docs/architecture.md` §5. Hybrid (language-aware reciprocal rank fusion with BM25) and lexical modes and an
   optional cross-encoder reranker (`BAAI/bge-reranker-v2-m3`) are available. Results are expanded with the
   definitions and articles they reference, and they carry the source's caveats.
5. **Web** (`web/`, `src/import_compliance_rag/web/server.py`). A small read-only HTTP server serves the
   static UI and a JSON API over the retriever, bound to 127.0.0.1.

There is no agent framework, no LangChain and no external API call. Models run locally.

## 7. Project structure

```
├── docker-compose.yml          PostgreSQL + pgvector, restores db/ on first start
├── db/
│   ├── 01_create_test_db.sql   creates icr_test (integration tests)
│   └── icr_snapshot.sql.gz     knowledge-base snapshot (7 instruments, 572 passages, embeddings)
├── pdfs/                       the 7 official source PDFs (<registry id>.pdf)
├── data/
│   ├── sources/registry.yaml   source registry: titles, authority, gazette refs, URLs, legal status
│   └── eval/                   retrieval evaluation cases (draft)
├── docs/
│   ├── MUTABIQ-presentation.pdf
│   └── architecture.md         design decisions, defects found and measurements
├── docker/ocr.Containerfile    Tesseract (Arabic + English) image for OCR
├── scripts/                    dev_db.sh (alternative DB start), tesseract_container.sh
├── src/import_compliance_rag/
│   ├── cli.py                  `import-compliance-rag` commands
│   ├── config/                 settings (env vars ICR_*), logging
│   ├── schemas/regulatory.py   pydantic models: registry entry, chunk, citation, evidence package
│   ├── text/                   Arabic normalisation, language detection, text-layer quality checks
│   ├── ingestion/              extraction, font recovery, OCR, structure parsing, chunking, pipeline
│   ├── storage/                SQLAlchemy models, session, Alembic migrations
│   ├── retrieval/              embedder, BM25, fusion, reference resolution, indexing, search
│   ├── evaluation/             dataset loader, metrics (MRR, recall/precision@k, nDCG), runner
│   └── web/server.py           local UI + JSON API server
├── web/                        front end: index.html, styles.css, js/*.mjs, fonts/
└── tests/                      unit, regression (real PDFs), integration (database)
```

## 8. Command-line reference

All commands run as `uv run import-compliance-rag <command>`. Add `--help` to any of them for details.

| Command | Purpose |
|---|---|
| `serve [--port 8765] [--host 127.0.0.1] [--rerank]` | Web app + JSON API |
| `search "<question>" [--json] [--mode dense\|hybrid\|lexical] [--doc <id>] [--type law] [--lang ar] [--history] [--no-expand] [--top-k N]` | Search from the terminal |
| `db-init` | Apply database migrations (not needed with the snapshot) |
| `sources-sync` | Load `data/sources/registry.yaml` into the database |
| `ingest [--doc <id>] [--force]` | Extract, structure and chunk the PDFs (idempotent) |
| `embed [--model BAAI/bge-m3]` | Compute embeddings for active chunks |
| `eval-retrieval [--cases <yaml>] [--mode ...] [--rerank]` | Run the retrieval evaluation and write `data/eval/runs/<run>.json` |

Every command accepts `--test-db` to use `ICR_TEST_DATABASE_URL` instead.

## 9. HTTP API

Read-only, GET only, served by `serve` on 127.0.0.1 with no authentication. It is meant for local
use, not as a production API.

| Endpoint | Description |
|---|---|
| `/api/health` | Status, retrieval mode, embedding model, number of active documents and passages |
| `/api/search?q=...` | `q` (required, ≤ 500 chars), `top_k` (1–20, default 8), `doc` (registry id, repeatable), `history` (0/1), `expand` (0/1). Returns an evidence package: items with original text, citation (document, article, pages, version hash, URL), retrieval signals and caveats. |
| `/api/sources` | Registered instruments with their active version and passage counts |

```bash
curl "http://127.0.0.1:8765/api/search?q=import%20licence%20fees&top_k=3"
```

## 10. Rebuilding the knowledge base from the PDFs

The snapshot in `db/` makes this optional. To reproduce it from the source PDFs:

```bash
cp .env.example .env                       # Windows: copy .env.example .env
docker build -t localhost/icr-tesseract:latest -f docker/ocr.Containerfile docker
#   then in .env: ICR_OCR__CONTAINER_IMAGE=localhost/icr-tesseract:latest
#   (or install tesseract with Arabic data natively and leave ICR_OCR__TESSERACT_CMD=tesseract)

# copy the PDFs to where ingestion reads them (data/sources/raw/<id>/source.pdf; git-ignored)
# bash:
for f in pdfs/*.pdf; do id=$(basename "$f" .pdf); mkdir -p "data/sources/raw/$id"; cp "$f" "data/sources/raw/$id/source.pdf"; done
# PowerShell:
# Get-ChildItem pdfs\*.pdf | % { $d="data\sources\raw\$($_.BaseName)"; New-Item -ItemType Directory -Force $d | Out-Null; Copy-Item $_ "$d\source.pdf" }

docker compose down -v; docker compose up -d --wait   # or use a fresh, empty database
uv run import-compliance-rag db-init
uv run import-compliance-rag sources-sync
uv run import-compliance-rag ingest                    # several minutes; OCR verifies recovered pages
uv run import-compliance-rag embed --model BAAI/bge-m3 # several minutes on CPU
```

Note: on an empty volume, `docker compose up` restores the snapshot. To start from nothing, use
`scripts/dev_db.sh` instead (`MSYS_NO_PATHCONV=1 bash scripts/dev_db.sh` in Git Bash), which
creates an empty database on the same port.

Ingest output goes to `data/derived/<doc>/<sha12>/` (page texts, structure, chunks, extraction
reports). To refresh the snapshot afterwards:
`docker exec mutabiq-postgres pg_dump -U icr -d icr --no-owner --no-privileges | gzip -9 > db/icr_snapshot.sql.gz`.

## 11. Configuration

Settings come from environment variables with the `ICR_` prefix, or from a `.env` file in the
project root. The defaults match `docker compose`, so **no `.env` is needed to run the demo**. All
settings are documented in [`.env.example`](.env.example). The main ones:

| Variable | Default | Meaning |
|---|---|---|
| `ICR_DATABASE_URL` | `postgresql+psycopg://icr:icr_dev_password@127.0.0.1:5433/icr` | main database |
| `ICR_TEST_DATABASE_URL` | same server, database `icr_test` | integration tests (schema is dropped and recreated) |
| `ICR_RETRIEVAL__DEFAULT_MODE` | `dense` | `dense`, `hybrid` or `lexical` |
| `ICR_RETRIEVAL__EMBEDDING_MODEL` | `BAAI/bge-m3` | Sentence-Transformers model |
| `ICR_RETRIEVAL__RERANKER_MODEL` | _(empty)_ | e.g. `BAAI/bge-reranker-v2-m3`, used with `--rerank` (slow on CPU) |
| `ICR_OCR__CONTAINER_IMAGE` | _(empty)_ | run Tesseract in this image instead of a native binary |
| `ICR_DB_PORT` | `5433` | host port used by `docker-compose.yml` |
| `HF_HUB_OFFLINE` | _(unset)_ | `1` once the model is cached, to skip network checks |

The database credentials are local development values. Do not reuse them anywhere else.

## 12. Tests and evaluation

```bash
uv run pytest                        # 66 tests: unit, regression and integration
uv run pytest tests/unit             # no database or PDFs needed
node --test web/js/core.test.mjs     # 16 UI logic tests: routing, assessment rules, readiness
uv run ruff check src tests          # lint
```

* `tests/unit`: normalisation, text-quality checks, structure parsing, chunking, BM25, fusion,
  metrics, font-recovery layout, OCR invocation, web server.
* `tests/regression`: defects found on the real PDFs. Skipped unless the PDFs are copied into
  `data/sources/raw/` ([§10](#10-rebuilding-the-knowledge-base-from-the-pdfs)).
* `tests/integration`: idempotent and versioned ingestion, embeddings, search with citations,
  filters and expansion, against `icr_test`. Skipped if the database is not reachable.

**Retrieval evaluation.** `data/eval/retrieval_cases.yaml` (37 cases) and
`retrieval_cases_hard.yaml` (34: paraphrases, identifier lookups, unanswerable questions) cover
ar→ar, en→ar, ar→en and en→en. On the hard set, MRR was 0.51 for lexical, 0.86 for bge-m3 dense,
**0.91 for dense + article references (the default)** and 0.96 with the reranker. **All cases are
drafts.** Their authors wrote them from the texts, and no domain expert has reviewed them, so these
numbers are indicative only. See `docs/architecture.md` §5.

## 13. Limitations

* The legal status of every source is **unknown** until someone checks it against the Official
  Gazette. Amendment information comes from the documents' own annotations.
* The knowledge base does not yet include the Customs Law and tariff, JSMO technical regulations or
  JFDA requirements. Questions on those topics return the closest indexed provisions, which do not
  answer them.
* Recovered and OCR'd Arabic text carries a caveat: check the exact wording against the PDF. The TRC
  annexes are scanned and OCR'd with lower confidence.
* The Assessment is a single, hand-built trial case (TRC type approval) on sample data. Answer
  generation with an LLM, business profiles, multi-tenancy and a production API are later phases.
* The local server has no authentication. Keep it on 127.0.0.1.
