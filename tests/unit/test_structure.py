from import_compliance_rag.ingestion.structure import (
    Line,
    NumberSource,
    find_cross_references,
    parse_structure,
    split_clauses,
)
from import_compliance_rag.schemas.regulatory import Language


def _articles(pages, language=Language.AR):
    return [s for s in parse_structure(pages, language).segments if s.kind == "article"]


def test_arabic_articles_with_eastern_numerals_and_bis():
    text = "\n".join(
        [
            "قانون الزراعة",
            "المادة ١",
            "نص المادة الاولى .",
            "المادة ٢",
            "نص .",
            "المادة ٢ مكرر :",
            "نص مكرر .",
            "المادة ٣",
            "نص .",
        ]
    )
    articles = _articles([(1, text)])
    assert [a.number for a in articles] == ["1", "2", "2 مكرر", "3"]
    assert all(a.number_source is NumberSource.PARSED for a in articles)


def test_unreadable_heading_number_is_inferred_and_flagged():
    text = "المادة 1\nنص\nالمادة ؟؟\nنص\nالمادة 3\nنص"
    structure = parse_structure([(1, text)], Language.AR)
    articles = [s for s in structure.segments if s.kind == "article"]
    assert [a.number for a in articles] == ["1", "2", "3"]
    assert articles[1].number_source is NumberSource.INFERRED
    assert any("inferred as 2" in w for w in structure.warnings)


def test_body_line_starting_with_article_word_is_not_a_heading():
    text = "المادة 1\nالمادة باشراف اجهزة الوزارة وعلى نفقة المخالف ."
    assert len(_articles([(1, text)])) == 1


def test_amendment_history_is_split_from_current_text():
    text = "\n".join(
        [
            "المادة 1",
            "أ . الرسم عشرة دنانير.",
            "-هكذا اصبحت هذه المادة بعد تعديلها بموجب النظام المعدل رقم 58 لسنة 2005 حيث كان نص البند كما يلي:",
            ".2 خمسة دنانير",
            "المادة 2",
            "تطبق هذه الاحكام.",
        ]
    )
    article = _articles([(3, text)])[0]
    assert article.text == "أ . الرسم عشرة دنانير."
    assert [line.text for line in article.history][-1] == ".2 خمسة دنانير"
    assert len(article.amendment_notes) == 1


def test_amendment_marker_with_soft_hyphen_and_header_line():
    text = "المادة 1\nتطبق احكام هذه المادة على جميع الحالات .\nتعديلات المادة :\n\u00ad هكذا اصبحت هذه المادة بعد تعديلها بموجب القانون المعدل رقم ٢ لسنة ٢٠٢٠."
    article = _articles([(1, text)])[0]
    assert article.text == "تطبق احكام هذه المادة على جميع الحالات ."
    assert article.history[0].text == "تعديلات المادة :"
    assert len(article.amendment_notes) == 1


def test_article_title_and_definitions_detection():
    text = "المادة ٢\nالتعاريف :\nيكون للكلمات والعبارات التالية حيثما وردت في هذا القانون المعاني المخصصة لها ادناه :\nالوزارة : وزارة الزراعة ."
    article = _articles([(1, text)])[0]
    assert article.title == "التعاريف"
    assert article.is_definitions


def test_english_treaty_paragraphs_in_sequence_only():
    text = "ANNEX 2.2\nRULES OF ORIGIN\n1.\nThis Agreement shall apply if:\n(a)\nfirst\n2.\nSecond paragraph.\n5. not a paragraph\n3.\nThird."
    structure = parse_structure([(1, text)], Language.EN)
    paragraphs = [s for s in structure.segments if s.kind == "paragraph"]
    assert [p.number for p in paragraphs] == ["1", "2", "3"]
    assert paragraphs[0].section_path == ["ANNEX 2.2"]
    assert "5. not a paragraph" in paragraphs[1].text


def test_split_clauses_handles_rtl_period_first_numbering():
    lines = [Line(t, 1) for t in ["يستثنى ما يلي:", ".1البضاعة الاولى", "تكملة", ".2البضاعة الثانية", "ب. فقرة"]]
    lead, clauses = split_clauses(lines)
    assert [line.text for line in lead] == ["يستثنى ما يلي:"]
    assert [[line.text for line in c] for c in clauses] == [
        [".1البضاعة الاولى", "تكملة"],
        [".2البضاعة الثانية"],
        ["ب. فقرة"],
    ]


def test_cross_references_internal_and_external():
    refs = find_cross_references("وفقا لاحكام المادة (٣٥) من هذا القانون وكذلك المادة 12 من قانون الجمارك")
    assert refs[0][1:] == ("35", True)
    assert refs[1][1:] == ("12", False)


def test_inline_trc_style_headings_with_ocr_variants_and_tatweel():
    text = "\n".join(
        [
            "المادة :)١( تسمى هذه التعليمات تعليمات شروط الموافقة.",
            "المادة (2): يكون للكلمات التالية المعاني المخصصة لها.",
            "المادة (”): تصنف أجهزة الاتصالات على النحو التالي:",
            "المـادة (٤): يقتصر التقدم للحصول على الموافقة.",
            "الم ـادة (٥): يقدم طلب الحصول على الموافقة النوعية.",
            "المادة اله ١ ):",
            "نص المادة السادسة.",
            "المادة (٦) من هذا القانون لا تبدأ مادة جديدة.",
        ]
    )
    articles = _articles([(1, text)])
    assert [a.number for a in articles] == ["1", "2", "3", "4", "5", "6"]
    assert articles[2].number_source is NumberSource.INFERRED  # unreadable OCR digit
    assert articles[5].number_source is NumberSource.INFERRED  # garbled heading
    assert articles[0].lines[0].text == "تسمى هذه التعليمات تعليمات شروط الموافقة."
    # An in-text reference at the start of a line stays body text of the current article.
    assert "المادة (٦) من هذا القانون" in articles[5].text
