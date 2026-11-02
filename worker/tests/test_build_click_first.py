"""Phase 14d: column click-first Builds (COLUMN_MODE) on the test Postgres with SYNTHETIC PDFs: a
column-plan Build makes no columns; a framing Build splits beams at the columns PLACED on the
column-plan page and on itself; the "column plan = none" escape still works."""

from __future__ import annotations

import uuid

import pytest
from build_factory import XS, YS
from db_fixtures import DbProject
from psycopg.types.json import Jsonb
from test_build_job import _members, _pdf, _run, _setup, first_view_id

from src.build.job import WARN_NO_PLACED_COLUMNS, WARN_PLAN_NO_RUN, WARN_PLAN_NOT_BUILT
from src.build.page import column_mode_default

CLICK = {"column_mode": "click_first"}


def place(dbp: DbProject, sheet_id: str, pt: tuple[float, float]) -> str:
    """A column a person drew (origin manual), as the API's draw route stores it."""
    row = dbp.conn.execute(
        "INSERT INTO members (project_id, sheet_id, member_id, origin, type, kind, quantity,"
        " page_x0, page_y0, review_status, added_by) VALUES (%s, %s, %s, 'manual', 'column',"
        " 'Column', 1, %s, %s, 'edited', 'tester') RETURNING id",
        (dbp.project_id, sheet_id, f"LF-P-{uuid.uuid4().hex[:16]}", pt[0], pt[1]),
    ).fetchone()
    dbp.conn.commit()
    return str(row["id"])


def delete(dbp: DbProject, member_pk: str) -> None:
    dbp.conn.execute(
        "INSERT INTO member_edits (member_id, field_name, original_value, corrected_value,"
        " review_status, reviewer) VALUES (%s, 'review_status', %s, %s, 'rejected', 'tester')",
        (member_pk, Jsonb("edited"), Jsonb("rejected")),
    )
    dbp.conn.commit()


def test_the_setting_defaults_to_click_first(monkeypatch) -> None:
    monkeypatch.delenv("COLUMN_MODE", raising=False)
    assert column_mode_default() == "click_first"
    monkeypatch.setenv("COLUMN_MODE", "glyph")
    assert column_mode_default() == "glyph"
    monkeypatch.setenv("COLUMN_MODE", "other")
    with pytest.raises(ValueError):
        column_mode_default()


def test_a_click_first_column_plan_build_makes_no_columns(dbp: DbProject) -> None:
    plan_id, _ = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    run_id, out = _run(dbp, plan_id, CLICK)
    assert out["columns"] == 0 and "columns_click_first" in out["notes"]
    assert [m for m in _members(dbp, plan_id) if m["type"] == "column"] == []
    run = dbp.conn.execute("SELECT inputs FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["inputs"]["column_mode"] == "click_first"  # recorded on the Build
    syms = dbp.conn.execute(
        "SELECT symbols FROM page_symbols WHERE build_run_id = %s", (run_id,)
    ).fetchone()
    assert len(syms["symbols"]) == 9  # the candidate symbols are still stored
    # the old rules on request (and the setting) still make the 9 columns
    _, out = _run(dbp, plan_id, {"column_mode": "glyph"})
    assert out["columns"] == 9


def test_a_framing_build_splits_beams_at_the_placed_columns(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    _run(dbp, plan_id, CLICK)
    _setup(dbp, framing_id, "framing")
    run_id, out = _run(dbp, framing_id, CLICK)
    # Phase 14f: no placed columns is a warning: beams and grids are built without column supports
    assert "refused" not in out and WARN_NO_PLACED_COLUMNS in out["notes"]
    assert out["pieces"] > 0 and out["nodes_projected"] == 0
    run = dbp.conn.execute(
        "SELECT status, notes FROM build_runs WHERE id = %s", (run_id,)
    ).fetchone()
    assert run["status"] == "done" and WARN_NO_PLACED_COLUMNS in run["notes"]
    # the "column plan = none" escape still works
    _, out = _run(dbp, framing_id, {**CLICK, "no_column_plan": True})
    assert "refused" not in out and out["nodes_projected"] == 0
    # the person places the 9 columns on the column plan page (one more, then deleted)
    for x in XS.values():
        for y in YS.values():
            place(dbp, plan_id, (x, y))
    delete(dbp, place(dbp, plan_id, (350.0, 300.0)))
    run_id, out = _run(dbp, framing_id, CLICK)
    # as the glyph columns of the column plan did (test_build_job): 9 supports, 3 girders, 10 pieces
    assert out["nodes_projected"] == 9 and out["girders"] == 3 and out["pieces"] == 10
    nodes = dbp.conn.execute(
        "SELECT x_pt, y_pt FROM support_nodes WHERE build_run_id = %s AND source = 'projected'",
        (run_id,),
    ).fetchall()
    assert sorted((round(n["x_pt"]), round(n["y_pt"])) for n in nodes) == sorted(
        (round(x), round(y)) for x in XS.values() for y in YS.values()
    )


def test_columns_placed_on_the_framing_page_itself_count(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    _run(dbp, plan_id, CLICK)
    _setup(dbp, framing_id, "framing")
    for x in XS.values():
        for y in YS.values():
            place(dbp, framing_id, (x, y))
    _, out = _run(dbp, framing_id, CLICK)
    assert out["nodes_projected"] == 9 and out["girders"] == 3 and out["pieces"] == 10


def test_the_find_similar_job_runs_the_image_search_on_the_stored_build(dbp: DbProject) -> None:
    from src.build.similar_job import run_find_similar
    from src.queue import Job

    plan_id, _ = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    run_id, _ = _run(dbp, plan_id, CLICK)
    payload = {"sheet_id": plan_id, "build_run_id": run_id, "click": [XS["A"], YS["1"]]}
    out = run_find_similar(dbp.conn, Job("j", "find_similar", payload, 1, 3), dbp.config)
    assert out["example"]["solid"] == "square"  # the solid squares of the synthetic plan
    got = sorted((round(c["centre"][0]), round(c["centre"][1])) for c in out["combined"])
    assert got == sorted((round(x), round(y)) for x in XS.values() for y in YS.values())
    assert out["vector"] == 9 and out["settings"]["image"] is True
    assert out["runtime_s"] < 2.0
    # the same answer twice
    again = run_find_similar(dbp.conn, Job("j", "find_similar", payload, 1, 3), dbp.config)
    assert again["combined"] == out["combined"]


def test_the_build_caches_the_page_ink_and_find_similar_hits_or_misses_it(dbp: DbProject) -> None:
    """Phase 14e: the column plan's cleaned ink is cached at Build time; a click only searches."""
    from src.build.col_image import cache_path
    from src.build.similar_job import run_find_similar
    from src.queue import Job

    plan_id, _ = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    run_id, _ = _run(dbp, plan_id, CLICK)
    path = cache_path(dbp.config.upload_dir, run_id)
    assert path.is_file()
    payload = {"sheet_id": plan_id, "build_run_id": run_id, "click": [XS["A"], YS["1"]]}
    hit = run_find_similar(dbp.conn, Job("j", "find_similar", payload, 1, 3), dbp.config)
    assert hit["cache"]["hit"] is True
    path.unlink()
    miss = run_find_similar(dbp.conn, Job("j", "find_similar", payload, 1, 3), dbp.config)
    assert miss["cache"]["hit"] is False and path.is_file()  # rendered and saved again
    assert miss["combined"] == hit["combined"]
    assert all(c["score"] is None or 0.6 <= c["score"] <= 1.0 for c in hit["combined"])
    # a rebuild of the view replaces the file of its older Build
    run2, _ = _run(dbp, plan_id, CLICK)
    assert cache_path(dbp.config.upload_dir, run2).is_file() and not path.is_file()


def test_the_worker_wakes_on_a_notify(dbp: DbProject) -> None:
    import time

    from src.db import connect
    from src.main import JOBS_CHANNEL, wait_for_notify

    with connect(dbp.config.database_url) as listener:
        listener.execute(f"LISTEN {JOBS_CHANNEL}")
        listener.commit()
        t0 = time.perf_counter()
        assert wait_for_notify(listener, 0.2) is False
        assert time.perf_counter() - t0 >= 0.19
        dbp.conn.execute(f"NOTIFY {JOBS_CHANNEL}")
        dbp.conn.commit()
        t0 = time.perf_counter()
        assert wait_for_notify(listener, 5.0) is True
        assert time.perf_counter() - t0 < 1.0


def test_a_named_column_plan_that_is_not_built_is_a_warning(dbp: DbProject) -> None:
    """Phase 14f: the framing page builds beams and grids without column supports."""
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)  # set up, never built
    _setup(dbp, framing_id, "framing")
    run_id, out = _run(
        dbp, framing_id, {**CLICK, "column_plan_view_id": first_view_id(dbp, plan_id)}
    )
    assert "refused" not in out and out["pieces"] > 0
    assert WARN_PLAN_NOT_BUILT in out["notes"] and "no_column_plan" in out["notes"]
    run = dbp.conn.execute(
        "SELECT status, notes FROM build_runs WHERE id = %s", (run_id,)
    ).fetchone()
    assert run["status"] == "done" and WARN_PLAN_NOT_BUILT in run["notes"]


def test_a_column_plan_with_no_finished_build_is_a_warning(dbp: DbProject) -> None:
    plan_id, framing_id = _pdf(dbp)
    _setup(dbp, plan_id, "column_plan", tos=False, pen=False)
    # marked built, but no finished run (e.g. its last run failed)
    dbp.conn.execute("UPDATE build_views SET built_at = now() WHERE sheet_id = %s", (plan_id,))
    dbp.conn.commit()
    _setup(dbp, framing_id, "framing")
    _, out = _run(dbp, framing_id, CLICK)
    assert "refused" not in out and out["pieces"] > 0
    assert WARN_PLAN_NO_RUN in out["notes"]
