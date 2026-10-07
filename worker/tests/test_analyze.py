"""Page analysis on SYNTHETIC PDFs built inside the tests (no real drawings)."""

import pymupdf
import pytest
from pdf_factory import (
    blank_page,
    new_doc,
    rotated_vector_page,
    scanned_page,
    vector_page,
)

from src.pdf_scan.analyze import analyze_page, render_thumbnail_png

SCALE_18 = '1/8" = 1\'-0"'
SCALE_14 = '1/4" = 1\'-0"'


def scan(build):  # type: ignore[no-untyped-def]
    doc = new_doc()
    page = build(doc)
    return analyze_page(page)


# ---- vector vs scanned -----------------------------------------------------------------------


def test_vector_page_with_text_layer() -> None:
    s = scan(
        lambda d: vector_page(d, "S030", "TRELLIS FRAMING PLAN", texts=[((60, 500), SCALE_18, 14)])
    )
    assert (s.page_kind, s.has_text_layer, s.has_vector_paths) == ("vector", True, True)
    assert s.vector_path_count >= 80 and s.text_char_count >= 20
    assert (s.width_pt, s.height_pt, s.rotation) == (1200, 800, 0)


def test_image_only_page_is_scanned_and_unsupported_in_v0() -> None:
    s = scan(scanned_page)
    assert s.page_kind == "scanned"
    assert s.image_coverage >= 0.9 and not s.has_vector_paths
    assert s.review_reasons == ["scanned_unsupported_v0"]
    assert s.needs_review
    assert (s.sheet_number, s.title, s.scales) == (None, None, [])
    assert (s.kind, s.kind_confidence) == ("other", 0.0)


def test_scanned_page_with_hidden_ocr_text_is_still_scanned_and_nothing_is_extracted() -> None:
    s = scan(lambda d: scanned_page(d, with_hidden_text=True))
    assert s.page_kind == "scanned"
    assert s.has_text_layer  # the hidden layer exists...
    assert s.sheet_number is None and s.title is None  # ...but is not trusted or used
    assert s.review_reasons == ["scanned_unsupported_v0"]


def test_blank_page_is_unknown() -> None:
    s = scan(blank_page)
    assert s.page_kind == "unknown"
    assert s.review_reasons == ["no_usable_content"]


def test_vector_drawing_without_text_layer_is_vector_but_text_fields_are_flagged() -> None:
    """What the real drawing set looks like: lots of vector paths, text outlined as curves."""
    s = scan(lambda d: vector_page(d))
    assert (s.page_kind, s.has_text_layer, s.has_vector_paths) == ("vector", False, True)
    assert s.sheet_number is None and s.title is None and s.scales == []
    assert (s.kind, s.kind_confidence) == ("other", 0.0)
    assert s.review_reasons == [
        "no_text_layer",
        "sheet_number_not_found",
        "title_not_found",
        "classification_no_evidence",
        "scale_not_found",
    ]


def test_thumbnail_is_a_png_with_the_configured_long_edge() -> None:
    doc = new_doc()
    page = vector_page(doc, "S030")
    png = render_thumbnail_png(page)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    pix = pymupdf.Pixmap(png)
    assert max(pix.width, pix.height) == 480
    assert pix.width > pix.height  # landscape page stays landscape


# ---- sheet number and title ------------------------------------------------------------------


@pytest.mark.parametrize("number", ["S001", "S030", "S4.1", "S-101", "S2.01", "S101A", "SD1.2"])
def test_label_anchored_sheet_numbers(number: str) -> None:
    s = scan(lambda d: vector_page(d, number, "TYPICAL DETAILS"))
    assert (s.sheet_number, s.sheet_number_source) == (number, "label")
    assert s.title == "TYPICAL DETAILS"


def test_s4_1_style_sheet_is_classified_as_details() -> None:
    s = scan(lambda d: vector_page(d, "S4.1", "TYPICAL DETAILS"))
    assert (s.sheet_number, s.kind, s.kind_confidence) == ("S4.1", "detail", 0.9)


def test_unlabelled_number_is_taken_from_the_title_block_corner_if_clearly_largest() -> None:
    s = scan(lambda d: vector_page(d, "S031", labelled=False))
    assert (s.sheet_number, s.sheet_number_source) == ("S031", "title_block_region")


def test_two_equally_large_candidates_are_ambiguous_not_guessed() -> None:
    s = scan(lambda d: vector_page(d, "S030", labelled=False, texts=[((980, 700), "S031", 24)]))
    assert s.sheet_number is None
    assert "sheet_number_ambiguous" in s.review_reasons


def test_small_marks_near_the_corner_are_not_mistaken_for_a_sheet_number() -> None:
    s = scan(
        lambda d: vector_page(
            d, texts=[((980, 740), "C1", 8), ((1000, 760), "B2", 8), ((1010, 770), "DATE", 8)]
        )
    )
    assert s.sheet_number is None
    assert "sheet_number_not_found" in s.review_reasons


def test_two_different_labelled_numbers_are_ambiguous() -> None:
    s = scan(
        lambda d: vector_page(
            d,
            texts=[
                ((900, 700), "SHEET NO.", 7),
                ((900, 730), "S030", 20),
                ((300, 700), "DWG NO.", 7),
                ((300, 730), "S031", 20),
            ],
        )
    )
    assert s.sheet_number is None
    assert "sheet_number_ambiguous" in s.review_reasons


def test_inline_label_value() -> None:
    s = scan(
        lambda d: vector_page(
            d, texts=[((700, 740), "SHEET NO: S032", 10), ((100, 300), "GENERAL TEXT LAYER", 8)]
        )
    )
    assert (s.sheet_number, s.sheet_number_source) == ("S032", "label")


def test_title_without_a_label_is_not_guessed() -> None:
    s = scan(
        lambda d: vector_page(d, "S030", None, texts=[((600, 700), "TRELLIS FRAMING PLAN", 16)])
    )
    assert s.title is None
    assert "title_not_found" in s.review_reasons


def test_multi_line_title_stops_at_the_next_label() -> None:
    s = scan(
        lambda d: vector_page(
            d,
            texts=[
                ((100, 700), "SHEET TITLE", 7),
                ((100, 720), "FIRST FLOOR", 12),
                ((100, 735), "FRAMING PLAN", 12),
                ((100, 760), "DATE", 7),
                ((100, 770), "2026-01-01", 12),
            ],
        )
    )
    assert s.title == "FIRST FLOOR FRAMING PLAN"
    assert (s.kind, s.kind_confidence) == ("plan", 0.9)


# ---- classification from the page when there is no title -------------------------------------


def test_large_all_caps_view_title_classifies_a_sheet_with_no_title_block() -> None:
    s = scan(
        lambda d: vector_page(
            d,
            texts=[
                ((100, 300), "SEE DETAIL 5 ON S4.1", 8),
                ((100, 320), "TYPICAL BEAM SPLICE NOTE", 8),
                ((100, 340), "WEST ELEVATION NOTE", 8),
                ((100, 360), "SEE SCHEDULE ABOVE", 8),
                ((100, 500), "TRELLIS FRAMING PLAN", 20),
            ],
        )
    )
    assert (s.kind, s.kind_confidence) == ("plan", 0.6)
    assert "low_confidence_classification" in s.review_reasons


# ---- scales ----------------------------------------------------------------------------------


def test_single_scale_becomes_the_parsed_sheet_scale() -> None:
    s = scan(
        lambda d: vector_page(
            d, "S030", "TRELLIS FRAMING PLAN", texts=[((60, 500), f"SCALE: {SCALE_18}", 12)]
        )
    )
    assert s.scale_parsed == SCALE_18
    assert s.scale_parsed_ratio == 96
    assert s.scales == [{"raw": SCALE_18, "kind": "ratio", "ratio": 96.0, "count": 1}]
    assert s.review_reasons == []
    assert not s.needs_review


def test_multi_scale_page_stores_all_scales_and_leaves_the_sheet_scale_unset() -> None:
    s = scan(
        lambda d: vector_page(
            d,
            "S4.1",
            "TYPICAL DETAILS",
            texts=[
                ((60, 500), SCALE_14, 12),
                ((400, 500), SCALE_18, 12),
                ((700, 500), "NTS", 12),
                ((60, 600), SCALE_14, 12),
            ],
        )
    )
    assert [(e["ratio"], e["count"]) for e in s.scales] == [(48.0, 2), (96.0, 1), (None, 1)]
    assert s.scale_parsed is None and s.scale_parsed_ratio is None
    assert s.review_reasons == ["multiple_scales"]
    assert s.needs_review


def test_no_scale_is_flagged() -> None:
    s = scan(lambda d: vector_page(d, "S030", "TRELLIS FRAMING PLAN"))
    assert s.scales == [] and s.scale_parsed is None
    assert s.review_reasons == ["scale_not_found"]


def test_nts_only_page_has_a_scale_entry_without_a_ratio() -> None:
    s = scan(lambda d: vector_page(d, "S001", "GENERAL NOTES", texts=[((60, 500), "NTS", 12)]))
    assert s.scale_parsed == "NTS" and s.scale_parsed_ratio is None


# ---- rotation --------------------------------------------------------------------------------


@pytest.mark.parametrize("rotation", [90, 270])
def test_title_block_is_found_on_rotated_pages(rotation: int) -> None:
    """PyMuPDF reports unrotated coordinates; position logic must use the displayed page."""
    s = scan(lambda d: rotated_vector_page(d, rotation, "S030"))
    assert (s.width_pt, s.height_pt, s.rotation) == (1200, 800, rotation)
    assert (s.sheet_number, s.sheet_number_source) == ("S030", "title_block_region")


def test_unrotated_and_rotated_pages_give_the_same_result() -> None:
    plain = scan(lambda d: vector_page(d, "S030", labelled=False))
    rotated = scan(lambda d: rotated_vector_page(d, 270, "S030"))
    assert (plain.sheet_number, plain.page_kind) == (rotated.sheet_number, rotated.page_kind)
