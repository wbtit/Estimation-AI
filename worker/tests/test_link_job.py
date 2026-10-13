"""link_view job against the real Postgres test database; PDFs are synthetic."""

import pymupdf
import pytest
from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.review.classes_job import classes_view
from src.review.link_job import LinkError, link_view
from src.text_reader.job import read_project

BOX = {"x0": 40, "y0": 80, "x1": 1060, "y1": 640}


def build_pdf(dbp: DbProject) -> None:
    doc = new_doc()
    page = vector_page(
        doc,
        "S4.1",
        "SECOND FLOOR FRAMING PLAN",
        texts=[
            ((60, 700), "B1: HSS6x4x1/4", 10),
            ((60, 716), "B2: W12x26", 10),
            ((60, 732), "B2: W14x30", 10),
        ],
    )
    # heavy beams (width 2): six labelled ones 100 pt apart and three far away (9 lines in all)
    for k in range(6):
        y = 120 + 100 * k
        page.draw_line((100, y), (700, y), width=2.0)
        page.insert_text((300, y - 6), "W12x26", fontsize=8)
    for y in (100, 300, 500):
        page.draw_line((820, y), (1020, y), width=2.0)
    page.insert_text((300, 273), "W16x31", fontsize=8)  # halfway between two beams: a tie
    page.insert_text((1100, 600), "W10x12", fontsize=8)  # outside the view box
    page.insert_text((600, 114), "B1", fontsize=8)  # a mark with a legend row, just above a beam
    page.insert_text((650, 214), "B2", fontsize=8)  # a mark with two different legend rows
    dbp.pdf_path.write_bytes(doc.tobytes())


def make_view(
    dbp: DbProject,
    confirmed: bool = True,
    box: dict | None = None,
    classes: list[str] | None = None,
    decided: str | None = "include",
) -> str:
    """A view as a person leaves it: scale confirmed and, by default, the beam class confirmed."""
    sheet_id = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s AND page_index = 0", (dbp.project_id,)
    ).fetchone()["id"]
    import json

    row = dbp.conn.execute(
        "INSERT INTO sheet_views (sheet_id, box, scale_ratio, scale_source, scale_text,"
        " scale_confirmed, structural_classes, classes_confirmed)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (
            sheet_id,
            json.dumps(box or BOX),
            96 if confirmed else None,
            "user_confirmed" if confirmed else None,
            '1/8" = 1\'-0"' if confirmed else None,
            confirmed,
            classes if classes is not None else ["1.5-2.5|black|solid"],
            classes != [],
        ),
    ).fetchone()
    if decided:
        dbp.conn.execute(
            "INSERT INTO sheet_edits"
            " (sheet_id, field_name, original_value, corrected_value, editor)"
            " VALUES (%s, 'takeoff', 'null', %s, 'tester')",
            (sheet_id, json.dumps(decided)),
        )
    dbp.conn.commit()
    return str(row["id"])


def members(dbp: DbProject) -> list[dict]:
    return list(
        dbp.conn.execute(
            "SELECT * FROM members WHERE project_id = %s"
            " ORDER BY source_bbox->>'y0', source_bbox->>'x0'",
            (dbp.project_id,),
        ).fetchall()
    )


@pytest.fixture
def prepared(dbp: DbProject) -> DbProject:
    build_pdf(dbp)
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    return dbp


def test_members_are_proposed_for_labels_inside_the_view(prepared: DbProject) -> None:
    view = make_view(prepared)
    result = link_view(prepared.conn, prepared.config, view)
    got = members(prepared)
    profile = [m for m in got if m["mark"] is None]
    marks = [m for m in got if m["mark"] is not None]
    # 6 beam labels and the tie label; the label outside the box is not a member
    assert len(profile) == 7 and result["created"] == len(got) == 9
    assert result["confidence_high"] + result["confidence_medium"] + result["confidence_low"] == 9
    by_text = {}
    for m in profile:
        by_text.setdefault(m["profile_raw"], []).append(m)
    assert len(by_text["W12x26"]) == 6
    assert {m["link_confidence"] for m in by_text["W12x26"]} == {"high"}
    assert by_text["W16x31"][0]["link_confidence"] == "low"  # equidistant between two beams
    assert all(
        m["origin"] == "extracted" and m["type"] == "beam" and m["quantity"] == 1 for m in got
    )
    assert all(str(m["view_id"]) == view and m["label_key"] for m in got)
    assert {m["link_rule"] for m in got} == {"phase4e-v1-frozen"}
    # marks: one linked to its single legend row, one ambiguous (two different designations)
    status = {m["mark"]: m for m in marks}
    assert status["B1"]["mark_ref_status"] == "linked" and status["B1"]["profile"] == "HSS6X4X1/4"
    assert status["B1"]["profile_raw"] == "HSS6x4x1/4" and status["B1"]["legend_row_id"] is not None
    assert status["B2"]["mark_ref_status"] == "ambiguous" and status["B2"]["profile"] is None


def test_the_proposed_line_gives_plan_geometry_in_the_view_frame(prepared: DbProject) -> None:
    view = make_view(prepared)
    link_view(prepared.conn, prepared.config, view)
    m = next(x for x in members(prepared) if x["profile_raw"] == "W12x26")
    best = m["link_candidates"][0]
    assert best["rank"] == 1 and len(m["link_candidates"]) <= 3
    assert abs(best["p"][1] - best["q"][1]) < 0.01  # a horizontal beam
    length_pt = abs(best["q"][0] - best["p"][0])
    assert length_pt == pytest.approx(600, abs=0.5)
    # plan frame: origin lower-left of the box, y up, mm = pt x 25.4/72 x ratio
    k = 25.4 / 72 * 96
    assert float(m["plan_end_x_mm"]) - float(m["plan_start_x_mm"]) == pytest.approx(
        600 * k * (1 if best["q"][0] > best["p"][0] else -1), abs=1.0
    )
    assert float(m["plan_start_y_mm"]) == pytest.approx((BOX["y1"] - best["p"][1]) * k, abs=0.5)
    assert float(m["plan_scale_ratio"]) == 96 and m["plan_method"] == "pdf_geometry"
    assert m["length_source"] == "plan_geometry" and str(m["plan_sheet_id"]) == str(m["sheet_id"])
    assert set(m["plan_bbox"]) == {"x0", "y0", "x1", "y1"}


def test_the_link_job_follows_the_decision_of_the_sheet_or_the_page_type_default(
    prepared: DbProject,
) -> None:
    view = make_view(prepared, decided="exclude")  # a person said exclude: refused
    with pytest.raises(LinkError, match="not in the takeoff"):
        link_view(prepared.conn, prepared.config, view)
    prepared.conn.execute("DELETE FROM sheet_views WHERE id = %s", (view,))
    prepared.conn.commit()
    assert members(prepared) == []
    result = link_view(prepared.conn, prepared.config, make_view(prepared))
    assert result["created"] > 0


def test_the_classes_are_suggested_by_their_own_job_and_the_suggestion_is_used(
    prepared: DbProject,
) -> None:
    view = make_view(prepared, classes=[])  # no classes chosen yet
    with pytest.raises(LinkError, match="no line class"):
        link_view(prepared.conn, prepared.config, view)
    assert members(prepared) == []
    result = classes_view(prepared.conn, prepared.config, view)
    row = prepared.conn.execute("SELECT * FROM sheet_views WHERE id = %s", (view,)).fetchone()
    assert result["suggested"] == 1 and not row["classes_confirmed"]
    assert row["structural_classes"] == ["1.5-2.5|black|solid"]  # suggested, not confirmed
    keys = {c["key"] for c in row["class_table"]}
    assert "1.5-2.5|black|solid" in keys and any(k.startswith("1-1.5|black") for k in keys)
    # a suggestion is not a confirmation, but it is used (a flag, not a gate)
    assert link_view(prepared.conn, prepared.config, view)["created"] > 0
    row = prepared.conn.execute("SELECT * FROM sheet_views WHERE id = %s", (view,)).fetchone()
    assert not row["classes_confirmed"]


def test_a_confirmed_choice_is_used_and_never_replaced_by_the_suggestion(
    prepared: DbProject,
) -> None:
    view = make_view(prepared, classes=["1-1.5|black|solid"])  # the thin lines, chosen by a person
    classes_view(prepared.conn, prepared.config, view)  # must not touch the confirmed choice
    assert prepared.conn.execute(
        "SELECT structural_classes FROM sheet_views WHERE id = %s", (view,)
    ).fetchone()["structural_classes"] == ["1-1.5|black|solid"]
    result = link_view(prepared.conn, prepared.config, view)
    assert result["structural_lines"] >= 70  # the thin lines inside the box
    assert prepared.conn.execute(
        "SELECT structural_classes FROM sheet_views WHERE id = %s", (view,)
    ).fetchone()["structural_classes"] == ["1-1.5|black|solid"]


def test_a_rerun_updates_untouched_members_and_never_touches_reviewed_ones(
    prepared: DbProject,
) -> None:
    view = make_view(prepared)
    first = link_view(prepared.conn, prepared.config, view)
    got = members(prepared)
    approved, edited = got[0], got[1]
    prepared.conn.execute(
        "UPDATE members SET review_status = 'approved' WHERE id = %s", (approved["id"],)
    )
    prepared.conn.execute(
        "INSERT INTO member_edits (member_id, field_name, original_value, corrected_value,"
        " review_status,"
        " reviewer) VALUES (%s, 'profile_raw', '\"a\"', '\"b\"', 'edited', 'tester')",
        (edited["id"],),
    )
    prepared.conn.commit()
    second = link_view(prepared.conn, prepared.config, view)
    assert len(members(prepared)) == first["created"]  # no duplicates
    assert second["created"] == 0 and second["kept_reviewed"] == 2
    assert second["updated"] == first["created"] - 2


def test_members_outside_a_smaller_box_are_removed_unless_a_person_touched_them(
    prepared: DbProject,
) -> None:
    view = make_view(prepared)
    link_view(prepared.conn, prepared.config, view)
    touched = members(prepared)[-1]
    prepared.conn.execute(
        "UPDATE members SET review_status = 'edited' WHERE id = %s", (touched["id"],)
    )
    prepared.conn.execute(
        "UPDATE sheet_views SET box = %s WHERE id = %s",
        ('{"x0": 40, "y0": 80, "x1": 1060, "y1": 330}', view),
    )
    prepared.conn.commit()
    result = link_view(prepared.conn, prepared.config, view)
    assert result["removed"] == 2  # the labels of the two lower beams; the touched one stays
    ids = {str(m["id"]) for m in members(prepared)}
    assert str(touched["id"]) in ids  # kept although outside the new box


def test_a_view_without_a_scale_still_finds_members_but_has_no_plan_frame(
    prepared: DbProject,
) -> None:
    """The scale is a flag, not a gate (Phase 6a): members come with no plan coordinates."""
    view = make_view(prepared, confirmed=False)
    result = link_view(prepared.conn, prepared.config, view)
    got = members(prepared)
    assert result["created"] == len(got) == 9
    assert all(
        m["plan_start_x_mm"] is None
        and m["plan_scale_ratio"] is None
        and m["length_source"] is None
        for m in got
    )
    assert any(m["plan_bbox"] is not None for m in got)  # the proposed line is still known
    with pytest.raises(LinkError, match="not found"):
        link_view(prepared.conn, prepared.config, "00000000-0000-4000-8000-000000000000")


def test_a_sheet_out_of_the_takeoff_or_a_view_without_classes_is_refused(
    prepared: DbProject,
) -> None:
    view = make_view(prepared, decided="exclude")
    with pytest.raises(LinkError, match="not in the takeoff"):
        link_view(prepared.conn, prepared.config, view)
    assert members(prepared) == []
    view = make_view(prepared, decided="include", classes=[])
    with pytest.raises(LinkError, match="no line class"):
        link_view(prepared.conn, prepared.config, view)
    assert members(prepared) == []


def test_a_framing_plan_is_in_the_takeoff_by_default(prepared: DbProject) -> None:
    view = make_view(prepared, decided=None)  # nobody decided; the page type guess is framing plan
    assert link_view(prepared.conn, prepared.config, view)["created"] == 9


def test_a_rotated_page_gives_the_same_proposals(dbp: DbProject) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=1200, height=800)
    page.set_rotation(90)  # displayed 800 x 1200
    inv = ~page.rotation_matrix
    for y in (100, 200, 300, 400, 500, 600, 700, 800, 900):
        page.draw_line(pymupdf.Point(100, y) * inv, pymupdf.Point(600, y) * inv, width=2.0)
    # text drawn upright on the displayed page above the first beam
    page.insert_text(pymupdf.Point(300, 94) * inv, "W12x26", fontsize=8,
                     morph=(pymupdf.Point(300, 94) * inv, pymupdf.Matrix(90)))  # fmt: skip
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    view = make_view(dbp, box={"x0": 20, "y0": 20, "x1": 780, "y1": 1000})
    link_view(dbp.conn, dbp.config, view)
    (m,) = members(dbp)
    best = m["link_candidates"][0]
    assert (
        abs(best["p"][1] - 100) < 1 and abs(best["q"][1] - 100) < 1
    )  # the nearest beam, displayed y = 100
    assert m["link_confidence"] == "high"


def test_a_label_with_no_line_in_reach_has_no_proposal_and_low_confidence(dbp: DbProject) -> None:
    doc = new_doc()
    page = vector_page(doc, "S4.1", "FRAMING PLAN")
    for k in range(9):  # nine heavy lines in the top left, so the class qualifies
        page.draw_line((100, 100 + 10 * k), (300, 100 + 10 * k), width=2.0)
    page.insert_text((900, 600), "W8x10", fontsize=8)  # more than 150 pt from every heavy line
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    link_view(dbp.conn, dbp.config, make_view(dbp))
    (m,) = members(dbp)
    assert (
        m["link_confidence"],
        m["link_candidates"],
        m["plan_start_x_mm"],
        m["length_source"],
    ) == (
        "low",
        [],
        None,
        None,
    )
    assert m["profile_raw"] == "W8x10" and m["plan_method"] is None


def test_a_joist_designation_becomes_a_joist_member_without_a_profile(dbp: DbProject) -> None:
    doc = new_doc()
    page = vector_page(doc, "S4.1", "SECOND FLOOR FRAMING PLAN", texts=[])
    page.draw_line((100, 200), (700, 200), width=2.0)
    page.insert_text((300, 194), "24K7", fontsize=8)  # a joist label just above a line
    page.draw_line((100, 400), (700, 400), width=2.0)
    page.insert_text((300, 394), "W12x26", fontsize=8)
    page.insert_text((300, 500), "W12X26 K1", fontsize=8)  # K1 belongs to the profile text
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    link_view(dbp.conn, dbp.config, make_view(dbp))
    got = {m["profile_raw"]: m for m in members(dbp)}
    j = got["24K7"]
    assert j["type"] == "joist" and j["profile"] is None and j["origin"] == "extracted"
    assert got["W12x26"]["type"] == "beam" and got["W12x26"]["profile"] == "W12X26"
    assert not any(k.startswith("K1") or k == "K1" for k in got)
    assert len([m for m in members(dbp) if m["type"] == "joist"]) == 1
