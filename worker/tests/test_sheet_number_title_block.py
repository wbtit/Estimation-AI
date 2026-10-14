"""Sheet number: the title-block reading is preferred; the earlier one is the flagged fallback."""

from __future__ import annotations

import pymupdf
from db_fixtures import DbProject
from pdf_factory import LANDSCAPE, add_lines, new_doc

from src.pdf_scan.reread import reread_sheet_numbers
from src.pdf_scan.sheet_id import SHEET_NUMBER_RE, TITLE_BLOCK_NUMBER_RE
from src.pdf_scan.textlines import page_words_and_lines
from src.pdf_scan.textscan import scan_text


def block_page(doc, number: str, other: str | None = None, labelled: bool = True):
    """A title block whose number cell is right-aligned: far to the right of its label, as on a
    drawing where the label sits at the left edge of a wide cell. `other` is a taller token in the
    same corner (a detail reference), which the earlier reading picked."""
    page = doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])
    add_lines(page)
    w, h = page.rect.width, page.rect.height
    x = w - 260
    if labelled:
        page.insert_text((x, h - 92), "DRAWING NUMBER", fontsize=7)
    page.insert_text((x + 105, h - 70), number, fontsize=16)
    if other:
        page.insert_text((x - 20, h - 150), other, fontsize=20)
    page.insert_text((x, h - 40), "DATE", fontsize=7)
    page.insert_text((x + 100, h - 25), "OCT-24", fontsize=6)
    return page


def read(page):
    words, lines = page_words_and_lines(page)
    return scan_text(words, lines, page.rect.width, page.rect.height)


def test_the_pattern_accepts_the_hyphenated_form_the_earlier_one_could_not():
    for ok in ("S4-01", "S1.01", "A-101", "S101A", "S4-01A"):
        assert TITLE_BLOCK_NUMBER_RE.match(ok), ok
    assert not SHEET_NUMBER_RE.match("S4-01")
    for bad in ("TYP", "12-0", "S", "SECTION4"):
        assert not TITLE_BLOCK_NUMBER_RE.match(bad), bad


def test_the_title_block_number_is_shown_and_the_earlier_one_is_kept_with_a_flag():
    doc = new_doc()
    page = block_page(doc, "S4-01", other="S4")
    found = read(page)
    assert found.sheet_number == "S4-01"
    assert found.sheet_number_flag == "title_block"
    assert found.sheet_number_old == "S4"  # what the earlier reading would have shown
    assert found.evidence["sheet_number"]["reading"] == "title_block"
    assert found.evidence["sheet_number"]["earlier_value"] == "S4"


def test_both_readings_agree_when_the_number_is_unambiguous():
    doc = new_doc()
    page = block_page(doc, "S101")
    found = read(page)
    assert (found.sheet_number, found.sheet_number_flag, found.sheet_number_old) == (
        "S101",
        "title_block",
        None,
    )


def test_the_earlier_reading_is_the_fallback_when_the_title_block_one_is_ambiguous():
    # two equally sized candidates, one of them in the new form only: the new reading cannot choose,
    # the earlier one sees a single candidate and is shown with the fallback flag
    doc = new_doc()
    page = doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])
    add_lines(page)
    page.insert_text((960, 700), "S101", fontsize=16)
    page.insert_text((1060, 700), "S4-01", fontsize=16)
    for i, small in enumerate(("DATE", "DRAWN", "CHECKED", "SCALE")):
        page.insert_text((960, 730 + i * 9), small, fontsize=6)
    found = read(page)
    assert found.sheet_number == "S101"
    assert found.sheet_number_flag == "fallback_old"
    assert found.sheet_number_old is None


def test_no_number_at_all_has_no_flag():
    doc = new_doc()
    page = doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])
    add_lines(page)
    found = read(page)
    assert found.sheet_number is None and found.sheet_number_flag is None


def test_the_scan_stores_the_number_old_value_and_flag(dbp: DbProject):
    doc = new_doc()
    block_page(doc, "S4-01", other="S4")
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    row = dbp.conn.execute(
        "SELECT sheet_number, sheet_number_old, sheet_number_flag FROM sheets"
        " WHERE project_id = %s",
        (dbp.project_id,),
    ).fetchone()
    assert row == {
        "sheet_number": "S4-01",
        "sheet_number_old": "S4",
        "sheet_number_flag": "title_block",
    }


def test_the_reread_previews_without_writing_and_then_applies(dbp: DbProject):
    doc = new_doc()
    block_page(doc, "S4-01", other="S4")
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    # a project scanned before Phase 9: the earlier value is stored, no flag
    dbp.conn.execute(
        "UPDATE sheets SET sheet_number = 'S4', sheet_number_old = NULL, sheet_number_flag = NULL"
        " WHERE project_id = %s",
        (dbp.project_id,),
    )
    dbp.conn.commit()
    preview = reread_sheet_numbers(dbp.conn, dbp.config, dbp.project_id)
    assert preview["applied"] is False and preview["number_changed"] == 1
    assert dbp.conn.execute(
        "SELECT sheet_number FROM sheets WHERE project_id = %s", (dbp.project_id,)
    ).fetchone() == {"sheet_number": "S4"}  # nothing written
    done = reread_sheet_numbers(dbp.conn, dbp.config, dbp.project_id, apply=True)
    assert done["applied"] is True and done["title_block"] == 1
    assert dbp.conn.execute(
        "SELECT sheet_number, sheet_number_old, sheet_number_flag FROM sheets"
        " WHERE project_id = %s",
        (dbp.project_id,),
    ).fetchone() == {
        "sheet_number": "S4-01",
        "sheet_number_old": "S4",
        "sheet_number_flag": "title_block",
    }
    again = reread_sheet_numbers(dbp.conn, dbp.config, dbp.project_id)
    assert again["unchanged"] == 1 and again["number_changed"] == 0


def test_pymupdf_is_imported_for_the_factory():
    assert pymupdf.__name__ == "pymupdf"


def test_fill_ins_only_never_overwrite_a_stored_number(dbp: DbProject):
    doc = new_doc()
    block_page(doc, "S4-01", other="S4")
    block_page(doc, "S4-02", other="S4")
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    # page 0 had the earlier reading stored, page 1 had no number at all
    dbp.conn.execute(
        "UPDATE sheets SET sheet_number = CASE page_index WHEN 0 THEN 'S4' ELSE NULL END,"
        " sheet_number_old = NULL, sheet_number_flag = NULL WHERE project_id = %s",
        (dbp.project_id,),
    )
    dbp.conn.commit()
    done = reread_sheet_numbers(dbp.conn, dbp.config, dbp.project_id, apply=True, only_missing=True)
    assert done["written"] == 1
    assert {c["kind"] for c in done["changes"]} == {"number_changed", "number_read_where_none"}
    rows = dbp.conn.execute(
        "SELECT page_index, sheet_number, sheet_number_flag FROM sheets WHERE project_id = %s"
        " ORDER BY page_index",
        (dbp.project_id,),
    ).fetchall()
    assert rows[0] == {"page_index": 0, "sheet_number": "S4", "sheet_number_flag": None}
    assert rows[1] == {"page_index": 1, "sheet_number": "S4-02", "sheet_number_flag": "title_block"}
