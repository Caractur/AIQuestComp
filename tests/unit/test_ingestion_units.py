from pathlib import Path

from import_compliance_rag.ingestion.extract import strip_raw_line_noise
from import_compliance_rag.ingestion.font_recovery import (
    GlyphChar,
    RecoveredPage,
    _logical_order,
    _near,
    _reflow_definition_columns,
)
from import_compliance_rag.ingestion.ocr import TesseractOcr


def _line(segments: list[tuple[str, float]], y: float) -> list[GlyphChar]:
    """Build a visual line from (text, right edge x) runs; Arabic glyphs advance right to left."""
    chars = []
    for text, right in segments:
        x = right
        for ch in text:
            x -= 5.0
            chars.append(GlyphChar(ch, None, x, y))
    return chars


def _text(lines: list[list[GlyphChar]]) -> list[str]:
    return RecoveredPage(1, [_logical_order(line) for line in lines], 1.0).text().splitlines()


def test_logical_order_rtl_with_ltr_digit_runs():
    line = _line([("المادة ", 500.0)], 100.0)
    line += [GlyphChar("1", None, 430.0, 100.0), GlyphChar("2", None, 435.0, 100.0)]
    assert _text([line]) == ["المادة 12"]


def test_logical_order_digit_only_line_is_left_to_right():
    line = [GlyphChar(c, None, 100.0 + 5 * i, 50.0) for i, c in enumerate("9/ 5/ 2001")]
    assert _text([line]) == ["9/ 5/ 2001"]


def test_logical_order_counts_presentation_forms_as_arabic():
    # U+FEB3 U+FEE8 U+FE94 = presentation forms of "سنة" as decoded from an embedded font.
    line = [GlyphChar(c, None, 300.0 - 6 * i, 10.0) for i, c in enumerate("ﺳﻨﺔ")]
    assert _text([line]) == ["سنة"]


def _staggered_table() -> list[list[GlyphChar]]:
    # term | ":" (x≈410) | definition (right edge 400). Lines are 16pt apart inside a row and 22pt
    # between rows; terms of two-line rows sit half-way between their definition lines.
    return [
        _line([("مقدمة المادة كلها في سطر واحد", 520.0)], 80.0),
        _line([("الوزارة ", 520.0), (":", 415.0), ("وزارة الزراعة .", 400.0)], 100.0),
        _line([("وحدة للانتاج الزراعي", 400.0)], 122.0),
        _line([("الحيازة ", 520.0), (":", 415.0)], 130.0),
        _line([("لاغراض الانتاج .", 400.0)], 138.0),
        _line([("الحائز ", 520.0), (":", 415.0), ("الشخص الذي يتولى ادارة الحيازة .", 400.0)], 160.0),
    ]


def test_reflow_definition_columns_rebuilds_term_definition_order():
    lines = _reflow_definition_columns([_logical_order(line) for line in _staggered_table()])
    text = [" ".join(t.split()) for t in RecoveredPage(1, lines, 1.0).text().splitlines()]
    assert text == [
        "مقدمة المادة كلها في سطر واحد",
        "الوزارة : وزارة الزراعة .",
        "الحيازة : وحدة للانتاج الزراعي",
        "لاغراض الانتاج .",
        "الحائز : الشخص الذي يتولى ادارة الحيازة .",
    ]


def test_reflow_leaves_aligned_inline_definitions_alone():
    # Colons that merely line up (no line holds only "term :") must not trigger the reflow.
    lines = [
        _line([("الوزارة ", 520.0), (":", 415.0), ("وزارة الصناعة .", 400.0)], 100.0),
        _line([("الوزير ", 520.0), (":", 415.0), ("وزير الصناعة .", 400.0)], 116.0),
        _line([("البضاعة ", 520.0), (":", 415.0), ("كل سلعة .", 400.0)], 132.0),
    ]
    ordered = [_logical_order(line) for line in lines]
    assert _reflow_definition_columns(ordered) == ordered


def test_near_tolerates_half_point_rounding():
    keys = {(round(100.24 * 2), round(50.0 * 2))}
    assert _near((100.26, 50.1), keys)
    assert not _near((102.0, 50.0), keys)


def test_strip_raw_line_noise_only_removes_repetitive_digit_runs():
    assert strip_raw_line_noise("نص السطر 000000 020202") == "نص السطر"
    assert strip_raw_line_noise("البند 2009.11 لسنة 2015") == "البند 2009.11 لسنة 2015"


def test_ocr_container_invocation(tmp_path: Path):
    ocr = TesseractOcr("tesseract", container_image="localhost/icr-tesseract:latest", container_engine="docker")
    args = ocr._invocation("/usr/bin/docker", tmp_path)
    assert args[:3] == ["/usr/bin/docker", "run", "--rm"]
    assert "--network=none" in args
    assert f"{tmp_path}:/work" in args
    assert args[-1] == "localhost/icr-tesseract:latest"
    assert TesseractOcr("tesseract")._invocation("tesseract", tmp_path) == ["tesseract"]
