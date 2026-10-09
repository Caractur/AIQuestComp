"""Regressions on the real official PDFs (skipped when they are not downloaded).

These pin down defects found while validating extraction against the rendered pages. Font recovery
is exercised directly, without OCR, so the tests need no tesseract installation.
"""

from __future__ import annotations

import re

import pymupdf
import pytest

from import_compliance_rag.ingestion.font_recovery import FontRecovery
from import_compliance_rag.ingestion.structure import parse_structure
from import_compliance_rag.schemas.regulatory import Language
from import_compliance_rag.text.arabic import clean_original, normalize_digits
from tests.conftest import raw_pdf

pytestmark = pytest.mark.real_sources


def _recovered(document_id: str) -> list[tuple[int, str]]:
    with pymupdf.open(raw_pdf(document_id)) as doc:
        recovery = FontRecovery(doc)
        return [(n + 1, clean_original(recovery.recover_page(doc[n], n + 1).text())) for n in range(doc.page_count)]


def _headings(pages: list[tuple[int, str]]) -> list[str]:
    structure = parse_structure(pages, Language.AR)
    return [s.number for s in structure.segments if s.kind == "article"]


def test_law_21_clause_numbers_from_non_embedded_font():
    """Clause markers drawn with the non-embedded "Times New Roman" must not be decoded through the
    embedded font of the same name (previously ".2" -> ".0" and ".3" -> ".1")."""
    pages = dict(_recovered("mit-import-export-law-21-2001"))
    article_10 = pages[2].split("المادة 10", 1)[1]
    markers = re.findall(r"^\.(\d)", article_10, flags=re.M)
    assert markers == ["1", "2", "3"]
    assert ".2البضاعة التي يشترط لاستيرادها" in pages[1]


def test_law_21_closing_date_reads_left_to_right():
    pages = dict(_recovered("mit-import-export-law-21-2001"))
    assert pages[3].splitlines()[-1] == "9/ 5/ 2001"


def test_bylaw_114_heading_numbers_and_gazette_reference():
    """A heading digit whose broken ToUnicode label coincides with the substitute font's glyph order
    (gid 21 = '2' embedded, labelled '4') must still decode as '2'."""
    pages = _recovered("mit-import-export-licenses-system-114-2004")
    assert _headings(pages) == [str(n) for n in range(1, 17)]
    assert "رقم 4677 بتاريخ 30/9/2004" in pages[0][1]


def test_agriculture_law_all_74_headings_with_eastern_numerals():
    pages = _recovered("moa-agriculture-law-13-2015")
    numbers = [normalize_digits(n) for n in _headings(pages)]
    expected = [str(n) for n in range(1, 64)] + ["63 مكرر"] + [str(n) for n in range(64, 74)]
    assert numbers == expected


def test_agriculture_law_definition_table_reading_order():
    pages = dict(_recovered("moa-agriculture-law-13-2015"))
    lines = [" ".join(line.split()) for line in pages[1].splitlines()]
    assert "الحيازة الزراعية : وحدة للانتاج الزراعي تخضع لادارة واحدة لاستغلالها بصورة كلية او" in lines
    assert "الحائز : الشخص الطبيعي او الاعتباري الذي يتولى ادارة حيازة زراعية" in lines
    page_2 = [" ".join(line.split()) for line in pages[2].splitlines()]
    assert any(line.startswith("الاراضي الزراعية : الاراضي التي تصلح لزراعة") for line in page_2)
    # Terms wrapped over several lines that share lines with their definition (page 4).
    page_4 = [" ".join(line.split()) for line in pages[4].splitlines()]
    assert any(line.startswith("تقييم الكوارث الزراعية : هي العملية التي تحدد") for line in page_4)
    assert any(line.startswith("تدابير الصحة والصحة النباتية والصحة الحيوانية : أي تشريعات") for line in page_4)
    assert any(line.startswith("الغراس ( الغرسة ) : اشتال الاشجار المثمرة") for line in page_4)
    # No defined term may be left on a line of its own (the staggered layout).
    for term in ("الحيازة الزراعية", "الحائز", "النباتات", "الافة"):
        assert f"{term} :" not in lines
