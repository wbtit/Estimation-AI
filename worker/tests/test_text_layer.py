"""PDF text-layer extraction and the scan upgrade, on synthetic PDFs generated here."""

import pymupdf
import pytest
from pdf_factory import add_lines, add_title_block, new_doc, vector_page

from src.pdf_scan.analyze import analyze_page
from src.text_layer.items import extract_page_text, pdf_item_key
from src.text_layer.parsers.profile import CatalogMatcher
from src.text_layer.quality import GARBLED_BELOW, bad_char_count, is_usable, text_quality

SCALE_18 = '1/8" = 1\'-0"'
SCALE_14 = '1/4" = 1\'-0"'


def garble(doc: pymupdf.Document, page: pymupdf.Page) -> None:
    """Make the page's text extract as private-use characters (a broken font encoding)."""
    xref = page.get_fonts()[0][0]
    cmap = (
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        "/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n"
        "1 begincodespacerange <00> <FF> endcodespacerange\n"
        "26 beginbfchar\n"
        + "".join(f"<{0x41 + i:02X}> <{0xE000 + i:04X}>\n" for i in range(26))
        + "endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end"
    )
    to_unicode = doc.get_new_xref()
    doc.update_object(to_unicode, "<<>>")
    doc.update_stream(to_unicode, cmap.encode())
    doc.xref_set_key(xref, "ToUnicode", f"{to_unicode} 0 R")


def reopen(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(), filetype="pdf")


# --- quality -----------------------------------------------------------------------------------
def test_text_quality_counts_private_use_replacement_and_unassigned_characters() -> None:
    assert text_quality("W12X26 BEAM 12'-6\"") == 1.0
    assert text_quality("") is None and text_quality("   \n") is None
    assert text_quality("AB") == 0.5  # two of four are private use
    assert text_quality("AB��") == 0.5
    assert text_quality("AB͸͹") == 0.5  # unassigned code points
    assert bad_char_count("A\u0001B") == 1
    assert text_quality("A B–C") == 1.0  # a no-break space and an en dash are fine


def test_the_usable_threshold() -> None:
    assert is_usable(1.0) and is_usable(GARBLED_BELOW)
    assert not is_usable(GARBLED_BELOW - 0.01) and not is_usable(None)


# --- extraction --------------------------------------------------------------------------------
def test_words_and_lines_have_boxes_quality_and_parser_output() -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 100), "(2) W12x26 BEAMS AT 12'-6\" B1 S4.1", fontsize=12)
    text = extract_page_text(reopen(doc)[0])
    assert text.has_text_layer and text.usable and text.quality == 1.0
    lines = [i for i in text.items if i.level == "line"]
    words = [i for i in text.items if i.level == "word"]
    assert len(lines) == 1 and len(words) == 7
    assert 49 < lines[0].bbox[0] < 52 and 85 < lines[0].bbox[1] < 100
    kinds = {p["kind"] for p in lines[0].parsed}
    assert kinds == {"profile", "dimension"}
    assert next(p for p in lines[0].parsed if p["kind"] == "profile")["canonical"] == "W12X26"
    by_text = {w.text: w for w in words}
    assert by_text["S4.1"].parsed[0]["kind"] == "sheet_number"
    assert by_text["B1"].parsed[0]["kind"] == "mark_candidate"
    assert by_text["B1"].parsed[0]["claims_member"] is False
    assert all(
        w.angle_deg == 0.0 and w.orientation == "horizontal" and not w.rotated for w in words
    )


def test_rotated_text_is_kept_and_flagged() -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 100), "UPRIGHT NOTE TEXT HERE", fontsize=12)
    page.insert_text((300, 500), "SIDEWAYS W12x26 NOTE", fontsize=12, rotate=90)
    page.insert_text(
        (600, 100),
        "SLANTED TEXT LINE",
        fontsize=12,
        morph=(pymupdf.Point(600, 100), pymupdf.Matrix(30)),
    )
    text = extract_page_text(reopen(doc)[0])
    lines = {i.text: i for i in text.items if i.level == "line"}
    assert (
        lines["UPRIGHT NOTE TEXT HERE"].angle_deg == 0
        and not lines["UPRIGHT NOTE TEXT HERE"].rotated
    )
    side = lines["SIDEWAYS W12x26 NOTE"]
    assert side.angle_deg == 90.0 and side.orientation == "vertical" and side.rotated
    assert side.parsed[0]["canonical"] == "W12X26"  # still parsed
    slanted = lines["SLANTED TEXT LINE"]
    assert slanted.rotated and slanted.orientation == "horizontal"
    assert 25 < min(slanted.angle_deg, 360 - slanted.angle_deg) < 35


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_a_page_stored_rotated_keeps_upright_text_upright_in_displayed_coordinates(
    rotation: int,
) -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.set_rotation(rotation)
    inverse = ~page.rotation_matrix
    # draw text so that it reads left to right on the displayed page at displayed (100, 100)
    morph = (pymupdf.Point(100, 100) * inverse, pymupdf.Matrix(rotation))
    page.insert_text(
        pymupdf.Point(100, 100) * inverse, "UPRIGHT W12x26 TEXT", fontsize=12, morph=morph
    )
    text = extract_page_text(reopen(doc)[0])
    line = next(i for i in text.items if i.level == "line")
    assert line.angle_deg == 0.0 and not line.rotated
    assert 95 < line.bbox[0] < 105 and 85 < line.bbox[1] < 105  # displayed position


def test_mixed_fonts_and_sizes_still_parse() -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 100), "HSS6x4x1/4", fontname="helv", fontsize=9)
    page.insert_text((50, 130), "L3x3x1/4", fontname="cour", fontsize=14)
    page.insert_text((50, 160), "PL 1/2 x 8", fontname="tiro", fontsize=20)
    page.insert_text((50, 190), "12'-6 1/2\" (T.O.S. EL. 100'-0\")", fontname="hebo", fontsize=11)
    text = extract_page_text(reopen(doc)[0])
    parsed = [p for i in text.items if i.level == "line" for p in (i.parsed or [])]
    assert {p["canonical"] for p in parsed if p["kind"] == "profile"} == {
        "HSS6X4X1/4",
        "L3X3X1/4",
        "PL1/2X8",
    }
    assert [p["kind"] for p in parsed if p["kind"] in ("dimension", "elevation")] == [
        "dimension",
        "elevation",
    ]  # the elevation value is reported once, inside the elevation


def test_parsed_profiles_carry_the_catalog_validation() -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 100), "L3x3x1/4 AND W12x26 AND W99x99", fontsize=12)
    catalog = CatalogMatcher(["L3X3X0.25", "W12X26"])
    text = extract_page_text(reopen(doc)[0], catalog)
    line = next(i for i in text.items if i.level == "line")
    statuses = [p["validation"]["status"] for p in line.parsed if p["kind"] == "profile"]
    assert statuses == ["matched_by_numeric_equivalence", "matched_exact", "unvalidated"]


def test_a_garbled_encoding_page_is_not_usable() -> None:
    doc = new_doc()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 100), "HELLO WORLD BEAM FRAMING PLAN", fontname="helv", fontsize=12)
    garble(doc, page)
    text = extract_page_text(reopen(doc)[0])
    assert text.has_text_layer and text.quality is not None and text.quality < 0.1
    assert not text.usable


def test_word_and_line_keys_differ_and_are_stable() -> None:
    box = (10.0, 20.0, 30.0, 40.0)
    assert pdf_item_key("s", "word", box) != pdf_item_key("s", "line", box)
    assert pdf_item_key("s", "word", box) == pdf_item_key("s", "word", box)
    assert pdf_item_key("s", "word", box) == pdf_item_key("s", "word", (10.1, 20.1, 30.1, 40.1))


# --- the scan upgrade --------------------------------------------------------------------------
def test_the_scan_records_provenance_and_confidence_for_text_values() -> None:
    doc = new_doc()
    vector_page(doc, "S4.1", "SECOND FLOOR FRAMING PLAN", texts=[((60, 700), SCALE_18, 10)])
    scan = analyze_page(reopen(doc)[0])
    assert scan.sheet_number == "S4.1" and scan.text_quality == 1.0
    ev = scan.evidence
    assert ev["method"] == "pdf_text" and ev["conflicts"] == []
    assert ev["sheet_number"]["rule"] == "label" and ev["sheet_number"]["confidence"] == 0.9
    assert ev["sheet_number"]["bbox"]["x0"] > 900  # the title block, bottom right
    assert ev["title"]["value"] == "SECOND FLOOR FRAMING PLAN" and ev["title"]["confidence"] > 0
    assert ev["classification"]["kind"] == scan.kind == "plan"
    assert len(ev["scales"]) == 1 and ev["scales"][0]["ratio"] == 96
    assert ev["scales"][0]["bbox"]["y0"] > 600 and scan.scale_parsed_ratio == 96
    assert "sheet_number_conflict" not in scan.review_reasons


def test_a_sheet_number_in_the_region_has_lower_confidence_than_a_label() -> None:
    doc = new_doc()
    vector_page(doc, "S4.1", labelled=False)
    scan = analyze_page(reopen(doc)[0])
    assert scan.sheet_number_source == "title_block_region"
    assert scan.evidence["sheet_number"]["confidence"] == 0.7


def test_conflicting_sheet_numbers_stay_for_review_with_a_reason() -> None:
    doc = new_doc()
    page = vector_page(doc, "S4.1", "FRAMING PLAN")  # the labelled number
    page.insert_text((1190 - 200, 700), "S9.9", fontsize=40)  # a much larger different number
    scan = analyze_page(reopen(doc)[0])
    assert scan.sheet_number == "S4.1"  # the label-anchored value is kept as extracted ...
    assert "sheet_number_conflict" in scan.review_reasons and scan.needs_review
    assert scan.evidence["conflicts"] == [{"field": "sheet_number", "values": ["S4.1", "S9.9"]}]
    assert scan.evidence["sheet_number"]["confidence"] < 0.5


def test_several_scales_are_listed_and_flagged_not_picked() -> None:
    doc = new_doc()
    vector_page(doc, "S4.1", texts=[((60, 700), SCALE_18, 10), ((60, 720), SCALE_14, 10)])
    scan = analyze_page(reopen(doc)[0])
    assert scan.scale_parsed is None and "multiple_scales" in scan.review_reasons
    assert {s["ratio"] for s in scan.evidence["scales"]} == {96, 48}
    assert all(s["confidence"] == 0.5 for s in scan.evidence["scales"])
    assert scan.evidence["conflicts"][0]["field"] == "scale"


def test_a_garbled_text_layer_is_not_used_by_the_scan() -> None:
    doc = new_doc()
    page = doc.new_page(width=1200, height=800)
    add_lines(page)
    page.insert_text(
        (60, 100), "SHEET NO. SHEET TITLE FRAMING PLAN SCALE", fontname="helv", fontsize=14
    )
    garble(doc, page)
    scan = analyze_page(reopen(doc)[0])
    assert scan.has_text_layer and scan.text_quality < GARBLED_BELOW
    assert "text_layer_garbled" in scan.review_reasons and scan.needs_review
    assert scan.sheet_number is None and scan.title is None and scan.scales == []
    assert scan.evidence is None


def test_a_clean_page_without_a_title_block_is_flagged_not_filled() -> None:
    doc = new_doc()
    page = doc.new_page(width=1200, height=800)
    add_lines(page)
    add_title_block(page, "S4.1", labelled=False)
    scan = analyze_page(reopen(doc)[0])
    assert scan.sheet_number == "S4.1"
    assert scan.title is None and "title_not_found" in scan.review_reasons
    assert scan.evidence["title"] is None
