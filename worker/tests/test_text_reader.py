"""Reading synthetic pages: clusters, matching, lines, small-mark rules. No database."""

from collections import Counter

import pymupdf
import pytest
from stroke_font import GLYPHS, confirmed_library, draw_text, new_doc_page

from src.text_reader import rules
from src.text_reader.library import Matcher, new_entry
from src.text_reader.reader import read_page
from src.text_reader.strokes import extract_clusters

FONT = "test-font"


def read(page, entries=None, ocr=None):
    entries = confirmed_library(FONT) if entries is None else entries
    matcher = Matcher(entries)
    by_hash = {e.signature_hash: e for e in entries}
    return read_page(page, matcher, FONT, Counter(), by_hash, ocr)


def texts(read_result) -> list[str | None]:
    return [i.text for i in read_result.items if i.orientation == "horizontal"]


# --- stroke clusters ---------------------------------------------------------------------------
def test_strokes_of_one_character_merge_into_one_cluster() -> None:
    _, page = new_doc_page()
    draw_text(page, "H", 50, 50)
    clusters = extract_clusters(page)
    assert len(clusters) == 1 and len(clusters[0].strokes) == 3  # H is three separate strokes


def test_one_cluster_per_character() -> None:
    _, page = new_doc_page()
    draw_text(page, "B1 CONT", 50, 50)
    assert len(extract_clusters(page)) == 6


def test_long_lines_light_colours_and_fills_are_not_characters() -> None:
    _, page = new_doc_page()
    page.draw_line((10, 10), (300, 10), width=0.84)  # a line, far longer than a character
    page.draw_polyline([(20, 20), (24, 26)], color=(0.8, 0.8, 0.8), width=0.84)  # light grey
    page.draw_rect(pymupdf.Rect(40, 40, 46, 46), color=None, fill=(0, 0, 0))  # filled, not stroked
    draw_text(page, "A", 100, 100)
    clusters = extract_clusters(page)
    assert len(clusters) == 1 and clusters[0].x0 > 99


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_cluster_coordinates_are_displayed_coordinates_on_rotated_pages(rotation: int) -> None:
    _, page = new_doc_page(rotation=rotation)
    bbox = draw_text(page, "B2", 100, 50)
    cl = extract_clusters(page)
    x0, y0 = min(c.x0 for c in cl), min(c.y0 for c in cl)
    x1, y1 = max(c.x1 for c in cl), max(c.y1 for c in cl)
    assert (x0, y0, x1, y1) == pytest.approx(bbox, abs=0.05)


# --- decoding ----------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "text",
    [
        "B2",
        "B1",
        "S4.1",
        "HSS6x4x1/4",
        "BEAM LEGEND",
        "TYP",
        "= 1'-0",
        "B1:",
        "12'-6",
        "W18X35 FLAT",
    ],
)
def test_decodes_text_with_a_confirmed_library(text: str) -> None:
    _, page = new_doc_page()
    draw_text(page, text, 50, 50)
    assert texts(read(page)) == [text]


def test_character_size_does_not_matter() -> None:
    _, page = new_doc_page()
    draw_text(page, "S4.1", 50, 50, size=1.1)
    draw_text(page, "S4.1", 50, 150, size=1.9)
    assert texts(read(page)) == ["S4.1", "S4.1"]


def test_lower_case_x_is_decided_by_height() -> None:
    _, page = new_doc_page()
    draw_text(page, "6x4X1", 50, 50)
    assert texts(read(page)) == ["6x4X1"]


def test_underline_is_not_part_of_the_text() -> None:
    _, page = new_doc_page()
    draw_text(page, "BEAM", 50, 50, underline=True)
    r = read(page)
    assert texts(r) == ["BEAM"]
    assert r.stats["unassigned_clusters"] >= 1  # the underline is counted, not read


def test_two_stacked_bars_are_an_equals_sign_and_one_bar_is_a_hyphen() -> None:
    _, page = new_doc_page()
    draw_text(page, "A=B", 50, 50)
    draw_text(page, "A-B", 50, 120)
    assert texts(read(page)) == ["A=B", "A-B"]


def test_unknown_shapes_decode_to_question_marks_and_are_counted() -> None:
    _, page = new_doc_page()
    draw_text(page, "B2", 50, 50)
    # a symbol that is not in the library: a spiral
    spiral = [(0, 3), (2, 0), (4, 3), (2, 6), (1, 4), (2, 3), (3, 3.5)]
    page.draw_polyline([pymupdf.Point(150 + x * 1.1, 50 + y * 1.1) for x, y in spiral], width=0.84)
    page.draw_polyline(
        [pymupdf.Point(156 + x * 1.1, 50 + y * 1.1) for x, y in GLYPHS["N"][0]], width=0.84
    )
    r = read(page)
    unknown_items = [i for i in r.items if i.unknown_count]
    assert texts(r) == ["B2", "?N"] and r.stats["unknown_characters"] == 1
    assert len(unknown_items) == 1
    it = unknown_items[0]
    assert it.needs_review and it.review_reasons == [rules.REASON_UNKNOWN_GLYPH]
    assert it.confidence == rules.CONF_GLYPH_UNKNOWN


def test_only_confirmed_labels_decode() -> None:
    _, page = new_doc_page()
    draw_text(page, "B2", 50, 50)
    proposed = [new_entry(FONT, GLYPHS[c], label=c, status="proposed") for c in "B2"]
    r = read(page, entries=proposed)
    assert texts(r) == ["??"] and r.stats["unknown_characters"] == 2
    assert r.stats["matched_unconfirmed"] == 2 and r.stats["matched_confirmed"] == 0


def test_an_empty_library_proposes_one_group_per_distinct_shape() -> None:
    _, page = new_doc_page()
    draw_text(page, "B2 B2 B1", 50, 50)
    r = read(page, entries=[])
    assert texts(r) == ["?? ?? ??"]
    assert r.stats["new_groups"] == 3  # B, 2, 1
    assert r.stats["unknown_characters"] == 6


def test_confidence_and_flags_without_ocr() -> None:
    _, page = new_doc_page()
    draw_text(page, "B2", 50, 50)
    (item,) = read(page).items
    assert (item.confidence, item.needs_review, item.review_reasons) == (
        rules.CONF_GLYPH_ONLY,
        False,
        [],
    )
    assert (item.methods, item.agree, item.ocr_text) == (["glyph"], None, None)


def test_a_single_character_is_not_a_line() -> None:
    _, page = new_doc_page()
    draw_text(page, "B", 50, 50)
    r = read(page)
    assert r.items == [] and r.stats["unassigned_clusters"] == 1


def test_word_spacing_follows_the_fixed_rule() -> None:
    _, page = new_doc_page()
    draw_text(page, "AB CD EF", 50, 50)
    assert texts(read(page)) == ["AB CD EF"]


# --- vertical text -----------------------------------------------------------------------------
def test_vertical_text_is_reported_as_not_read_with_a_count() -> None:
    _, page = new_doc_page()
    draw_text(page, "B2", 50, 50)
    draw_text(page, "LATTICE", 300, 300, vertical=True)
    r = read(page)
    vertical = [i for i in r.items if i.orientation == "vertical"]
    assert r.stats["vertical_lines"] == 1 and len(vertical) == 1
    v = vertical[0]
    assert v.text is None and v.methods == [] and v.needs_review
    assert v.review_reasons == [rules.REASON_VERTICAL_NOT_READ] and v.char_count == 7
    assert texts(r) == ["B2"]  # the vertical text did not leak into the upright decode


# --- rotation and determinism ------------------------------------------------------------------
@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_pages_read_the_same_text(rotation: int) -> None:
    _, page = new_doc_page(rotation=rotation)
    draw_text(page, "HSS6x4x3/8", 80, 60)
    draw_text(page, "S4.1", 80, 160)
    r = read(page)
    assert texts(r) == ["HSS6x4x3/8", "S4.1"]
    assert r.items[0].bbox[0] == pytest.approx(80, abs=0.1)


def test_reading_is_deterministic() -> None:
    _, page = new_doc_page()
    draw_text(page, "BEAM LEGEND", 50, 50)
    draw_text(page, "B1: HSS6x4x1/4", 50, 80)
    a = read(page, entries=[])
    b = read(page, entries=[])
    assert [(i.bbox, i.text) for i in a.items] == [(i.bbox, i.text) for i in b.items]
    assert a.stats == b.stats
