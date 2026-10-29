"""Session preparation: a queued auto run only suggests, a person's Build freezes its own system
version, and every row carries actor + session from the project's open session (migration 027).
SYNTHETIC pages only (tests/build_factory.py)."""

from __future__ import annotations

import psycopg
import pytest
from db_fixtures import DbProject
from psycopg.types.json import Jsonb
from test_auto_build import _project

from src.build.auto import run_auto_build
from src.build.job import build_sheet
from src.queue import Job


def _suggest(dbp: DbProject, **payload) -> dict:
    body = {"project_id": dbp.project_id, **payload}
    jid = dbp.conn.execute(
        "INSERT INTO jobs (type, payload, status) VALUES ('auto_build', %s, 'processing')"
        " RETURNING id",
        (Jsonb(body),),
    ).fetchone()["id"]
    dbp.conn.commit()
    return run_auto_build(dbp.conn, Job(str(jid), "auto_build", body, 1, 3), dbp.config)


def _person_build(dbp: DbProject, sid: str, who: str = "tester", **inputs) -> dict:
    run = dbp.conn.execute(
        "INSERT INTO build_runs (project_id, sheet_id, requested_by, mode, inputs)"
        " VALUES (%s, %s, %s, 'person', %s) RETURNING id",
        (dbp.project_id, sid, who, Jsonb({"allow_system_values": True, **inputs})),
    ).fetchone()["id"]
    dbp.conn.commit()
    return build_sheet(dbp.conn, dbp.config, str(run))


def _n(dbp: DbProject, sql: str, *args) -> int:
    return dbp.conn.execute(sql, args).fetchone()["n"]


def test_a_queued_auto_run_only_suggests(dbp: DbProject) -> None:
    plan_id, framing_id, _ = _project(dbp)
    out = _suggest(dbp)
    assert out["built"] == 0 and out["suggested"] == 3
    pid = dbp.project_id
    assert _n(dbp, "SELECT count(*) AS n FROM build_runs WHERE project_id = %s", pid) == 0
    assert _n(dbp, "SELECT count(*) AS n FROM build_snapshots WHERE project_id = %s", pid) == 0
    assert _n(dbp, "SELECT count(*) AS n FROM members WHERE project_id = %s", pid) == 0
    views = {
        str(r["sheet_id"]): r
        for r in dbp.conn.execute(
            "SELECT v.* FROM build_views v JOIN sheets s ON s.id = v.sheet_id"
            " WHERE s.project_id = %s",
            (pid,),
        )
    }
    for sid in (plan_id, framing_id):  # suggestions stored, nothing confirmed
        v = views[sid]
        assert v["role_name"] and v["box"] and v["scale_ratio"] is not None
        assert v["box_confirmed_by"] is None and v["role_confirmed_by"] is None
    auto = dbp.conn.execute("SELECT * FROM auto_builds WHERE project_id = %s", (pid,)).fetchone()
    assert auto["status"] == "done" and auto["counts"]["mode"] == "suggest"
    # the old behaviour only when the job asks for it explicitly (evaluation tools)
    assert _suggest(dbp, build_pages=True)["refused"]  # auto mode already ran


def test_a_person_build_freezes_the_system_result_before_any_edit(dbp: DbProject) -> None:
    plan_id, framing_id, _ = _project(dbp)
    _suggest(dbp)
    _person_build(dbp, plan_id)
    snap = dbp.conn.execute(
        "SELECT * FROM build_snapshots WHERE sheet_id = %s", (plan_id,)
    ).fetchone()
    built = _n(dbp, "SELECT count(*) AS n FROM members WHERE sheet_id = %s", plan_id)
    assert snap["mode"] == "person" and snap["auto_build_id"] is None
    assert snap["before_user_edit"] is True and snap["actor"] == "system"
    assert len(snap["pieces"]) == built == 9 and snap["setup"]["built"] is True
    assert snap["setup"]["crop"]["source"] == "system"
    # only that page was built
    assert _n(dbp, "SELECT count(*) AS n FROM members WHERE sheet_id = %s", framing_id) == 0
    # a person corrects a piece, then builds again: the new snapshot says it came after an edit
    member = dbp.conn.execute(
        "SELECT id FROM members WHERE sheet_id = %s LIMIT 1", (plan_id,)
    ).fetchone()["id"]
    dbp.conn.execute(
        "INSERT INTO member_edits (member_id, field_name, original_value, corrected_value,"
        " review_status, reviewer) VALUES (%s, 'profile', '\"a\"', '\"b\"', 'edited', 'x')",
        (member,),
    )
    dbp.conn.commit()
    _person_build(dbp, plan_id)
    flags = [
        r["before_user_edit"]
        for r in dbp.conn.execute(
            "SELECT before_user_edit FROM build_snapshots WHERE sheet_id = %s ORDER BY created_at",
            (plan_id,),
        )
    ]
    assert flags == [True, False]
    with pytest.raises(psycopg.errors.RaiseException):
        dbp.conn.execute("UPDATE build_snapshots SET counts = '{}' WHERE sheet_id = %s", (plan_id,))
    dbp.conn.rollback()


def _log(dbp: DbProject, who: str, sid: str | None = None) -> dict:
    row = dbp.conn.execute(
        "INSERT INTO count_actions (project_id, sheet_id, action, who) VALUES (%s, %s, 'view', %s)"
        " RETURNING actor, session_id",
        (dbp.project_id, sid, who),
    ).fetchone()
    dbp.conn.commit()
    return row


def test_rows_carry_the_actor_and_session_of_the_open_session(dbp: DbProject) -> None:
    plan_id, _, _ = _project(dbp)
    assert _log(dbp, "someone") == {"actor": "owner", "session_id": None}  # no session
    session = dbp.conn.execute(
        "INSERT INTO work_sessions (project_id, actor, started_by) VALUES (%s, 'estimator', 'x')"
        " RETURNING id",
        (dbp.project_id,),
    ).fetchone()["id"]
    dbp.conn.commit()
    assert _log(dbp, "someone", plan_id) == {"actor": "estimator", "session_id": session}
    assert _log(dbp, "system") == {"actor": "system", "session_id": session}
    # a sheet edit finds its project through the sheet, a drawn member is a person's
    edit = dbp.conn.execute(
        "INSERT INTO sheet_edits (sheet_id, field_name, original_value, corrected_value, editor)"
        " VALUES (%s, 'tos', 'null', '1', 'someone') RETURNING actor, session_id",
        (plan_id,),
    ).fetchone()
    assert edit == {"actor": "estimator", "session_id": session}
    ev = dbp.conn.execute(
        "INSERT INTO page_events (project_id, sheet_id, kind, who) VALUES (%s, %s, 'active', 'x')"
        " RETURNING actor, session_id",
        (dbp.project_id, plan_id),
    ).fetchone()
    assert ev == {"actor": "estimator", "session_id": session}
    # one open session per project
    with pytest.raises(psycopg.errors.UniqueViolation):
        dbp.conn.execute(
            "INSERT INTO work_sessions (project_id, actor, started_by) VALUES (%s, 'owner', 'x')",
            (dbp.project_id,),
        )
    dbp.conn.rollback()
    dbp.conn.execute("UPDATE work_sessions SET ended_at = now() WHERE id = %s", (session,))
    dbp.conn.commit()
    assert _log(dbp, "someone") == {"actor": "owner", "session_id": None}
