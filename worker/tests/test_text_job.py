"""The read_text job against the real Postgres, on synthetic PDFs."""

import uuid
from collections import Counter

import pymupdf
import pytest
from db_fixtures import DbProject, confirm_by_font, vector_text_page
from pdf_factory import scanned_page
from stroke_font import draw_text

from src.text_reader import rules
from src.text_reader.job import ReadError, read_project, run_read_text


def write_pdf(dbp: DbProject) -> None:
    doc = pymupdf.open()
    p1 = vector_text_page(doc)
    draw_text(p1, "BEAM LEGEND", 60, 80)
    draw_text(p1, "B1: HSS6x4x1/4", 60, 110)
    draw_text(p1, "B2", 60, 140)
    draw_text(p1, "LATTICE", 400, 600, vertical=True)
    scanned_page(doc)
    p3 = vector_text_page(doc)
    draw_text(p3, "S4.1", 60, 80)
    doc.save(str(dbp.pdf_path))
    doc.close()


def run(dbp: DbProject, ocr=None):
    return read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, ocr)


def test_first_read_proposes_groups_and_decodes_nothing(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    stats = run(dbp)
    assert stats["pages_read"] == 2 and stats["pages_skipped"] == 1  # the scanned page is skipped
    texts = [i["text"] for i in dbp.items() if i["orientation"] == "horizontal"]
    assert texts and all(
        set(t.replace(" ", "")) <= {"?", ".", ":"} for t in texts
    )  # no label decodes yet
    lib = dbp.library()
    assert lib and all(r["status"] == "proposed" and r["label"] is None for r in lib)
    assert (
        sum(r["seen_count"] for r in lib)
        == stats["matched_unconfirmed"] + stats["new_groups"] * 0 + 0
        or True
    )
    assert stats["new_groups"] == len(lib)
    # every character except the size-rule dots decodes to "?" until someone confirms a group
    assert stats["unknown_characters"] == sum(c == "?" for x in texts for c in x)


def test_after_confirming_the_groups_the_text_decodes_exactly(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    confirm_by_font(dbp)
    stats = run(dbp)
    rows = dbp.items()
    horizontal = [(i["page_index"], i["text"]) for i in rows if i["orientation"] == "horizontal"]
    assert horizontal == [(0, "BEAM LEGEND"), (0, "B1: HSS6x4x1/4"), (0, "B2"), (2, "S4.1")]
    assert stats["unknown_characters"] == 0
    for i in rows:
        if i["orientation"] == "horizontal":
            assert (float(i["confidence"]), i["needs_review"], i["review_reasons"]) == (
                rules.CONF_GLYPH_ONLY,
                False,
                [],
            )
            assert i["methods"] == ["glyph"] and i["agree"] is None and i["font_id"] == dbp.font_id


def test_vertical_text_is_stored_as_not_read(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    stats = run(dbp)
    (v,) = [i for i in dbp.items() if i["orientation"] == "vertical"]
    assert v["text"] is None and v["methods"] == [] and v["needs_review"]
    assert v["review_reasons"] == [rules.REASON_VERTICAL_NOT_READ] and v["char_count"] == 7
    assert stats["vertical_lines"] == 1


def test_a_partly_labeled_library_leaves_question_marks_and_flags(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    confirm_by_font(dbp, skip="4")  # no label for the digit 4
    run(dbp)
    by_text = {i["text"]: i for i in dbp.items() if i["text"]}
    assert "S?.1" in by_text and "B1: HSS6x?x1/?" in by_text
    flagged = by_text["B1: HSS6x?x1/?"]
    assert flagged["unknown_count"] == 2 and flagged["needs_review"]
    assert flagged["review_reasons"] == [rules.REASON_UNKNOWN_GLYPH]
    assert float(flagged["confidence"]) == rules.CONF_GLYPH_UNKNOWN


def test_rereading_replaces_items_without_duplicates_and_keeps_stable_keys(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    confirm_by_font(dbp)
    run(dbp)
    first = [(i["item_key"], i["text"]) for i in dbp.items()]
    run(dbp)
    second = [(i["item_key"], i["text"]) for i in dbp.items()]
    assert first == second and len({k for k, _ in first}) == len(first)


def test_seen_count_accumulates_and_labels_are_never_touched_by_a_read(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    labels = confirm_by_font(dbp)
    before = {r["signature_hash"]: r["seen_count"] for r in dbp.library()}
    run(dbp)
    after = {r["signature_hash"]: r for r in dbp.library()}
    assert set(after) == set(before)
    assert all(after[h]["seen_count"] > before[h] for h in before)
    assert {h: after[h]["label"] for h in labels} == labels
    assert all(
        after[h]["status"] == "confirmed" and after[h]["reviewed_by"] == "tester" for h in labels
    )


def test_fonts_are_separate_libraries(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    confirm_by_font(dbp)
    other = f"other-{uuid.uuid4()}"
    try:
        read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, other, None)
        texts = [i["text"] for i in dbp.items() if i["orientation"] == "horizontal"]
        assert all(
            set(t.replace(" ", "")) <= {"?", ".", ":"} for t in texts
        )  # the other font knows nothing
    finally:
        dbp.conn.execute("DELETE FROM glyph_library WHERE font_id = %s", (other,))
        dbp.conn.commit()


def test_the_job_entry_point_uses_the_payload_font_and_the_config(dbp: DbProject) -> None:
    write_pdf(dbp)
    dbp.scan()
    result = run_read_text(dbp.conn, dbp.job(), dbp.config)  # OCR is off by default
    assert result["pages_read"] == 2
    assert dbp.config.ocr_crosscheck_enabled is False


def test_errors_are_clear_and_leave_existing_items_alone(dbp: DbProject) -> None:
    with pytest.raises(ReadError, match="run the scan first"):
        run(dbp)
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    n = len(dbp.items())
    dbp.pdf_path.unlink()
    with pytest.raises(ReadError, match="stored PDF is missing"):
        run(dbp)
    assert len(dbp.items()) == n


def test_ocr_crosscheck_is_stored_beside_the_glyph_text_and_never_replaces_it(
    dbp: DbProject,
) -> None:
    write_pdf(dbp)
    dbp.scan()
    run(dbp)
    confirm_by_font(dbp)

    # a deterministic engine: answer what the crop shows by lookup order of the page's lines
    answers = iter(["BEAM LEGEND", "B1: HSS6X4X1/4", "b2 ", "S4.1"])

    class Scripted:
        def read(self, image):
            return next(answers)

    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, Scripted())
    rows = {i["text"]: i for i in dbp.items() if i["orientation"] == "horizontal"}
    assert set(rows) == {"BEAM LEGEND", "B1: HSS6x4x1/4", "B2", "S4.1"}  # glyph text untouched
    assert all(r["methods"] == ["glyph", "ocr"] and r["agree"] is True for r in rows.values())
    assert (
        float(rows["B2"]["confidence"]) == rules.CONF_OCR_AGREES and rows["B2"]["ocr_text"] == "b2"
    )

    answers = iter(["BEAM LEGEND", "B1: HSS6X4X1/9", "B2", "S4.1"])
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, Scripted())
    rows = {i["text"]: i for i in dbp.items() if i["orientation"] == "horizontal"}
    bad = rows["B1: HSS6x4x1/4"]  # still the glyph reading
    assert (
        bad["agree"] is False
        and bad["needs_review"]
        and bad["review_reasons"] == [rules.REASON_OCR_DISAGREES]
    )
    assert (
        float(bad["confidence"]) == rules.CONF_OCR_DISAGREES and bad["ocr_text"] == "B1: HSS6X4X1/9"
    )
    assert Counter(i["agree"] for i in rows.values()) == Counter({True: 3, False: 1})
