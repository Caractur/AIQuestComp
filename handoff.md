# Handoff — Jordan Import Compliance RAG

_Last updated: 2026-10-09. Written at the end of the first working session._

## 1. What this project is

An evidence-grounded, bilingual (Arabic/English) regulatory RAG platform for businesses importing
goods into Jordan. The full product brief (roles, phases, definition of done) was given as a long
prompt in the first session; its key rules are summarized in §7 so the next session can continue
without it.

**Agreed scope for the current milestone:** scaffold → database → ingestion → bilingual hybrid
retrieval with tests, then **stop for review** before business profiles, generation and API.

**Decisions made by the owner:**

| Topic | Decision |
|---|---|
| LLM provider | **Decide later.** Build behind an interface; no LLM calls yet. |
| Embeddings/reranking | Local open models recommended and accepted: `BAAI/bge-m3` primary, `intfloat/multilingual-e5-large` as comparison, `BAAI/bge-reranker-v2-m3` optional. Choose by measured Arabic↔English retrieval, not by advertised coverage. |
| Source documents | **Both:** Claude fetches from official sites; owner adds documents they have. |
| Stop point | After retrieval + tests. |

## 2. Environment (as found and set up)

- Fedora, Python 3.14 system (no pip). **`uv` installed** at `~/.local/bin/uv`; project pinned to
  Python **3.12** (`.python-version`). Run everything with `uv run ...`.
- Rootless **podman** (no docker, no sudo used).
- **PostgreSQL 17 + pgvector** dev container: `scripts/dev_db.sh` → `127.0.0.1:5433`, databases
  `icr` and `icr_test`, user/password `icr` / `icr_dev_password` (dev only). Container `icr-postgres`,
  volume `icr-pgdata`. **No tables created yet.**
- **Tesseract OCR** (ara + eng) runs in a container image `localhost/icr-tesseract:latest` built
  from `docker/ocr.Containerfile`. `scripts/tesseract_container.sh` is a drop-in for the `tesseract`
  binary; set `ICR_OCR__TESSERACT_CMD=scripts/tesseract_container.sh`. Native alternative:
  `sudo dnf install tesseract tesseract-langpack-ara`.
- **bge-m3 downloaded** to the Hugging Face cache (`~/.cache/huggingface/hub/models--BAAI--bge-m3`).
- CPU-only torch (configured in `pyproject.toml` via the pytorch-cpu index). Machine: 12 cores,
  15 GB RAM, 2 GB MX550 GPU (not used).
- No API keys present. `.env.example` documents every setting (`ICR_*`, nested with `__`).

## 3. Regulatory sources obtained (real, official — not fabricated)

Downloaded into `data/sources/raw/<id>/source.pdf` (git-ignored; re-download from the URLs).
Found via links on the Jordan Customs Trade Facilitation Repository
(`https://traderepository.customs.gov.jo/english/`). **Legal status of all four = `unknown` until a
human verifies currency and amendments.**

| id | Document | Authority | Lang | SHA-256 (first 12) | Text layer |
|---|---|---|---|---|---|
| `mit-import-export-law-21-2001` | قانون الاستيراد والتصدير وتعديلاته رقم 21 لسنة 2001 (Official Gazette 4494, p. 2453, 1/7/2001) | Ministry of Industry, Trade and Supply | ar | `6e9799434dc8` | **corrupted** (reversed لا, scrambled digits) |
| `mit-import-export-licenses-system-114-2004` | نظام رخص وبطاقات الاستيراد والتصدير وتعديلاته رقم 114 لسنة 2004 (Gazette 4677, p. 4603, 30/9/2004; issued under Art. 12 of Law 21/2001) | Ministry of Industry, Trade and Supply | ar | `66cc2f117a84` | **corrupted** |
| `moa-agriculture-law-13-2015` | قانون الزراعة رقم 13 لسنة 2015 وتعديلاته (Gazette 5337, p. 1868, 16/4/2015; 73 articles + 1 مكرر) | Ministry of Agriculture | ar | `d522d79735e9` | **mojibake** (legacy encoding); Eastern Arabic numerals |
| `ustr-jordan-fta-rules-of-origin` | US–Jordan FTA, Annex 2.2 Rules of Origin | USTR (treaty text) | en | `5438c7a9f4b1` | clean |

Source URLs:
- https://www.mit.gov.jo/ebv4.0/root_storage/ar/eb_list_page/قانون_الاستيراد_و_التصدير_وتعديلاته_رقم_21_لسنة_2001.pdf
- https://www.mit.gov.jo/ebv4.0/root_storage/ar/eb_list_page/نظام_رخص_وبطاقات_الاستيراد_والتصدير_و_تعيدلاته_رقم_114_لسنة_2004.pdf
- http://moa.gov.jo/ebv4.0/root_storage/ar/eb_list_page/قانون_الزراعة_رقم_13_لسنة_2015_وتعديلاته.pdf
- https://ustr.gov/sites/default/files/uploads/agreements/fta/jordan/asset_upload_file366_8456.pdf

**Dead links (could not obtain):** JSMO Law No. 22/2000 (jsmo.gov.jo, 404/451) and JFDA Drug and
Pharmacy Law (jfda.jo, 404). **Still needed:** JSMO technical regulations, JFDA food/cosmetics import
requirements, Customs Law, tariff (`traderepository.customs.gov.jo/english/document/Taariff_of_2021.pdf`
was linked but not downloaded). The owner may have PDFs to add.

The **source registry file `data/sources/registry.yaml` has NOT been written yet** — the schema
(`SourceRegistryEntry`) exists; populate it from the table above.

## 4. Key technical findings (important — these shaped the design)

1. **Official Jordanian PDFs often have corrupted text layers.** Word-exported PDFs with broken
   ToUnicode maps: `االستيراد` instead of `الاستيراد`, `لسنة1002` for 2001, or full mojibake.
   Article numbers from such layers are unusable for citations. `text/quality.py` detects this
   (corrupted pages score 0.0–0.71; clean pages 1.0; threshold 0.85).
2. **Tesseract full-page OCR silently drops lines** (PSM 3/4 lost Art. 6(أ) and the first line of
   Art. 8 of Law 21/2001; PSM 6 lost Art. 12's lead-in). Mitigations implemented: PSM 6 default,
   **line-band OCR** (crop one band per visual line using the text layer's still-valid positions),
   PSM 7 per band with PSM 13 retry for empty bands, trailing-noise stripping, and a
   **line-coverage check** that flags pages where OCR returns fewer lines than the PDF has.
3. **Use `-l ara` (not `ara+eng`) for Arabic documents** — `ara+eng` hallucinated Latin words
   (`جهة` → `Age`). OCR language now follows the registry language.
4. **Tesseract cannot read bold Eastern Arabic numerals** (`٧٣` → `77`, `٧٠` → `٠,١`), even with
   `tessdata_best` or a character whitelist. Sequence-based inference of article numbers drifted by
   4 on the Agriculture Law — rejected as unsafe.
5. **Breakthrough — font-cmap recovery:** the *embedded TrueType fonts* still carry correct cmaps
   and glyph names; only the PDF ToUnicode is broken. Decoding drawn glyph IDs through the embedded
   font recovers exact text including Eastern Arabic numerals (all 74 Agriculture Law headings,
   `المادة ٧٠…٧٣`, matched the rendered page). Pitfalls solved:
   - Ligature continuation chars (gid −1) must be skipped (else `لاا`).
   - Several fonts on a page can share a name (embedded Type0 vs substituted simple font); a glyph
     is decoded only through the font whose **advance width matches the drawn width** (fixed a
     colon being read as `8`).
   - OCR is used as an independent verifier (page agreement 0.78–0.99 measured), and per-glyph
     **majority-vote corrections** are allowed only letter→letter and digit→`:`/`.`, because OCR
     systematically misreads Eastern digits and the Arabic comma (it out-voted correct decodes).
   - Persian digit code points are normalized to Arabic-Indic.
6. Two-column definition tables (Agriculture Law pp. 1–3) are read imperfectly by OCR and
   recovered in visually-staggered order (term line between definition lines). Known limitation.

## 5. Code state — file by file

Package: `src/import_compliance_rag/`. Lint (`ruff --select F,E9`) passes; modules import.
**No automated tests exist yet. Nothing has been committed before this handoff.**

| File | Status |
|---|---|
| `config/settings.py` | Done. pydantic-settings, `ICR_` env prefix; OCR, chunking, text-quality, retrieval settings. |
| `config/logging.py` | Done. JSON structured logging. |
| `schemas/regulatory.py` | Done. Enums (Language, DocumentType, BindingNature, LegalStatus, TranslationProvenance, ExtractionMethod incl. `font_recovery`, ExtractionPolicy, ChunkType), `SourceRegistryEntry`, `PageExtraction`, `ExtractionReport`, `ChunkRecord`, `Citation`, `RetrievalSignal`, `EvidenceItem`, `EvidencePackage`. |
| `text/arabic.py` | Done. `clean_original` (invisible-char cleanup only) vs `normalize_for_retrieval` (NFKC, diacritics, alef variants, digits, optional ة→ه / ى→ي; hamza on و/ي preserved). |
| `text/language.py` | Done. Script-ratio language ID (ar/en/mixed). |
| `text/quality.py` | Done and calibrated on the real PDFs. |
| `ingestion/ocr.py` | Done. Batched tesseract (one call per image list), per-image confidence from TSV, PSM override, DPI override, timeout scales with image count. |
| `ingestion/font_recovery.py` | Done and validated interactively on all 3 Arabic PDFs (see §4.5). |
| `ingestion/extract.py` | **Written but the final version has NOT been run.** Order: text layer → font recovery verified by OCR (`min_recovery_agreement` 0.75, verification at 200 DPI) → dual-strategy OCR fallback. The previous (OCR-only) version was validated. **First task next session: run it on all 4 PDFs.** |
| `ingestion/structure.py` | Done, tested on OCR text: Arabic article headings (parsed vs inferred numbers), sections, `مكرر`, titles, definitions detection, amendment notes (`هكذا اصبحت`), clause splitting (`أ.` `1.` `.1` RTL quirk), cross-references; English `Article N` or sequential treaty paragraphs (USTR annex → 13 paragraphs). Re-test on font-recovered text (numbers should now all be `parsed`). |
| `storage/`, `retrieval/`, `evaluation/` | Empty packages. |
| `scripts/dev_db.sh`, `scripts/tesseract_container.sh`, `docker/ocr.Containerfile` | Done. |

Approximate extraction timings on this machine: Law 21 ~25 s, Bylaw 114 ~40 s, Agriculture Law
2–9 min (OCR is the cost; machine load varies).

## 6. Remaining plan (in order)

1. Run the new `extract.py` on all four PDFs; inspect page reports; fix issues.
2. Write `data/sources/registry.yaml` (4 entries above, `legal_status: unknown`, provenance notes).
3. `ingestion/chunking.py` — structure-aware chunks: one per article; long articles split at clause
   boundaries with the lead-in carried in `context_header`; definitions split per term; tables as
   markdown with repeated headers; fallback windows with overlap. Stable chunk IDs
   `"{doc_id}@{sha12}#art-{n}[.p{k}]"`. Record `number_source` (parsed/inferred) and add a caveat
   when inferred.
4. `storage/` — SQLAlchemy models + Alembic: `source_documents`, `document_versions` (unique per
   doc+sha, `is_active`, pipeline version, extraction report JSON), `chunks`
   (`text_original`, `text_retrieval`, metadata), `chunk_embeddings(chunk_id, model, vector)`
   (untyped vector column so multiple models can be compared).
5. `ingestion/pipeline.py` — idempotent ingest (skip same sha + pipeline version), new version on
   new sha (old versions kept for history), derived artifacts in `data/derived/<doc>/<sha12>/`.
6. `retrieval/` — embedder interface (sentence-transformers; deterministic fake for tests), BM25
   with Arabic light prefix stripping + HS-code/article-number tokens, pgvector dense search with
   metadata filters (unknown-status docs included but labeled), RRF fusion, dedupe only identical
   chunks, optional cross-encoder rerank, expansion (sibling parts, definitions, internal
   cross-references), `EvidencePackage` with citations and caveats (OCR'd text, unverified status).
   Optional reviewed bilingual glossary for query expansion (LLM translation deferred).
7. `evaluation/` — dataset schema (version-independent targets: document + article), Recall@k,
   Precision@k, MRR, nDCG, reported separately for ar→ar, en→ar, ar→en, en→en. Draft cases from the
   real texts must be marked `review_status: draft` until the owner reviews them. **Never report
   draft results as validated.**
8. CLI (`typer`): `db-init`, `sources-sync`, `ingest`, `embed --model`, `search`, `eval-retrieval`.
9. Tests: unit (normalization, quality, structure, chunking, RRF, metrics, BM25), integration
   against `icr_test` (ingest idempotency, versioning, search with citations, filters).
10. Docs: README (setup), `docs/architecture.md` (extraction strategy and chunking trade-offs).
11. **Stop for owner review.** Later phases: business/product profiles, tenancy (Postgres RLS),
    grounded generation, API, security tests.

## 7. Non-negotiable rules from the brief

- Never invent regulations, citations, URLs, evaluation results or integrations.
- Preserve original text; normalized text is for retrieval only. Distinguish binding vs guidance;
  record legal-status uncertainty; never present machine translation as official.
- Response language (`ar` / `en` / `ar_en`) must not change the assessment.
- Statuses: `required`, `potentially_applicable`, `insufficient_evidence`, `not_applicable`,
  `human_review_required`. No "fully compliant" claims; file presence ≠ document validity.
- Multi-tenant isolation is mandatory; uploaded documents are untrusted and never become shared
  regulatory knowledge.
- No agent frameworks / LangChain; small replaceable components.

## 8. Prompt for the next session

> Read `handoff.md` in this repository first; it is the source of truth for decisions and state.
> Continue the Jordan Import Compliance RAG from §6, step 1: run `ingestion/extract.py` on the four
> PDFs in `data/sources/raw/` (re-download them from §3 if missing and verify the SHA-256 prefixes),
> start the dev DB with `scripts/dev_db.sh`, and set
> `ICR_OCR__TESSERACT_CMD=scripts/tesseract_container.sh` (build the OCR image first if needed).
> Then implement steps 2–10, testing each component before moving on. Follow the rules in §7. Do not
> fabricate sources, citations or evaluation results; mark drafted evaluation cases as `draft`.
> Stop after retrieval and its tests and report what was verified versus what is still planned.
