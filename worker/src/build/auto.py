"""The `auto_build` job: auto mode, "let the system do its job first" (Phase 11b).

Payload: {"project_id": "<uuid>", "auto_build_id": "<uuid>" (optional), "crossing_rule": ...,
"build_pages": bool (default false)}.

SUGGEST ONLY by default (session preparation): a queued auto run (after the upload's scan, or the
review UI's "auto mode") proposes and stores every page's setup and builds nothing; a page is built
when a person presses Build on it (mode 'person', inside its crop), and that build freezes its own
snapshot (src/build/snapshots.py). Only `build_pages` true (or a direct `auto_build()` call by an
evaluation tool, whose default stays the old behaviour) builds every page as below.

For every page of the project it proposes the setup (src/build/propose.py) and stores it as SYSTEM
values on the page's first view (Phase 11c; every *_confirmed_by stays NULL; pen source
'suggested', T.O.S. source 'read'; Phase 12a: no beam pen on a column plan page), then
builds the column plan pages and after them the framing pages with `build_sheet` in mode 'auto'.
A page that cannot be built gets its reasons on its refused run. Last, in one transaction with the
end of the run, the SYSTEM VERSION is frozen: one build_snapshots row per page (setup values with
their sources, every piece), which nothing changes later.

Auto mode runs once per project: it refuses when the project already has a finished auto run or
any person action (a confirmed or reviewed sheet, a sheet or member edit, a logged action), so it
never overwrites a person's work. Logs counts only, never page text.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.build import RULES_VERSION
from src.build.dimension_scale import scale_from_dimensions
from src.build.job import _text_lines, build_sheet
from src.build.page_roles import page_role, skip_role_name, stored_view_titles
from src.build.propose import (
    choose_column_plan,
    grid_labels,
    propose_crop,
    propose_pen,
    propose_scale,
    propose_tos,
)
from src.build.segments import crop, page_text_lines, parse_page
from src.build.snapshots import piece_counts, snapshot_pieces, snapshot_setup
from src.build.views import load_views, pick_view, role_name, view_as_sheet
from src.config import WorkerConfig
from src.queue import Job
from src.review.sheet_lines_job import sheet_lines

log = logging.getLogger("worker.auto_build")

JOB_TYPE = "auto_build"
SYSTEM = "system"


class AutoBuildError(Exception):
    """A failure with a message that is safe to store (no page text)."""


def run_auto_build(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    return auto_build(
        conn,
        config,
        str(job.payload.get("project_id", "")),
        job.payload.get("auto_build_id"),
        str(job.payload.get("crossing_rule") or "family"),
        job_id=str(job.id),
        # session preparation: a queued auto run only SUGGESTS (no page is built) unless the job
        # says otherwise; pages are built when a person presses Build on a page
        build_pages=bool(job.payload.get("build_pages", False)),
    )


def person_actions(conn, project_id: str) -> list[str]:
    """What a person already did on the project (empty when nothing)."""
    checks = {
        "a confirmed or reviewed page": (
            "SELECT 1 FROM sheets WHERE project_id = %s AND (crop_confirmed_by IS NOT NULL"
            " OR scale_confirmed_by IS NOT NULL OR tos_confirmed_by IS NOT NULL"
            " OR pen_class_confirmed_by IS NOT NULL OR role_confirmed_by IS NOT NULL"
            " OR column_plan_confirmed_by IS NOT NULL OR reviewed_by IS NOT NULL) LIMIT 1"
        ),
        # label-first page edits (page type, takeoff decision, ...) are not build setup and auto
        # mode never touches them
        "a confirmed view value or a view a person added": (
            "SELECT 1 FROM build_views v JOIN sheets s ON s.id = v.sheet_id"
            " WHERE s.project_id = %s AND (v.box_confirmed_by IS NOT NULL"
            " OR v.scale_confirmed_by IS NOT NULL OR v.tos_confirmed_by IS NOT NULL"
            " OR v.role_confirmed_by IS NOT NULL OR v.no_beams_by IS NOT NULL"
            " OR v.column_plan_confirmed_by IS NOT NULL OR v.position > 1"
            " OR EXISTS (SELECT 1 FROM view_pens p WHERE p.view_id = v.id"
            "  AND p.confirmed_by IS NOT NULL)"
            " OR EXISTS (SELECT 1 FROM view_exclusions e WHERE e.view_id = v.id)"
            " OR EXISTS (SELECT 1 FROM view_deselections d WHERE d.view_id = v.id)) LIMIT 1"
        ),
        "a page setup edit": (
            "SELECT 1 FROM sheet_edits e JOIN sheets s ON s.id = e.sheet_id"
            " WHERE s.project_id = %s AND e.field_name IN ('build_role', 'crop_region',"
            " 'build_scale', 'tos', 'pen_class', 'column_plan_sheet_id', 'save_page') LIMIT 1"
        ),
        "a built piece edit": (
            "SELECT 1 FROM member_edits e JOIN members m ON m.id = e.member_id"
            " WHERE m.project_id = %s AND m.build_run_id IS NOT NULL LIMIT 1"
        ),
        "a logged review action": (
            "SELECT 1 FROM count_actions WHERE project_id = %s"
            " AND action IN ('setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save') LIMIT 1"
        ),
        "a person's build": (
            "SELECT 1 FROM build_runs WHERE project_id = %s AND mode = 'person' LIMIT 1"
        ),
    }
    return [what for what, q in checks.items() if conn.execute(q, (project_id,)).fetchone()]


def _start(conn, project_id: str, auto_id: str | None, job_id: str | None, n: int) -> str:
    if auto_id:
        conn.execute(
            "UPDATE auto_builds SET status = 'running', pages_total = %s, rules_version = %s,"
            " job_id = COALESCE(job_id, %s) WHERE id = %s",
            (n, RULES_VERSION, job_id, auto_id),
        )
        return auto_id
    return str(
        conn.execute(
            "INSERT INTO auto_builds (project_id, job_id, status, pages_total, rules_version)"
            " VALUES (%s, %s, 'running', %s, %s) RETURNING id",
            (project_id, job_id, n, RULES_VERSION),
        ).fetchone()["id"]
    )


def _refuse(conn, project_id: str, auto_id: str | None, job_id: str | None, why: str) -> dict:
    if auto_id:
        conn.execute(
            "UPDATE auto_builds SET status = 'refused', error = %s, finished_at = now()"
            " WHERE id = %s",
            (why, auto_id),
        )
    else:
        conn.execute(
            "INSERT INTO auto_builds (project_id, job_id, status, error, finished_at)"
            " VALUES (%s, %s, 'refused', %s, now())",
            (project_id, job_id, why),
        )
    conn.commit()
    log.info("auto build refused")
    return {"refused": [why]}


PILE_ROLE = "Pile plan"
SCALE_FROM_DIMENSIONS = "from dimensions"


def propose_sheet(conn, page: pymupdf.Page, sheet: dict[str, Any]) -> dict[str, Any]:
    """Proposals for one page, stored on the sheet as system values. Returns the evidence."""
    text = _text_lines(conn, str(sheet["id"])) or page_text_lines(page)
    # Phase 12b rules "plan_only_roles" and "pile_plan" (src/build/page_roles.py)
    pr = page_role(sheet.get("title"), stored_view_titles(text), sheet["page_type_guess"])
    role = pr.role
    cp = propose_crop(page, text)
    # Phase 12a (a proposal default, a reported deviation): a column plan page gets beam pen = none
    # (a system value, no view_pens row), so its build makes columns and no beams
    pen = None if role in (None, "column_plan") else propose_pen(page, cp.box)[0]
    ratio, scale_text = propose_scale(sheet)
    scale_rule = "stored" if ratio is not None else None
    dims = None
    if ratio is None and role is not None:
        # Phase 12b rule "scale_from_dimensions": a system value, flagged for review like any
        dims = scale_from_dimensions(crop(parse_page(page), cp.box), text, cp.box)
        if dims.ratio is not None:
            ratio, scale_text, scale_rule = dims.ratio, SCALE_FROM_DIMENSIONS, "dimensions"
        else:
            scale_rule = "scale_needed"
    tos = propose_tos(text, cp.box)
    x0, y0, x1, y1 = (round(v, 2) for v in cp.box)
    view = pick_view(load_views(conn, str(sheet["id"])))
    if view is None:
        raise AutoBuildError("a page has no view")
    name = (
        PILE_ROLE
        if pr.pile
        else role_name(role, sheet["page_type_guess"])
        if role is not None
        else (skip_role_name(sheet.get("title")) or role_name(None, sheet["page_type_guess"]))
    )
    conn.execute(
        "UPDATE build_views SET role_name = %s, box = %s, scale_ratio = %s, scale_text = %s,"
        " tos_mm = %s, tos_raw = %s, tos_source = %s, column_plan_view_id = NULL WHERE id = %s",
        (name, Jsonb({"x0": x0, "y0": y0, "x1": x1, "y1": y1}), ratio, scale_text, tos.mm,
         tos.raw, "read" if tos.mm is not None else None, view.id),
    )  # fmt: skip
    conn.execute("DELETE FROM view_pens WHERE view_id = %s", (view.id,))
    if pen:
        conn.execute(
            "INSERT INTO view_pens (view_id, position, pen_class, source)"
            " VALUES (%s, 1, %s, 'suggested')",
            (view.id, pen),
        )
    ev = {
        "role": role,
        "role_rule": pr.rule,
        "pile_plan": pr.pile,
        "crop_rule": cp.rule,
        "grid_labels": grid_labels(cp.grid),
        "grid_lines": len(cp.grid),
        "bubbles": len(cp.bubbles),
        "tos_rule": tos.rule,
        "tos_notes": tos.notes,
        "pen_rule": "column_plan_no_beams" if role == "column_plan" else "proposed",
        "scale_rule": scale_rule,
    }
    if dims is not None:
        ev["scale_dimension_pairs"] = dims.pairs
        ev["scale_dimensions_agreeing"] = dims.agreeing
        ev["scale_dimensions_rule"] = dims.rule
    return ev


def _new_run(conn, sheet: dict[str, Any], auto_id: str, inputs: dict[str, Any]) -> str:
    return str(
        conn.execute(
            "INSERT INTO build_runs (project_id, sheet_id, requested_by, mode, auto_build_id,"
            " inputs) VALUES (%s, %s, %s, 'auto', %s, %s) RETURNING id",
            (sheet["project_id"], sheet["id"], SYSTEM, auto_id, Jsonb(inputs)),
        ).fetchone()["id"]
    )


def _plan_labels(conn, run_id: str) -> set[tuple[str, str]]:
    return {
        (r["family"] or "", r["label"])
        for r in conn.execute(
            "SELECT family, label FROM grid_lines WHERE build_run_id = %s AND label IS NOT NULL",
            (run_id,),
        )
    }


def auto_build(
    conn: psycopg.Connection,
    config: WorkerConfig,
    project_id: str,
    auto_id: str | None = None,
    crossing_rule: str = "family",
    job_id: str | None = None,
    build_pages: bool = True,
) -> dict[str, Any]:
    done = conn.execute(
        "SELECT 1 FROM auto_builds WHERE project_id = %s AND status = 'done' LIMIT 1",
        (project_id,),
    ).fetchone()
    if done:
        return _refuse(conn, project_id, auto_id, job_id, "auto mode already ran on this project")
    acted = person_actions(conn, project_id)
    if acted:
        return _refuse(
            conn, project_id, auto_id, job_id, "a person already worked on it: " + ", ".join(acted)
        )
    sheets = conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s JOIN project_files f ON f.project_id ="
        " s.project_id WHERE s.project_id = %s ORDER BY s.page_index",
        (project_id,),
    ).fetchall()
    if not sheets:
        return _refuse(conn, project_id, auto_id, job_id, "the project has no pages")
    pdf_path = config.upload_dir / sheets[0]["stored_path"]
    if not pdf_path.is_file():
        raise AutoBuildError("stored PDF is missing")
    auto_id = _start(conn, project_id, auto_id, job_id, len(sheets))
    conn.commit()
    try:
        out = _run(conn, config, project_id, auto_id, sheets, pdf_path, crossing_rule, build_pages)
    except Exception as err:
        conn.rollback()
        msg = str(err) if isinstance(err, AutoBuildError) else type(err).__name__
        conn.execute(
            "UPDATE auto_builds SET status = 'failed', error = %s, finished_at = now()"
            " WHERE id = %s",
            (msg, auto_id),
        )
        conn.commit()
        raise
    if not build_pages:
        log.info("auto suggestions: %s pages", out["pages"])
        return {"auto_build_id": auto_id, **out}
    log.info(
        "auto build: %s pages, %s built, %s not built, %s pieces",
        out["pages"], out["built"], out["not_built"], out["pieces"],
    )  # fmt: skip
    return {"auto_build_id": auto_id, **out}


def _paths(evidence: dict[str, dict[str, Any]]) -> dict[str, int]:
    return {
        "scale_from_dimensions": sum(e["scale_rule"] == "dimensions" for e in evidence.values()),
        "scale_needed": sum(e["scale_rule"] == "scale_needed" for e in evidence.values()),
        "not_a_plan": sum(e["role_rule"] != "plan_text" for e in evidence.values()),
        "pile_plans": sum(bool(e["pile_plan"]) for e in evidence.values()),
    }


def _run(
    conn, config, project_id, auto_id, sheets, pdf_path, crossing_rule, build_pages=True
) -> dict[str, Any]:
    evidence: dict[str, dict[str, Any]] = {}
    with pymupdf.open(pdf_path) as doc:
        for s in sheets:
            evidence[str(s["id"])] = propose_sheet(conn, doc[s["page_index"]], s)
    conn.commit()
    # every line of every vector page, for "Pick beam" and snapping in the review UI
    have = {
        str(r["sheet_id"])
        for r in conn.execute(
            "SELECT l.sheet_id FROM sheet_lines l JOIN sheets s ON s.id = l.sheet_id"
            " WHERE s.project_id = %s",
            (project_id,),
        )
    }
    for s in sheets:
        if s["page_kind"] == "vector" and str(s["id"]) not in have:
            sheet_lines(conn, config, str(s["id"]))
            conn.commit()

    if not build_pages:  # suggestions only: setup values stored as system values, nothing built
        totals = {"pages": len(sheets), "suggested": len(sheets), "built": 0, **_paths(evidence)}
        conn.execute(
            "UPDATE auto_builds SET status = 'done', finished_at = now(), pages_done = %s,"
            " counts = %s WHERE id = %s",
            (len(sheets), Jsonb({**totals, "mode": "suggest"}), auto_id),
        )
        conn.commit()
        return totals

    runs: dict[str, str] = {}  # sheet id -> build run id
    results: dict[str, dict[str, Any]] = {}
    base = {"allow_system_values": True, "crossing_rule": crossing_rule}

    def build(s, inputs) -> None:
        sid = str(s["id"])
        run_id = _new_run(conn, s, auto_id, inputs)
        conn.commit()
        try:
            results[sid] = build_sheet(conn, config, run_id)
        except Exception as err:  # one page failing never stops auto mode
            results[sid] = {"failed": type(err).__name__}
        runs[sid] = run_id
        conn.execute("UPDATE auto_builds SET pages_done = pages_done + 1 WHERE id = %s", (auto_id,))
        conn.commit()

    # a page with no scale (none stored, none from its dimensions) is not built: "Scale needed"
    roles = {
        str(s["id"]): None
        if evidence[str(s["id"])]["scale_rule"] == "scale_needed"
        else evidence[str(s["id"])]["role"]
        for s in sheets
    }
    for s in sheets:
        if roles[str(s["id"])] == "column_plan":
            build(s, base)
    plans = {
        sid: _plan_labels(conn, runs[sid])
        for sid, r in results.items()
        if roles[sid] == "column_plan" and "refused" not in r and "failed" not in r
    }
    for s in sheets:
        sid = str(s["id"])
        if roles[sid] != "framing":
            continue
        plan, rule = choose_column_plan(evidence[sid]["grid_labels"], plans)
        evidence[sid]["column_plan_rule"] = rule
        conn.execute(
            "UPDATE build_views SET column_plan_view_id ="
            " (SELECT id FROM build_views WHERE sheet_id = %s AND position = 1)"
            " WHERE sheet_id = %s AND position = 1",
            (plan, sid),
        )
        choice = {"column_plan_sheet_id": plan} if plan else {"no_column_plan": True}
        build(s, {**base, **choice})
    skipped = sum(1 for s in sheets if roles[str(s["id"])] is None)
    paths = _paths(evidence)
    conn.execute(
        "UPDATE auto_builds SET pages_done = pages_done + %s WHERE id = %s", (skipped, auto_id)
    )

    # the SYSTEM VERSION, frozen in the same transaction as the end of the run
    totals = {
        "pages": len(sheets),
        "built": 0,
        "not_built": 0,
        "skipped": skipped,
        "pieces": 0,
        **paths,
    }
    for page in conn.execute(
        "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (project_id,)
    ).fetchall():
        sid = str(page["id"])
        s = view_as_sheet(page, pick_view(load_views(conn, sid)))  # the page's first view
        res = results.get(sid)
        built = res is not None and "refused" not in res and "failed" not in res
        pieces = snapshot_pieces(conn, sid) if built else []
        if res is not None:
            totals["built" if built else "not_built"] += 1
        totals["pieces"] += len(pieces)
        ev = {k: v for k, v in evidence[sid].items() if k != "grid_labels"}
        conn.execute(
            "INSERT INTO build_snapshots (project_id, auto_build_id, sheet_id, build_run_id,"
            " setup, pieces, counts) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (project_id, auto_id, sid, runs.get(sid), Jsonb(snapshot_setup(s, ev, res)),
             Jsonb(pieces), Jsonb(piece_counts(pieces))),
        )  # fmt: skip
    conn.execute(
        "UPDATE auto_builds SET status = 'done', finished_at = now(), counts = %s WHERE id = %s",
        (Jsonb(totals), auto_id),
    )
    conn.commit()
    return totals


__all__ = ["JOB_TYPE", "auto_build", "person_actions", "run_auto_build", "snapshot_pieces"]
