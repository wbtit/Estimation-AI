"""build_sheet job on the (test) Postgres with SYNTHETIC PDFs: refusals, column plan first, storage,
rebuilds that never touch a person's edits."""

from __future__ import annotations

import math

import pymupdf
from build_factory import XS, YS, column, framing_plan, grids
from db_fixtures import DbProject
from psycopg.types.json import Jsonb

from src.build.job import build_sheet
from src.queue import Job

CROP = {"x0": 40, "y0": 40, "x1": 960, "y1": 760}
PEN = "1.5-2.5|black|solid"


def _pdf(dbp: DbProject) -> tuple[str, str]:
    doc = pymupdf.open()
    plan = doc.new_page(width=1000, height=800)
    grids(plan)
    for x in XS.values():
        for y in YS.values():
            column(plan, (x, y))
    framing_plan(doc, with_columns=False)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    rows = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
    ).fetchall()
    return str(rows[0]["id"]), str(rows[1]["id"])


def _setup(dbp: DbProject, sheet_id: str, role: str, tos=True, pen=True) -> None:
    """A person's setup of the page's first view (Phase 11c)."""
    name = {"column_plan": "Column plan", "framing": "Framing plan"}[role]
    dbp.conn.execute(
        "UPDATE build_views SET role_name = %s, role_confirmed_by = 'tester', box = %s,"
        " box_confirmed_by = 'tester', box_confirmed_at = now(), scale_ratio = 96,"
        " scale_text = '1/8\" = 1''-0\"', scale_confirmed_by = 'tester',"
        " scale_confirmed_at = now() WHERE sheet_id = %s AND position = 1",
        (name, Jsonb(CROP), sheet_id),
    )
    if tos:
        dbp.conn.execute(
            "UPDATE build_views SET tos_mm = 3000, tos_raw = 'T.O.S. 3000', tos_source = 'typed',"
            " tos_confirmed_by = 'tester', tos_confirmed_at = now()"
            " WHERE sheet_id = %s AND position = 1",
            (sheet_id,),
        )
    if pen:
        set_pens(dbp, sheet_id, [PEN])
    dbp.conn.commit()


def first_view_id(dbp: DbProject, sheet_id: str) -> str:
    return str(
        dbp.conn.execute(
            "SELECT id FROM build_views WHERE sheet_id = %s AND position = 1", (sheet_id,)
        ).fetchone()["id"]
    )


def set_pens(dbp: DbProject, sheet_id: str, pens: list[str], view_id: str | None = None) -> None:
    vid = view_id or first_view_id(dbp, sheet_id)
    dbp.conn.execute("DELETE FROM view_pens WHERE view_id = %s", (vid,))
    for k, pen in enumerate(pens, start=1):
        dbp.conn.execute(
            "INSERT INTO view_pens (view_id, position, pen_class, source, confirmed_by,"
            " confirmed_at) VALUES (%s, %s, %s, 'person', 'tester', now())",
            (vid, k, pen),
        )


def _run(dbp: DbProject, sheet_id: str, inputs: dict | None = None) -> tuple[str, dict]:
    run_id = str(
        dbp.conn.execute(
            "INSERT INTO build_runs (project_id, sheet_id, requested_by, inputs)"
            " VALUES (%s, %s, 'tester', %s) RETURNING id",
            (dbp.project_id, sheet_id, Jsonb(inputs or {})),
        ).fetchone()["id"]
    )
    dbp.conn.commit()
    return run_id, build_sheet(dbp.conn, dbp.config, run_id)


def _members(dbp: DbProject, sheet_id: str) -> list[dict]:
    return list(
        dbp.conn.execute(
            "SELECT * FROM members WHERE sheet_id = %s ORDER BY member_id", (sheet_id,)
        ).fetchall()
    )


def test_a_page_that_is_not_set_up_is_refused_with_reasons(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    run_id, out = _run(dbp, framing_id)
    assert set(out["refused"]) == {
        "page role not set (column plan or framing)",
        "crop not confirmed",
        "scale not confirmed",
    }
    run = dbp.conn.execute("SELECT * FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["status"] == "refused" and "crop not confirmed" in run["error"]
    _setup(dbp, framing_id, "framing", tos=False, pen=False)
    _, out = _run(dbp, framing_id)
    assert set(out["refused"]) == {"T.O.S. not confirmed", "beam pen class not confirmed"}
    assert _members(dbp, framing_id) == []


def test_a_framing_page_waits_for_the_column_plan_unless_told_there_is_none(dbp: DbProject):
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, framing_id, "framing")
    _, out = _run(dbp, framing_id)
    assert out["refused"] == ["build the column plan page first, or say the job has none"]
    _, out = _run(dbp, framing_id, {"no_column_plan": True})
    assert "no_column_plan" in out["notes"]
    # no glyphs on this framing page and no column plan: only beam-to-beam supports (rule c)
    assert out["pieces"] > 0 and out["nodes_glyph"] == 0 and out["nodes_projected"] == 0


def test_column_plan_then_framing_page_stores_everything(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    _, out = _run(dbp, plan_id)
    assert out["columns"] == 9 and out["created"] == 9
    cols = _members(dbp, plan_id)
    assert {m["kind"] for m in cols} == {"Column"} and {m["type"] for m in cols} == {"column"}
    assert all(m["size_state"] == "undefined" for m in cols)  # no column labels on this page
    assert all(m["tag_number"] is not None for m in cols)

    _setup(dbp, framing_id, "framing")
    run_id, out = _run(dbp, framing_id)
    assert out["nodes_projected"] == 9 and out["girders"] == 3 and out["pieces"] == 10
    assert out["grid_matched_for_registration"] == 6
    run = dbp.conn.execute("SELECT * FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["status"] == "done" and run["rules_version"] and run["inputs"]["tos_mm"] == 3000
    sheet = dbp.conn.execute("SELECT * FROM sheets WHERE id = %s", (framing_id,)).fetchone()
    assert sheet["build_status"] == "built" and sheet["registration"]["ok"] is True
    nodes = dbp.conn.execute(
        "SELECT * FROM support_nodes WHERE build_run_id = %s AND source = 'projected'", (run_id,)
    ).fetchall()
    assert len(nodes) == 9 and all(n["column_member_id"] is not None for n in nodes)
    assert (
        dbp.conn.execute(
            "SELECT count(*) AS n FROM grid_lines WHERE build_run_id = %s", (run_id,)
        ).fetchone()["n"]
        == 6
    )
    beams = _members(dbp, framing_id)
    assert len(beams) == 10 and {m["kind"] for m in beams} == {"Beams"}
    sized = [m for m in beams if m["size_state"] == "sized"]
    assert sorted(m["profile"] for m in sized) == ["W14X22", "W16X26", "W24X55"]
    w16 = [m for m in sized if m["profile"] == "W16X26"][0]
    assert w16["studs"] == 12 and w16["camber_raw"] == 'C=3/4"'
    assert w16["build_state"] == "found" and w16["support_state"] == "both"
    assert float(w16["start_z_mm"]) == 3000 and float(w16["end_elevation_mm"]) == 3000
    length = math.dist(
        (float(w16["start_x_mm"]), float(w16["start_y_mm"])),
        (float(w16["end_x_mm"]), float(w16["end_y_mm"])),
    )
    assert abs(length - 200 * 25.4 / 72 * 96) < 1.0  # grid 1 to grid 2: 200 pt at 1/8"
    cantilever = [m for m in beams if m["support_state"] == "one"]
    assert len(cantilever) == 1 and cantilever[0]["build_state"] in ("needs_review", "attention")
    tags = [(m["tag_prefix"], m["tag_number"]) for m in beams]
    assert len(set(tags)) == 10 and all(n is not None for _, n in tags)
    assert all(m["piece_index"] >= 1 and m["beam_line_id"] for m in beams)


def test_rebuild_keeps_ids_and_never_touches_an_edited_piece(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    _run(dbp, plan_id)
    _setup(dbp, framing_id, "framing")
    _run(dbp, framing_id)
    before = {m["member_id"]: m for m in _members(dbp, framing_id)}
    edited = [m for m in before.values() if m["profile"] == "W14X22"][0]
    dbp.conn.execute(
        "INSERT INTO member_edits (member_id, field_name, original_value, corrected_value,"
        " review_status, reviewer) VALUES (%s, 'profile', %s, %s, 'edited', 'tester')",
        (edited["id"], Jsonb("W14X22"), Jsonb("W14X26")),
    )
    dbp.conn.commit()
    _, out = _run(dbp, framing_id)  # same page, same setup: same ids, nothing new
    after = {m["member_id"]: m for m in _members(dbp, framing_id)}
    assert set(after) == set(before) and out["created"] == 0 and out["kept_edited"] == 1
    assert {m["id"] for m in after.values()} == {m["id"] for m in before.values()}
    assert after[edited["member_id"]]["updated_at"] == edited["updated_at"]

    # a crop that leaves out the right half: untouched pieces there go, the edited one stays
    dbp.conn.execute(
        "UPDATE build_views SET box = %s WHERE sheet_id = %s AND position = 1",
        (Jsonb({"x0": 40, "y0": 40, "x1": 520, "y1": 760}), framing_id),
    )
    dbp.conn.commit()
    _, out = _run(dbp, framing_id)
    now = {m["member_id"]: m for m in _members(dbp, framing_id)}
    assert edited["member_id"] in now and out["removed"] > 0
    others = [m for k, m in now.items() if k != edited["member_id"]]
    assert all(min(float(m["page_x0"]), float(m["page_x1"])) < 520 for m in others)
    kept = now[edited["member_id"]]  # outside the new crop, still there and unchanged
    assert kept["updated_at"] == edited["updated_at"] and kept["beam_line_id"] is not None


def test_job_payload_and_unknown_run(dbp: DbProject) -> None:
    from src.build.job import BuildError, run_build_sheet

    job = Job(
        id="x",
        type="build_sheet",
        payload={"build_run_id": "00000000-0000-0000-0000-000000000000"},
        attempts=1,
        max_attempts=3,
    )  # noqa: E501
    try:
        run_build_sheet(dbp.conn, job, dbp.config)
    except BuildError as err:
        assert "not found" in str(err)
    else:
        raise AssertionError("expected a BuildError")
