from import_compliance_rag.retrieval.fusion import fuse_ranks
from import_compliance_rag.retrieval.references import parse_article_reference, resolve_instrument

TITLES = {
    "law-21": "قانون الاستيراد والتصدير وتعديلاته رقم 21 لسنة 2001 Import and Export Law No. 21 of 2001",
    "bylaw-114": "نظام رخص وبطاقات الاستيراد والتصدير وتعديلاته رقم 114 لسنة 2004 "
    "Import and Export Licences and Cards Bylaw No. 114 of 2004",
    "agri-13": "قانون الزراعة رقم 13 لسنة 2015 وتعديلاته Agriculture Law No. 13 of 2015",
}


def test_parse_arabic_reference_with_eastern_digits_and_bis():
    ref = parse_article_reference("المادة ٦٣ مكرر من قانون الزراعة")
    assert ref.article_number == "63 مكرر"
    assert ref.remainder == "من قانون الزراعة"


def test_parse_english_reference_and_rejects_none_or_several():
    assert parse_article_reference("Article 11 of the Import and Export Law").article_number == "11"
    assert parse_article_reference("paragraph 9 of Annex 2.2").article_number == "9"
    assert parse_article_reference("ما هي رسوم رخصة الاستيراد") is None
    assert parse_article_reference("المادة 3 والمادة 4 من القانون") is None


def test_resolve_instrument_ignores_the_article_number_and_needs_a_unique_match():
    # "13" would point at Agriculture Law No. 13; the article number is removed before matching.
    ref = parse_article_reference("المادة 13 من نظام رخص وبطاقات الاستيراد والتصدير")
    assert resolve_instrument(ref.remainder, TITLES) == "bylaw-114"
    ref = parse_article_reference("Article 11 of the Import and Export Law No. 21 of 2001")
    assert resolve_instrument(ref.remainder, TITLES) == "law-21"
    # Ambiguous (ties between the law and the bylaw) or unknown instruments are not resolved.
    assert resolve_instrument("رخصة الاستيراد", TITLES) is None
    assert resolve_instrument("من قانون الجمارك", TITLES) is None


def test_weighted_fusion():
    fused = dict(fuse_ranks([{"a": 1}, {"a": 2, "b": 1}], k=60, weights=[1.0, 0.5]))
    assert fused["a"] == 1 / 61 + 0.5 / 62
    assert fused["b"] == 0.5 / 61
