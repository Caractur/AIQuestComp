from import_compliance_rag.config.settings import ChunkingSettings
from import_compliance_rag.ingestion.chunking import HISTORY_CAVEAT, INFERRED_NUMBER_CAVEAT, build_chunks
from import_compliance_rag.ingestion.extract import ExtractedTable
from import_compliance_rag.ingestion.structure import parse_structure
from import_compliance_rag.schemas.regulatory import ChunkType, Language

SHA = "ab" * 32


def _chunks(text, language=Language.AR, tables=(), **settings):
    structure = parse_structure([(1, text)], language)
    chunks, warnings = build_chunks(
        document_id="doc-test",
        sha256=SHA,
        title="قانون تجريبي",
        language=language,
        structure=structure,
        tables=list(tables),
        settings=ChunkingSettings(**settings),
    )
    return {c.key: c for c in chunks}, warnings


def test_short_article_is_one_chunk_with_stable_id_and_header():
    chunks, _ = _chunks("المادة 1\nيسمى هذا القانون قانون الاستيراد .")
    chunk = chunks["art-1"]
    assert chunk.id == f"doc-test@{SHA[:12]}#art-1"
    assert chunk.chunk_type is ChunkType.ARTICLE
    assert chunk.article_number == "1"
    assert chunk.number_source == "parsed"
    assert chunk.context_header == "قانون تجريبي | المادة 1"
    assert chunk.text_original == "يسمى هذا القانون قانون الاستيراد ."
    assert chunk.embedding_text.startswith("قانون تجريبي | المادة 1\n")


def test_chunk_ids_are_deterministic():
    text = "المادة 1\nنص اول .\nالمادة 2\nنص ثان ."
    first, _ = _chunks(text)
    second, _ = _chunks(text)
    assert [c.id for c in first.values()] == [c.id for c in second.values()]
    assert [c.content_sha256 for c in first.values()] == [c.content_sha256 for c in second.values()]


def test_long_article_splits_at_clause_boundaries_and_carries_lead_in():
    clause = " ".join(["كلمة"] * 30)
    text = "المادة 5\nيحدد الوزير ما يلي :\n" + "\n".join(f"{letter} . {clause}" for letter in "أبجده")
    chunks, _ = _chunks(text, max_tokens=70)
    parts = [c for c in chunks.values() if c.chunk_type is ChunkType.ARTICLE_PART]
    assert len(parts) >= 3
    assert parts[0].text_original.startswith("يحدد الوزير ما يلي :")
    assert all(p.parent_key == "art-1" for p in parts)
    assert [p.part_index for p in parts] == list(range(len(parts)))
    assert all(p.part_count == len(parts) for p in parts)
    # Every later part repeats the lead-in in its header, and no clause is cut in the middle.
    assert all("يحدد الوزير ما يلي" in p.context_header for p in parts[1:])
    assert all(line.split()[0] in "أبجده" for p in parts[1:] for line in p.text_original.splitlines()[:1])
    assert all(p.token_count <= 70 for p in parts)


def test_oversized_clause_falls_back_to_overlapping_windows():
    text = "المادة 7\n" + " ".join(f"ك{i}" for i in range(200))
    chunks, _ = _chunks(text, max_tokens=80, fallback_overlap_tokens=20)
    parts = [c for c in chunks.values() if c.chunk_type is ChunkType.ARTICLE_PART]
    words = [p.text_original.split() for p in parts]
    assert all(len(w) <= 80 for w in words)
    assert words[0][-20:] == words[1][:20]  # overlap
    assert words[-1][-1] == "ك199"


def test_definitions_are_split_per_term_with_lead_in_kept_once():
    text = "\n".join(
        [
            "المادة 2",
            "يكون للكلمات والعبارات التالية حيثما وردت في هذا القانون المعاني المخصصة لها ادناه ما لم",
            "تدل القرينة على غير ذلك :",
            "الوزارة : وزارة الزراعة .",
            "الحيازة الزراعية : وحدة للانتاج الزراعي تخضع لادارة واحدة",
            "لاغراض الانتاج النباتي .",
        ]
    )
    chunks, _ = _chunks(text)
    defs = [c for c in chunks.values() if c.chunk_type is ChunkType.DEFINITIONS]
    assert [d.definition_term for d in defs] == ["الوزارة", "الحيازة الزراعية"]
    assert defs[0].text_original.startswith("يكون للكلمات")
    assert defs[1].text_original == "الحيازة الزراعية : وحدة للانتاج الزراعي تخضع لادارة واحدة\nلاغراض الانتاج النباتي ."
    assert "يكون للكلمات" in defs[1].context_header
    assert [d.key for d in defs] == ["art-2.def-1", "art-2.def-2"]


def test_amendment_history_becomes_separate_flagged_chunk():
    text = "المادة 12\nالرسم 15 دينارا.\n-هكذا اصبحت هذه المادة بعد تعديلها حيث كان النص كما يلي:\nالرسم 5 دنانير."
    chunks, _ = _chunks(text)
    assert "5 دنانير" not in chunks["art-1"].text_original
    history = chunks["art-1.hist"]
    assert history.chunk_type is ChunkType.AMENDMENT_HISTORY
    assert history.parent_key == "art-1"
    assert HISTORY_CAVEAT in history.caveats
    assert "5 دنانير" in history.text_original


def test_inferred_article_number_carries_caveat():
    chunks, _ = _chunks("المادة 1\nنص\nالمادة ؟؟\nنص ثان\nالمادة 3\nنص ثالث")
    assert chunks["art-2"].number_source == "inferred"
    assert INFERRED_NUMBER_CAVEAT in chunks["art-2"].caveats
    assert not chunks["art-3"].caveats


def test_bis_article_key_and_cross_references():
    chunks, _ = _chunks("المادة ١\nنص المادة الاولى .\nالمادة ١ مكرر :\nمع مراعاة احكام المادة (١) من هذا القانون .")
    bis = chunks["art-1-bis"]
    assert bis.article_number == "1 مكرر"
    assert [(r.article_number, r.external) for r in bis.cross_references] == [("1", False)]


def test_english_paragraph_chunks():
    chunks, _ = _chunks("RULES OF ORIGIN\n1.\nThis Agreement shall apply.\n2.\nSecond.", language=Language.EN)
    assert chunks["para-1"].context_header == "قانون تجريبي | Paragraph 1"
    assert chunks["para-1"].language is Language.EN


def test_tables_render_markdown_with_repeated_header():
    table = ExtractedTable(page_number=4, rows=[["HS", "Duty"], *[[f"0{i}01", f"{i}%"] for i in range(5)]])
    chunks, _ = _chunks("المادة 1\nنص .", tables=[table], table_max_rows=2)
    parts = [c for c in chunks.values() if c.chunk_type is ChunkType.TABLE]
    assert len(parts) == 3
    assert all(p.text_original.startswith("| HS | Duty |\n| --- | --- |") for p in parts)
    assert parts[0].page_start == 4


def test_unstructured_text_uses_windows():
    text = "\n".join(" ".join(f"w{i}_{j}" for j in range(10)) for i in range(20))
    chunks, _ = _chunks(text, language=Language.EN, max_tokens=64, fallback_overlap_tokens=8)
    assert all(c.chunk_type is ChunkType.TEXT for c in chunks.values())
    assert len(chunks) >= 3
