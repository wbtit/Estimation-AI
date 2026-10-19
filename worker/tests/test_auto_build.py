"""Auto mode (Phase 11b): proposals, the unconfirmed build path, the frozen SYSTEM VERSION, the one
tag counter per project. SYNTHETIC pages only (tests/build_factory.py)."""

from __future__ import annotations

import psycopg
import pymupdf
import pytest
from build_factory import XS, YS, column, framing_plan, grids, line
from db_fixtures import DbProject

from src.build.auto import auto_build, person_actions
from src.build.job import build_sheet, setup_reasons, take_tag_numbers
from src.build.propose import (
    choose_column_plan,
    propose_crop,
    propose_role,
    propose_scale,
    propose_tos,
)
from src.build.segments import TextLine, page_text_lines
from src.build.views import load_views, pick_view, view_as_sheet

BOX = (100.0, 100.0, 900.0, 700.0)


def _t(text: str, x: float = 400.0, y: float = 300.0) -> TextLine:
    return TextLine(text, (x, y, x + 60, y + 8))


# ---- proposals (pure) ---------------------------------------------------------------------------
def test_role_comes_from_the_page_type_guess() -> None:
    assert propose_role("foundation_plan") == "column_plan"
    assert propose_role("framing_plan") == "framing"
    assert propose_role("detail") is None and propose_role(None) is None


def test_scale_prefers_the_override_then_the_parsed_ratio() -> None:
    sheet = {"scale_override_ratio": 48, "scale_override": "a", "scale_parsed_ratio": 96}
    assert propose_scale(sheet) == (48.0, "a")
    assert propose_scale({"scale_parsed_ratio": 96, "scale_parsed": "b"}) == (96.0, "b")
    assert propose_scale({}) == (None, None)


def test_tos_one_note_inside_the_crop_is_proposed() -> None:
    p = propose_tos([_t("T.O.S. 12'-6\"")], BOX)
    assert p.rule == "single_note" and p.mm == pytest.approx(3810.0) and p.notes == 1
    assert p.raw is not None


def test_tos_most_frequent_value_wins_and_a_tie_gives_none() -> None:
    notes = [_t("T.O.S. 12'-6\""), _t("T.O.S. 12'-6\"", y=320), _t("T.O.S. 14'-0\"", y=340)]
    p = propose_tos(notes, BOX)
    assert p.rule == "most_frequent" and p.mm == pytest.approx(3810.0) and p.notes == 3
    tie = propose_tos([_t("T.O.S. 12'-6\""), _t("T.O.S. 14'-0\"", y=340)], BOX)
    assert tie.rule == "tie" and tie.mm is None


def test_tos_ignores_offsets_other_references_and_notes_outside_the_crop() -> None:
    notes = [
        _t("T.O.S. +2'-0\""),  # a signed offset
        _t("T.O.C. 10'-0\""),  # top of concrete
        _t("T.O.S. 12'-6\"", x=950, y=750),  # outside the crop
        _t("W16X26"),
    ]
    p = propose_tos(notes, BOX)
    assert p.rule == "none" and p.mm is None and p.notes == 0


def test_column_plan_choice() -> None:
    a = {("N", "1"), ("N", "2"), ("A", "A")}
    assert choose_column_plan(a, {}) == (None, "no_column_plan_built")
    assert choose_column_plan(a, {"p1": set()}) == ("p1", "only_column_plan")
    plans = {"p1": {("N", "1")}, "p2": {("N", "1"), ("N", "2")}}
    assert choose_column_plan(a, plans) == ("p2", "most_grid_labels_shared")
    tie = {"p1": {("N", "1")}, "p2": {("N", "2")}}
    assert choose_column_plan(a, tie) == (None, "no_clear_column_plan")
    assert choose_column_plan(a, {"p1": {("N", "9")}, "p2": set()})[0] is None


def test_crop_is_the_bubble_box_plus_margin_else_the_whole_sheet() -> None:
    doc = pymupdf.open()
    page = framing_plan(doc)
    cp = propose_crop(page, page_text_lines(page))
    assert cp.rule == "grid_bubbles" and len(cp.grid) == 6
    assert cp.box[0] < min(XS.values()) and cp.box[3] > max(YS.values())
    empty = doc.new_page(width=1000, height=800)
    cp = propose_crop(empty, [])
    assert cp.rule == "fallback_whole_sheet"
    assert cp.box == pytest.approx((25.0, 20.0, 860.0, 780.0))


def test_setup_reasons_with_system_values_need_values_not_confirmations() -> None:
    sheet = {"build_role": "framing", "crop_region": {"x0": 0}, "build_scale_ratio": 96}
    assert setup_reasons(sheet, allow_system=True) == ["no beam pen class"]
    assert setup_reasons({**sheet, "pen_class": "k"}, allow_system=True) == []
    assert "crop not confirmed" in setup_reasons({**sheet, "pen_class": "k"})
    assert setup_reasons({"build_role": "column_plan"}, allow_system=True) == [
        "no crop",
        "no scale",
    ]
    # "No beams": a person set the pen to none
    none = {**sheet, "pen_class_source": "person", "pen_class_confirmed_by": "tester"}
    assert setup_reasons(none, allow_system=True) == []
    assert "beam pen class not confirmed" not in setup_reasons(none)


# ---- auto mode on the database -------------------------------------------------------------------
def _project(dbp: DbProject, tos_note: bool = True) -> tuple[str, str, str]:
    doc = pymupdf.open()
    plan = doc.new_page(width=1000, height=800)
    grids(plan)
    for x in XS.values():
        for y in YS.values():
            column(plan, (x, y))
    framing = framing_plan(doc, with_columns=False)
    # two more beams in bay A-B, 2-3: the suggester needs 8 heavy solid lines inside the crop
    line(framing, (250, 400), (250, 600))
    line(framing, (450, 400), (450, 600))
    if tos_note:
        framing.insert_text((540, 470), "T.O.S. 12'-6\"", fontsize=8)
    doc.new_page(width=1000, height=800).insert_text((100, 100), "GENERAL NOTES", fontsize=12)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    ids = [
        str(r["id"])
        for r in dbp.conn.execute(
            "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        )
    ]
    for sid, guess in zip(ids, ("foundation_plan", "framing_plan", "general_notes"), strict=True):
        dbp.conn.execute(
            "UPDATE sheets SET page_type_guess = %s, scale_parsed_ratio = 96,"
            " scale_parsed = '1/8\" = 1''-0\"', scale_override_ratio = NULL WHERE id = %s",
            (guess, sid),
        )
    dbp.conn.commit()
    return ids[0], ids[1], ids[2]


def _sheet(dbp: DbProject, sid: str) -> dict:
    """The page as the setup rules read it: its first view's values (Phase 11c)."""
    page = dbp.conn.execute("SELECT * FROM sheets WHERE id = %s", (sid,)).fetchone()
    return view_as_sheet(page, pick_view(load_views(dbp.conn, sid)))


def test_auto_mode_proposes_builds_with_system_values_and_freezes_the_system_version(
    dbp: DbProject,
) -> None:
    plan_id, framing_id, notes_id = _project(dbp)
    out = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert out["pages"] == 3 and out["built"] == 2 and out["skipped"] == 1
    plan, framing, notes = (_sheet(dbp, s) for s in (plan_id, framing_id, notes_id))
    assert plan["build_role"] == "column_plan" and framing["build_role"] == "framing"
    assert notes["build_role"] is None
    for s in (plan, framing):  # system values: nothing confirmed by a person
        assert s["crop_region"] is not None and float(s["build_scale_ratio"]) == 96
        assert s["crop_confirmed_by"] is None and s["scale_confirmed_by"] is None
        assert s["role_confirmed_by"] is None and s["build_status"] == "built"
    assert framing["pen_class"] and framing["pen_class_source"] == "suggested"
    assert framing["pen_class_confirmed_by"] is None
    # Phase 12a: a column plan page gets beam pen = none (system), so it builds no beams
    assert plan["pen_class"] is None and plan["pen_class_confirmed_by"] is None
    assert float(framing["tos_mm"]) == pytest.approx(3810.0) and framing["tos_source"] == "read"
    assert framing["tos_confirmed_by"] is None
    assert str(framing["column_plan_sheet_id"]) == plan_id

    runs = dbp.conn.execute(
        "SELECT * FROM build_runs WHERE project_id = %s ORDER BY started_at", (dbp.project_id,)
    ).fetchall()
    assert [r["mode"] for r in runs] == ["auto", "auto"]
    assert [str(r["sheet_id"]) for r in runs] == [plan_id, framing_id]  # column plan first
    assert all(r["requested_by"] == "system" and r["status"] == "done" for r in runs)

    snaps = {
        str(r["sheet_id"]): r
        for r in dbp.conn.execute(
            "SELECT * FROM build_snapshots WHERE project_id = %s", (dbp.project_id,)
        )
    }
    assert set(snaps) == {plan_id, framing_id, notes_id}
    built = dbp.conn.execute(
        "SELECT count(*) AS n FROM members WHERE sheet_id = %s AND build_run_id IS NOT NULL",
        (framing_id,),
    ).fetchone()["n"]
    assert len(snaps[framing_id]["pieces"]) == built > 0
    assert len(snaps[plan_id]["pieces"]) == 9 and snaps[notes_id]["pieces"] == []
    assert {p["kind"] for p in snaps[plan_id]["pieces"]} == {"Column"}
    assert snaps[plan_id]["setup"]["evidence"]["pen_rule"] == "column_plan_no_beams"
    assert snaps[plan_id]["setup"]["pen_class"]["value"] is None
    setup = snaps[framing_id]["setup"]
    assert setup["crop"]["source"] == "system" and setup["pen_class"]["source"] == "system"
    assert setup["tos"]["value_mm"] == pytest.approx(3810.0)
    assert setup["evidence"]["crop_rule"] == "grid_bubbles"
    assert setup["evidence"]["column_plan_rule"] == "only_column_plan"
    piece = next(p for p in snaps[framing_id]["pieces"] if p["profile"] == "W16X26")
    assert piece["tag"] and piece["length_mm"] > 0 and piece["page"] is not None

    lines = dbp.conn.execute(
        "SELECT count(*) AS n FROM sheet_lines WHERE sheet_id IN (%s, %s)", (plan_id, framing_id)
    ).fetchone()["n"]
    assert lines == 2
    auto = dbp.conn.execute(
        "SELECT * FROM auto_builds WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()
    assert auto["status"] == "done" and auto["pages_done"] == auto["pages_total"] == 3


def test_the_system_version_never_changes(dbp: DbProject) -> None:
    _project(dbp)
    auto_build(dbp.conn, dbp.config, dbp.project_id)
    with pytest.raises(psycopg.errors.RaiseException):
        dbp.conn.execute("UPDATE build_snapshots SET counts = '{}' WHERE project_id = %s",
                         (dbp.project_id,))  # fmt: skip
    dbp.conn.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        dbp.conn.execute("DELETE FROM build_snapshots WHERE project_id = %s", (dbp.project_id,))
    dbp.conn.rollback()


def test_auto_mode_runs_once_and_never_after_a_person_acted(dbp: DbProject) -> None:
    plan_id, _, _ = _project(dbp)
    dbp.conn.execute("UPDATE sheets SET crop_confirmed_by = 'tester' WHERE id = %s", (plan_id,))
    dbp.conn.commit()
    assert person_actions(dbp.conn, dbp.project_id) == ["a confirmed or reviewed page"]
    out = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert out["refused"][0].startswith("a person already worked on it")
    assert _sheet(dbp, plan_id)["build_role"] is None  # nothing proposed

    dbp.conn.execute("UPDATE sheets SET crop_confirmed_by = NULL WHERE id = %s", (plan_id,))
    # a label-first page edit is not build setup: auto mode still runs
    dbp.conn.execute(
        "INSERT INTO sheet_edits (sheet_id, field_name, corrected_value, editor)"
        " VALUES (%s, 'page_type', '\"framing_plan\"', 'tester')",
        (plan_id,),
    )
    dbp.conn.commit()
    assert person_actions(dbp.conn, dbp.project_id) == []
    assert auto_build(dbp.conn, dbp.config, dbp.project_id)["built"] == 2
    again = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert again == {"refused": ["auto mode already ran on this project"]}


def test_a_page_without_scale_or_pen_class_gets_a_reason_and_no_build(dbp: DbProject) -> None:
    plan_id, framing_id, _ = _project(dbp, tos_note=False)
    dbp.conn.execute(
        "UPDATE sheets SET scale_parsed_ratio = NULL, scale_parsed = NULL WHERE id = %s",
        (plan_id,),
    )
    dbp.conn.commit()
    out = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert out["built"] == 1 and out["not_built"] == 1
    run = dbp.conn.execute("SELECT * FROM build_runs WHERE sheet_id = %s", (plan_id,)).fetchone()
    assert run["status"] == "refused" and run["error"] == "no scale"
    framing = _sheet(dbp, framing_id)
    assert framing["tos_mm"] is None and framing["column_plan_sheet_id"] is None
    snap = dbp.conn.execute(
        "SELECT setup FROM build_snapshots WHERE sheet_id = %s", (framing_id,)
    ).fetchone()["setup"]
    assert snap["evidence"]["column_plan_rule"] == "no_column_plan_built"
    assert snap["evidence"]["tos_rule"] == "none" and snap["built"] is True
    beam = dbp.conn.execute(
        "SELECT * FROM members WHERE sheet_id = %s AND build_run_id IS NOT NULL LIMIT 1",
        (framing_id,),
    ).fetchone()
    assert beam["start_elevation_mm"] is None and beam["start_x_mm"] is not None


def test_no_beams_rebuild_removes_untouched_beams_and_keeps_edited_ones(dbp: DbProject) -> None:
    _, framing_id, _ = _project(dbp)
    auto_build(dbp.conn, dbp.config, dbp.project_id)
    beams = dbp.conn.execute(
        "SELECT id FROM members WHERE sheet_id = %s AND kind = 'Beams' ORDER BY member_id",
        (framing_id,),
    ).fetchall()
    assert len(beams) >= 2
    kept = str(beams[0]["id"])
    dbp.conn.execute("UPDATE members SET review_status = 'approved' WHERE id = %s", (kept,))
    dbp.conn.execute(
        "DELETE FROM view_pens WHERE view_id IN (SELECT id FROM build_views WHERE sheet_id = %s)",
        (framing_id,),
    )
    dbp.conn.execute(
        "UPDATE build_views SET no_beams_by = 'tester', no_beams_at = now() WHERE sheet_id = %s",
        (framing_id,),
    )
    run_id = dbp.conn.execute(
        "INSERT INTO build_runs (project_id, sheet_id, requested_by, mode, inputs)"
        " VALUES (%s, %s, 'tester', 'person', '{\"allow_system_values\": true}') RETURNING id",
        (dbp.project_id, framing_id),
    ).fetchone()["id"]
    dbp.conn.commit()
    out = build_sheet(dbp.conn, dbp.config, str(run_id))
    assert out["pieces"] == 0 and out["beam_lines"] == 0
    left = [
        str(r["id"])
        for r in dbp.conn.execute(
            "SELECT id FROM members WHERE sheet_id = %s AND kind = 'Beams'", (framing_id,)
        )
    ]
    assert left == [kept]


def test_one_tag_counter_per_project_never_reuses_a_number(dbp: DbProject) -> None:
    plan_id, _, _ = _project(dbp)
    dbp.conn.execute(
        "INSERT INTO members (project_id, sheet_id, member_id, origin, type, quantity, tag_prefix,"
        " tag_number) VALUES (%s, %s, 'M-copilot', 'extracted', 'beam', 1, 'B', 7)",
        (dbp.project_id, plan_id),
    )
    assert take_tag_numbers(dbp.conn, dbp.project_id, plan_id, "B", 3) == 8  # after the copilot's
    assert take_tag_numbers(dbp.conn, dbp.project_id, plan_id, "B", 1) == 11
    assert take_tag_numbers(dbp.conn, dbp.project_id, plan_id, None, 2) == 1
    row = dbp.conn.execute(
        "SELECT last_number FROM tag_counters WHERE project_id = %s AND prefix = 'B'",
        (dbp.project_id,),
    ).fetchone()
    assert row["last_number"] == 11
    dbp.conn.execute("UPDATE projects SET tag_scope = 'sheet' WHERE id = %s", (dbp.project_id,))
    # per-sheet numbering: the sheet's own count
    assert take_tag_numbers(dbp.conn, dbp.project_id, plan_id, "B", 1) == 8
    dbp.conn.rollback()


def test_auto_run_queues_auto_mode_once(dbp: DbProject) -> None:
    from src.review.auto_run import auto_run

    _project(dbp)
    auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    n = dbp.conn.execute(
        "SELECT count(*) AS n FROM jobs WHERE type = 'auto_build' AND payload->>'project_id' = %s",
        (dbp.project_id,),
    ).fetchone()["n"]
    assert n == 1
    dbp.conn.execute(
        "DELETE FROM jobs WHERE type = 'auto_build' AND payload->>'project_id' = %s",
        (dbp.project_id,),
    )
    dbp.conn.commit()
