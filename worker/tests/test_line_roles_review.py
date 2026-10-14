"""The read-only hatch/dimension review tool: page list parsing, marks and the overlay."""

import pytest
from pdf_factory import new_doc

from src.linking.lines import page_lines
from src.review.sheet_lines_job import lines_payload
from tools.line_roles_review import classify_rows, overlay, parse_pages


def test_parse_pages_accepts_spaces_commas_and_comments():
    text = "# owner list\njob-018 4\n\nabc-def, 12  # a note\n"
    assert parse_pages(text) == [("job-018", 4), ("abc-def", 12)]
    with pytest.raises(ValueError):
        parse_pages("job-018 four")


def test_marks_and_counts():
    rows = [
        [0, 0, 10, 0, 0, 0.1, 0, 0],
        [0, 0, 100, 0, 0, 0.25, 1, 1],
        [0, 0, 100, 0, 0, 2.0, 3, 0],
    ]
    marks, counts = classify_rows(rows)
    assert marks == ["hatch", "dimension", "other"]
    assert counts["hatch"] == 1 and counts["dimension"] == 1 and counts["role heavy"] == 1


def test_overlay_writes_a_png(tmp_path):
    doc = new_doc()
    page = doc.new_page(width=400, height=300)
    for k in range(10):
        page.draw_line((50, 50 + 1.5 * k), (120, 50 + 1.5 * k), width=0.1)
    page.draw_line((20, 200), (380, 200), width=2.0)
    _, rows, _ = lines_payload(page_lines(page), page)
    marks, _ = classify_rows(rows)
    out = tmp_path / "o.png"
    overlay(page, rows, marks, out)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert marks.count("hatch") == 10
