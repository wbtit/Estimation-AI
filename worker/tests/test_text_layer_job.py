"""read_text with the PDF text layer against the real Postgres (`make up`, `make migrate`).

PDFs are synthetic and built here. A page is read by one reader only, never both.
"""

import uuid
from collections.abc import Iterator

import pymupdf
import pytest
from db_fixtures import DbProject, vector_text_page
from pdf_factory import add_lines, new_doc, scanned_page, vector_page
from stroke_font import draw_text
from test_text_layer import garble

from src.text_layer.catalog import load_catalog
from src.text_reader.job import read_project

SCALE = '1/8" = 1\'-0"'


@pytest.fixture
def edition(dbp: DbProject) -> Iterator[str]:
    name = f"TEST-ED-{uuid.uuid4()}"
    rows = [("W12X26", "W"), ("L3X3X0.25", "L"), ("HSS6X4X1/4", "HSS")]
    for shape, family in rows:
        dbp.conn.execute(
            "INSERT INTO catalog_shapes (edition, shape_name, family, weight_kg_per_m)"
            " VALUES (%s, %s, %s, 10)",
            (name, shape, family),
        )
    dbp.conn.commit()
    yield name
    dbp.conn.execute("DELETE FROM catalog_shapes WHERE edition = %s", (name,))
    dbp.conn.commit()


def build_pdf(dbp: DbProject) -> None:
    doc = new_doc()
    vector_page(
        doc,
        "S4.1",
        "SECOND FLOOR FRAMING PLAN",
        texts=[
            ((60, 700), SCALE, 10),
            ((60, 720), "(2) W12x26 AND L3x3x1/4 AND PL1/2x8, SPAN 12'-6\" B1", 10),
            ((60, 740), "T.O.S. EL. 100'-0\"", 10),
        ],
    )
    glyph_page = vector_text_page(doc)  # outlined strokes, no text layer
    draw_text(glyph_page, "BEAM B2", 60, 80)
    bad = doc.new_page(width=1200, height=800)
    add_lines(bad)
    bad.insert_text(
        (60, 100), "HELLO WORLD BEAM FRAMING PLAN", fontname="cour", fontsize=14
    )  # own font
    garble(doc, bad)
    bad_glyphs = bad  # same page also gets stroked text, which is what the fallback reads
    draw_text(bad_glyphs, "FLAT", 60, 200)
    scanned_page(doc)
    dbp.pdf_path.write_bytes(doc.tobytes())
    doc.close()


def sheets(dbp: DbProject) -> list[dict]:
    return list(
        dbp.conn.execute(
            "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        ).fetchall()
    )


def items(dbp: DbProject, page: int) -> list[dict]:
    return [i for i in dbp.items() if i["page_index"] == page]


def test_each_page_uses_one_reader_and_the_choice_is_recorded(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    totals = read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    assert totals["pages_pdf_text"] == 1 and totals["pages_glyph"] == 2
    assert totals["pages_garbled_text_layer"] == 1 and totals["pages_skipped"] == 1

    s = sheets(dbp)
    assert [r["text_source"] for r in s] == ["pdf_text", "glyph", "glyph", "none"]
    assert float(s[0]["text_quality"]) == 1.0 and s[1]["text_quality"] is None
    assert float(s[2]["text_quality"]) < 0.1  # the garbled page keeps its measured quality
    assert "text_layer_garbled" in s[2]["review_reasons"] and s[2]["needs_review"]
    assert s[3]["text_quality"] is None

    pdf_items = items(dbp, 0)
    assert pdf_items and all(
        i["methods"] == ["pdf_text"] and i["font_id"] == "pdf_text" for i in pdf_items
    )
    assert {i["level"] for i in pdf_items} == {"word", "line"}
    for page in (1, 2):
        got = items(dbp, page)
        assert got and all(
            "pdf_text" not in i["methods"] and i["font_id"] == dbp.font_id for i in got
        )
        assert all(i["level"] is None and i["parsed"] is None for i in got)
    assert items(dbp, 3) == []  # a scanned page is not read at all


def test_pdf_text_items_store_geometry_quality_and_parsed_values(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    got = items(dbp, 0)
    keys = [i["item_key"] for i in got]
    assert len(keys) == len(set(keys))
    line = next(i for i in got if i["level"] == "line" and "W12x26" in i["text"])
    assert float(line["confidence"]) == 1.0 and float(line["angle_deg"]) == 0.0
    assert line["orientation"] == "horizontal" and not line["needs_review"]
    assert line["unknown_count"] == 0 and line["char_count"] == len("".join(line["text"].split()))
    assert float(line["x1"]) > float(line["x0"]) and float(line["y1"]) > float(line["y0"])
    kinds = sorted(p["kind"] for p in line["parsed"])
    assert kinds == ["dimension", "profile", "profile", "profile"]  # the span, not the plate length
    elevation = next(i for i in got if i["level"] == "line" and "T.O.S" in i["text"])
    note = next(p for p in elevation["parsed"] if p["kind"] == "elevation")
    assert note["kind"] == "elevation" and note["datum_unknown"] is True and not note["is_relative"]
    word = next(i for i in got if i["level"] == "word" and i["text"] == "B1")
    assert word["parsed"][0]["claims_member"] is False
    sheet_word = next(i for i in got if i["level"] == "word" and i["text"] == "S4.1")
    assert sheet_word["parsed"][0]["kind"] == "sheet_number"
    scale_line = next(i for i in got if i["level"] == "line" and "1/8" in i["text"])
    assert [p["kind"] for p in scale_line["parsed"]] == ["scale"]  # not also two dimensions
    assert scale_line["parsed"][0]["ratio"] == 96


def test_rereading_replaces_items_and_keeps_stable_keys(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    args = (dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    read_project(*args)
    first = {i["item_key"] for i in dbp.items()}
    n = len(dbp.items())
    read_project(*args)
    assert len(dbp.items()) == n and {i["item_key"] for i in dbp.items()} == first


def test_catalog_validation_is_recorded_when_an_edition_is_given(
    dbp: DbProject, edition: str
) -> None:
    build_pdf(dbp)
    dbp.scan()
    read_project(
        dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, catalog_edition=edition
    )
    line = next(i for i in items(dbp, 0) if i["level"] == "line" and "W12x26" in i["text"])
    status = {
        p["canonical"]: p["validation"]["status"] for p in line["parsed"] if p["kind"] == "profile"
    }
    assert status == {
        "W12X26": "matched_exact",
        "L3X3X1/4": "matched_by_numeric_equivalence",
        "PL1/2X8": "unvalidated",
    }


def test_without_a_catalog_edition_profiles_are_unvalidated(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    read_project(
        dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, catalog_edition="NOPE"
    )
    line = next(i for i in items(dbp, 0) if i["level"] == "line" and "W12x26" in i["text"])
    reasons = {p["validation"]["reason"] for p in line["parsed"] if p["kind"] == "profile"}
    assert reasons == {"catalog_not_loaded"}


def test_load_catalog_reports_why_none_is_in_use(dbp: DbProject, edition: str) -> None:
    matcher, note = load_catalog(dbp.conn, edition)
    assert matcher.loaded and note is None
    matcher, note = load_catalog(dbp.conn, "NO-SUCH-EDITION")
    assert not matcher.loaded and note in ("catalog_edition_not_found", "catalog_not_loaded")


def test_the_scan_stores_evidence_and_never_touches_overrides(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    first = sheets(dbp)[0]
    ev = first["scan_evidence"]
    assert ev["method"] == "pdf_text" and ev["sheet_number"]["value"] == "S4.1"
    assert ev["scales"][0]["ratio"] == 96 and float(first["text_quality"]) == 1.0
    assert sheets(dbp)[2]["scan_evidence"] is None  # the garbled page: nothing read from it
    dbp.conn.execute(
        "UPDATE sheets SET scale_override = %s, scale_override_ratio = 48, scale_source = 'manual'"
        " WHERE id = %s",
        ('1/4" = 1\'-0"', first["id"]),
    )
    dbp.conn.commit()
    dbp.scan()
    again = sheets(dbp)[0]
    assert (again["scale_override"], float(again["scale_override_ratio"])) == (
        '1/4" = 1\'-0"',
        48.0,
    )
    assert again["scale_source"] == "manual"
    assert again["scan_evidence"]["sheet_number"]["value"] == "S4.1"  # evidence refreshed


def test_a_document_without_any_text_layer_uses_the_glyph_reader_only(dbp: DbProject) -> None:
    doc = pymupdf.open()
    page = vector_text_page(doc)
    draw_text(page, "BEAM B2", 60, 80)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    totals = read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    assert totals.get("pages_pdf_text", 0) == 0 and totals["pages_glyph"] == 1
    assert [r["text_source"] for r in sheets(dbp)] == ["glyph"]
