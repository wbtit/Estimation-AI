"""Phase 11c person inputs the build reads (SYNTHETIC PDFs and rows): exclude boxes, deselected
lines (with the unmatched count), several beam pens, and views with their own box and scale whose
rebuilds never touch another view's pieces."""

from __future__ import annotations

import math

import numpy as np
import pymupdf
from build_factory import XS, YS, column, framing_plan, grids, line
from db_fixtures import DbProject
from psycopg.types.json import Jsonb
from test_build_job import CROP, PEN, _members, _run, _setup, first_view_id, set_pens

from src.build.inputs import deselect, drop_text, exclude
from src.build.segments import PageSegments, Shape, TextLine

THIN = "0.5-1|black|solid"


# ---- pure ----------------------------------------------------------------------------------------
def _ps(rows: list[tuple[float, float, float, float]]) -> PageSegments:
    ps = PageSegments(size=(1000, 800))
    ps.seg = np.asarray(rows, dtype=float)
    ps.width = np.full(len(rows), 2.0)
    ps.colour = ["black"] * len(rows)
    ps.pdf_dashed = np.zeros(len(rows), dtype=bool)
    ps.shape_id = np.arange(len(rows))
    ps.shapes = [Shape(0, [(10, 10), (20, 20)], False, "s", False, (10, 10, 20, 20), 2.0)]
    return ps


def test_exclude_clips_segments_to_their_parts_outside_every_box() -> None:
    ps = _ps([(0, 100, 1000, 100), (500, 0, 500, 50), (0, 300, 100, 300)])
    out = exclude(ps, [(400, 0, 600, 200), (0, 290, 50, 310)])
    assert out.seg.round(2).tolist() == [
        [0, 100, 400, 100],
        [600, 100, 1000, 100],
        [50, 300, 100, 300],
    ]
    assert out.shape_id.tolist() == [0, 0, 2]
    assert out.shapes == ps.shapes  # its centre (15, 15) is in no box
    ps2 = _ps([(0, 0, 1, 1)])
    assert len(exclude(ps2, [(0, 0, 5, 5)]).seg) == 0
    assert exclude(ps2, []) is ps2


def test_exclude_drops_shapes_and_text_centred_in_a_box() -> None:
    ps = _ps([(0, 0, 1, 1)])
    assert exclude(ps, [(500, 500, 600, 600)]).shapes == ps.shapes
    assert exclude(ps, [(0, 0, 30, 30)]).shapes == []
    t = [TextLine("x", (10, 10, 20, 20)), TextLine("y", (300, 300, 320, 310))]
    assert [x.text for x in drop_text(t, [(0, 0, 50, 50)])] == ["y"]


def test_deselect_matches_by_direction_axis_distance_and_overlap() -> None:
    ps = _ps([(100, 100, 400, 100), (100, 300, 400, 300), (100, 500, 400, 500)])
    ids = [0, 1, 2]
    removed, unmatched = deselect(ps, ids, [(100, 100.8, 400, 100.8)])  # 0.8 pt off: on it
    assert removed == {0} and unmatched == 0
    removed, unmatched = deselect(ps, ids, [(100, 302, 400, 302)])  # 2 pt off: not on it
    assert removed == set() and unmatched == 1
    tilt = math.tan(math.radians(1.5)) * 300
    removed, _ = deselect(ps, ids, [(100, 500, 400, 500 + tilt)])  # 1.5 deg: not on it
    assert removed == set()
    removed, _ = deselect(ps, ids, [(300, 100, 900, 100)])  # a third of the segment: under half
    assert removed == set()
    removed, unmatched = deselect(ps, ids, [(0, 100, 1000, 100), (0, 0, 1, 1)])
    assert removed == {0} and unmatched == 1


# ---- the build on the test database --------------------------------------------------------------
def _pdf(dbp: DbProject, border: bool = False, thin_beam: bool = False) -> tuple[str, str]:
    """A column plan and a framing page; optionally a border line in the beam pen near the top of
    the framing page, and a beam drawn in a second, thinner pen."""
    doc = pymupdf.open()
    plan = doc.new_page(width=1000, height=800)
    grids(plan)
    for x in XS.values():
        for y in YS.values():
            column(plan, (x, y))
    page = framing_plan(doc, with_columns=False)
    if border:
        line(page, (50, 50), (950, 50))  # the sheet border, same pen as the beams
    if thin_beam:
        line(page, (500, 400), (500, 600), width=0.7)  # a beam drawn lighter (second pen)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    rows = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
    ).fetchall()
    return str(rows[0]["id"]), str(rows[1]["id"])


def _beam_lines(dbp: DbProject, run_id: str) -> list[dict]:
    return list(
        dbp.conn.execute(
            "SELECT * FROM beam_lines WHERE build_run_id = %s ORDER BY y0, x0", (run_id,)
        ).fetchall()
    )


def test_an_exclude_box_removes_a_border_line_in_the_beam_pen(dbp: DbProject) -> None:
    _, framing_id = _pdf(dbp, border=True)
    _setup(dbp, framing_id, "framing")
    run_id, out = _run(dbp, framing_id, {"no_column_plan": True})
    on_border = [b for b in _beam_lines(dbp, run_id) if float(b["y0"]) == 50 == float(b["y1"])]
    assert len(on_border) == 1  # the border is a beam line: the noise the person sees
    vid = first_view_id(dbp, framing_id)
    # a suggested box is not a build input; only the accepted one counts
    dbp.conn.execute(
        "INSERT INTO view_exclusions (view_id, box, status) VALUES (%s, %s, 'suggested')",
        (vid, Jsonb({"x0": 0, "y0": 0, "x1": 1000, "y1": 60})),
    )
    dbp.conn.commit()
    run_id, out = _run(dbp, framing_id, {"no_column_plan": True})
    assert any(float(b["y0"]) == 50 for b in _beam_lines(dbp, run_id))
    dbp.conn.execute("UPDATE view_exclusions SET status = 'accepted' WHERE view_id = %s", (vid,))
    dbp.conn.commit()
    run_id, out2 = _run(dbp, framing_id, {"no_column_plan": True})
    assert not any(float(b["y0"]) < 60 for b in _beam_lines(dbp, run_id))
    assert out2["beam_lines"] == out["beam_lines"] - 1 and out2["exclude_boxes"] == 1
    run = dbp.conn.execute("SELECT inputs FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["inputs"]["exclude_boxes"] == 1 and run["inputs"]["view_id"] == vid
    # the untouched border pieces of the earlier build are gone
    assert not any(
        m["page_y0"] is not None and float(m["page_y0"]) < 60 for m in _members(dbp, framing_id)
    )


def test_deselected_lines_are_not_beam_candidates_and_unmatched_ones_are_counted(
    dbp: DbProject,
) -> None:
    _, framing_id = _pdf(dbp)
    _setup(dbp, framing_id, "framing")
    run_id, before = _run(dbp, framing_id, {"no_column_plan": True})
    # girder 2 and the cantilever off C2 are one beam line, x 200 to 900
    assert _reach(dbp, run_id, 400) == 900
    vid = first_view_id(dbp, framing_id)
    for x0, y0, x1, y1 in ((800, 400, 900, 400), (10, 10, 30, 10)):  # the cantilever; nothing
        dbp.conn.execute(
            "INSERT INTO view_deselections (view_id, x0, y0, x1, y1, created_by)"
            " VALUES (%s, %s, %s, %s, %s, 'tester')",
            (vid, x0, y0, x1, y1),
        )
    dbp.conn.commit()
    run_id, out = _run(dbp, framing_id, {"no_column_plan": True})
    assert _reach(dbp, run_id, 400) == 800  # the deselected part is not a beam candidate
    assert out["beam_lines"] == before["beam_lines"]
    assert out["deselections"] == 2 and out["deselections_unmatched"] == 1
    run = dbp.conn.execute("SELECT counts FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["counts"]["deselections_unmatched"] == 1


def _reach(dbp: DbProject, run_id: str, y: float) -> float:
    """The right end of the beam line along y."""
    return max(
        max(float(b["x0"]), float(b["x1"]))
        for b in _beam_lines(dbp, run_id)
        if float(b["y0"]) == y == float(b["y1"])
    )


def test_a_second_pen_adds_its_beams(dbp: DbProject) -> None:
    _, framing_id = _pdf(dbp, thin_beam=True)
    _setup(dbp, framing_id, "framing")
    run_id, one = _run(dbp, framing_id, {"no_column_plan": True})
    assert {b["pen_class"] for b in _beam_lines(dbp, run_id)} == {PEN}
    set_pens(dbp, framing_id, [PEN, THIN])
    dbp.conn.commit()
    run_id, two = _run(dbp, framing_id, {"no_column_plan": True})
    lines = _beam_lines(dbp, run_id)
    assert {b["pen_class"] for b in lines} == {PEN, THIN}
    assert [b for b in lines if b["pen_class"] == THIN][0]["x0"] == 500
    assert two["beam_lines"] == one["beam_lines"] + 1 and two["beam_pens"] == 2


def _length(m: dict) -> float:
    return math.dist(
        (float(m["start_x_mm"]), float(m["start_y_mm"])),
        (float(m["end_x_mm"]), float(m["end_y_mm"])),
    )


def test_a_view_with_its_own_scale_gives_its_own_lengths_and_keeps_the_other_views_pieces(
    dbp: DbProject,
) -> None:
    _, framing_id = _pdf(dbp)
    _setup(dbp, framing_id, "framing")
    _, out1 = _run(dbp, framing_id, {"no_column_plan": True})
    first = {m["member_id"]: m for m in _members(dbp, framing_id)}
    assert all(m["build_view_id"] is None for m in first.values())
    # no supports on this page (no glyphs, no column plan): each beam line is one piece
    cant1 = next(m for m in first.values() if float(m["page_y0"]) == 400 == float(m["page_y1"]))
    assert _length(cant1) == pytest_approx(700 * 25.4 / 72 * 96)
    # view 2: the right half of the page, drawn at a different scale
    v2 = str(
        dbp.conn.execute(
            "INSERT INTO build_views (sheet_id, position, name, box, box_confirmed_by,"
            " role_name, role_confirmed_by, scale_ratio, scale_confirmed_by, tos_mm, tos_source,"
            " tos_confirmed_by) VALUES (%s, 2, 'View 2', %s, 'tester', 'Framing plan', 'tester',"
            " 48, 'tester', 1500, 'typed', 'tester') RETURNING id",
            (framing_id, Jsonb({"x0": 700, "y0": 300, "x1": 960, "y1": 500})),
        ).fetchone()["id"]
    )
    set_pens(dbp, framing_id, [PEN], view_id=v2)
    dbp.conn.commit()
    run_id, out2 = _run(dbp, framing_id, {"no_column_plan": True})
    assert out2["pieces"] == out1["pieces"]  # a run with no view id builds the first view
    first = {m["member_id"]: m for m in _members(dbp, framing_id)}  # as view 2 finds them
    run2 = str(
        dbp.conn.execute(
            "INSERT INTO build_runs (project_id, sheet_id, view_id, requested_by, inputs)"
            " VALUES (%s, %s, %s, 'tester', %s) RETURNING id",
            (dbp.project_id, framing_id, v2, Jsonb({"no_column_plan": True})),
        ).fetchone()["id"]
    )
    dbp.conn.commit()
    from src.build.job import build_sheet

    out = build_sheet(dbp.conn, dbp.config, run2)
    assert out["pieces"] >= 1
    mine = [m for m in _members(dbp, framing_id) if str(m["build_view_id"] or "") == v2]
    cant2 = next(m for m in mine if float(m["page_y0"]) == 400 == float(m["page_y1"]))
    assert _length(cant2) == pytest_approx(200 * 25.4 / 72 * 48)  # x 700 to 900 in view 2
    assert float(cant2["start_z_mm"]) == 1500
    assert cant2["member_id"] != cant1["member_id"]
    # view 1's pieces are all still there, unchanged
    now = {m["member_id"]: m for m in _members(dbp, framing_id) if m["build_view_id"] is None}
    assert set(now) == set(first)
    assert all(now[k]["updated_at"] == first[k]["updated_at"] for k in now)
    # a rebuild of view 1 leaves view 2's pieces alone
    _run(dbp, framing_id, {"no_column_plan": True})
    again = [m for m in _members(dbp, framing_id) if str(m["build_view_id"] or "") == v2]
    assert {m["id"] for m in again} == {m["id"] for m in mine}
    built = dbp.conn.execute("SELECT built_at FROM build_views WHERE id = %s", (v2,)).fetchone()
    assert built["built_at"] is not None


def test_the_first_view_builds_exactly_as_the_sheet_did(dbp: DbProject) -> None:
    """The migration's first view carries the page's values; the same inputs give the same build."""
    _, framing_id = _pdf(dbp)
    _setup(dbp, framing_id, "framing")
    _, a = _run(dbp, framing_id, {"no_column_plan": True})
    ids_a = sorted(m["member_id"] for m in _members(dbp, framing_id))
    _, b = _run(dbp, framing_id, {"no_column_plan": True})
    ids_b = sorted(m["member_id"] for m in _members(dbp, framing_id))
    assert ids_a == ids_b and b["created"] == 0
    for k in ("pieces", "beam_lines", "girders", "segments"):
        assert a[k] == b[k]
    assert "deselections_unmatched" not in a  # no person inputs: the counts are as before views
    assert CROP == {"x0": 40, "y0": 40, "x1": 960, "y1": 760}


def pytest_approx(v: float):
    import pytest

    return pytest.approx(v, abs=0.2)
