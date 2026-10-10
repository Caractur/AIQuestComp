from import_compliance_rag.schemas.regulatory import Language
from import_compliance_rag.text.arabic import clean_original, normalize_digits, normalize_for_retrieval
from import_compliance_rag.text.language import detect_language
from import_compliance_rag.text.quality import assess_text_layer


def test_clean_original_removes_only_invisible_characters():
    text = "‏المادة‎  ٧٣ :‫\n\n\n\nنص"
    assert clean_original(text) == "المادة ٧٣ :\n\nنص"


def test_clean_original_keeps_diacritics_and_digits():
    text = "إِنَّ المادةَ (٥) أ."
    assert clean_original(text) == text


def test_normalize_for_retrieval_folds_variants():
    assert normalize_for_retrieval("إستيراد أو آلة") == "استيراد او اله"
    assert normalize_for_retrieval("المادةُ ٧٣") == "الماده 73"
    assert normalize_for_retrieval("على مستوى") == "علي مستوي"
    assert normalize_for_retrieval("الـــزراعة") == "الزراعه"


def test_normalize_for_retrieval_preserves_hamza_on_waw_and_ya():
    assert normalize_for_retrieval("مسؤولية بيئة") == "مسؤوليه بيئه"


def test_normalize_for_retrieval_folds_presentation_forms():
    # U+FEFB is the lam-alef ligature presentation form.
    assert normalize_for_retrieval("ﻻئحة") == "لائحه"


def test_normalize_digits():
    assert normalize_digits("٢٠١٥ و ۱۲") == "2015 و 12"


def test_detect_language():
    assert detect_language("قانون الاستيراد والتصدير") is Language.AR
    assert detect_language("Rules of Origin") is Language.EN
    assert detect_language("HS 0805 قانون rules") is Language.MIXED
    assert detect_language("12 / 5") is Language.UNKNOWN


def test_quality_flags_reversed_lam_alef():
    corrupted = "قانون االستيراد والتصدير وتعديالته رقم االول"
    quality = assess_text_layer(corrupted)
    assert quality.reversed_lam_alef == 2
    assert quality.score < 0.85


def test_quality_accepts_clean_arabic():
    assert assess_text_layer("قانون الاستيراد والتصدير رقم 21 لسنة 2001").score == 1.0


def test_quality_flags_cid_placeholders_and_empty_pages():
    assert assess_text_layer("Rules (cid:12)(cid:13) of origin").score < 0.85
    assert assess_text_layer("   ").score == 0.0


def test_quality_flags_legacy_encoded_arabic_without_function_words():
    # Valid Arabic letters that form no words (as in the TRC instructions' broken text layer).
    garbled = " ".join(["الالــاا العكئيزـــج الر وئياســـزج المنلمــاا الر لزـــج التنـــاد"] * 20)
    quality = assess_text_layer(garbled)
    assert quality.score < 0.85
    assert any("function words" in r for r in quality.reasons)
    prose = " ".join(["يقدم الطلب إلى الهيئة على النموذج المعتمد في هذه التعليمات من قبل المستورد"] * 10)
    assert assess_text_layer(prose).score == 1.0
