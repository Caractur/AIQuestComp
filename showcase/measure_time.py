"""Measure corpus facts and warm search latency for showcase/time-race.html. Read-only.

Run from the repo root: uv run python showcase/measure_time.py > showcase/measurements.json
(needs the database from docker compose and the bge-m3 model in the Hugging Face cache).
words_2plus ignores one-letter fragments that OCR leaves in Arabic text.
"""

import json
import os
import platform
import statistics
import sys
import time
from datetime import datetime, timezone

os.environ.setdefault("HF_HUB_OFFLINE", "1")

from sqlalchemy import text  # noqa: E402

from import_compliance_rag.cli import _retriever, _settings  # noqa: E402
from import_compliance_rag.retrieval.search import SearchFilters  # noqa: E402
from import_compliance_rag.storage.db import session_scope  # noqa: E402

QUESTIONS = [
    ("rules", "ما هي الأجهزة التي تحتاج إلى موافقة نوعية من هيئة تنظيم قطاع الاتصالات؟"),
    ("rules", "Does a smartphone need type approval before it can be imported into Jordan?"),
    ("evidence", "ما هي الوثائق المطلوبة لطلب الموافقة النوعية؟"),
    ("evidence", "Is a test report from an accredited laboratory required for type approval?"),
    ("evidence", "ما هي المواصفات الفنية لأجهزة الهاتف الخلوي LTE؟"),
    ("evidence", "ما هي متطلبات الملصق على الجهاز الحاصل على الموافقة النوعية؟"),
    ("gaps", "هل الفأرة اللاسلكية معفاة من الموافقة النوعية؟"),
    ("gaps", "What happens if the model in the test report differs from the declared model?"),
    ("form", "ما هي رسوم الموافقة النوعية لأجهزة الاتصالات؟"),
    ("form", "ما هي البيانات المطلوبة في نموذج طلب الموافقة النوعية؟"),
]
RUNS = 5


def main() -> None:
    settings, url = _settings(False)
    mode = settings.retrieval.default_mode
    t0 = time.perf_counter()
    retriever = _retriever(settings, None, mode, False)
    load_s = time.perf_counter() - t0
    out = {"measured_at": datetime.now(timezone.utc).isoformat(), "mode": mode,
           "model": settings.retrieval.embedding_model, "model_load_s": round(load_s, 1),
           "machine": f"{platform.system()} {platform.release()}, {os.cpu_count()} threads, CPU only",
           "runs_per_question": RUNS}
    with session_scope(url) as session:
        rows = session.execute(text(
            "select d.id, v.page_count, count(c.id) as passages, "
            "sum(array_length(regexp_split_to_array(trim(c.text_original), '\\s+'), 1)) as words, "
            "sum((select count(*) from unnest(regexp_split_to_array(trim(c.text_original), '\\s+')) w "
            "where char_length(w) >= 2)) as words_2plus "
            "from source_documents d join document_versions v on v.document_id = d.id and v.is_active "
            "join chunks c on c.version_id = v.id group by d.id, v.page_count order by d.id")).all()
        out["corpus"] = [dict(id=r[0], pages=r[1], passages=r[2], words=int(r[3] or 0),
                              words_2plus=int(r[4] or 0)) for r in rows]
        retriever.search(session, "warm up", SearchFilters(), top_k=8, mode=mode, expand=True)
        results = []
        for step, q in QUESTIONS:
            times = []
            pkg = None
            for _ in range(RUNS):
                s = time.perf_counter()
                pkg = retriever.search(session, q, SearchFilters(), top_k=8, mode=mode, expand=True)
                times.append((time.perf_counter() - s) * 1000)
            hits = [i for i in pkg.items if i.relation == "retrieved"][:3]
            results.append(dict(step=step, q=q, median_ms=round(statistics.median(times)),
                                min_ms=round(min(times)), max_ms=round(max(times)),
                                items=len(pkg.items),
                                top=[dict(doc=h.citation.document_id, article=h.citation.article_number,
                                          pages=[h.citation.page_start, h.citation.page_end],
                                          snippet=h.text_original[:160]) for h in hits]))
        out["searches"] = results
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
