"""The `auto_build` job: auto mode, "let the system do its job first" (Phase 11b).

Payload: {"project_id": "<uuid>", "auto_build_id": "<uuid>" (optional), "crossing_rule": ...}.
For every page of the project it proposes the setup (src/build/propose.py) and stores it as SYSTEM
values on the page's first view (Phase 11c; every *_confirmed_by stays NULL; pen source
'suggested', T.O.S. source 'read'), then
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
import math
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.build import RULES_VERSION
from src.build.job import _text_lines, build_sheet
from src.build.propose import (
    choose_column_plan,
    grid_labels,
    propose_crop,
    propose_pen,
    propose_role,
    propose_scale,
    propose_tos,
)
from src.build.segments import page_text_lines
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


def propose_sheet(conn, page: pymupdf.Page, sheet: dict[str, Any]) -> dict[str, Any]:
    """Proposals for one page, stored on the sheet as system values. Returns the evidence."""
    text = _text_lines(conn, str(sheet["id"])) or page_text_lines(page)
    role = propose_role(sheet["page_type_guess"])
    cp = propose_crop(page, text)
    pen, _ = propose_pen(page, cp.box)
    ratio, scale_text = propose_scale(sheet)
    tos = propose_tos(text, cp.box)
    x0, y0, x1, y1 = (round(v, 2) for v in cp.box)
    view = pick_view(load_views(conn, str(sheet["id"])))
    if view is None:
        raise AutoBuildError("a page has no view")
    conn.execute(
        "UPDATE build_views SET role_name = %s, box = %s, scale_ratio = %s, scale_text = %s,"
        " tos_mm = %s, tos_raw = %s, tos_source = %s, column_plan_view_id = NULL WHERE id = %s",
        (role_name(role, sheet["page_type_guess"]),
         Jsonb({"x0": x0, "y0": y0, "x1": x1, "y1": y1}), ratio, scale_text, tos.mm, tos.raw,
         "read" if tos.mm is not None else None, view.id),
    )  # fmt: skip
    conn.execute("DELETE FROM view_pens WHERE view_id = %s", (view.id,))
    if pen:
        conn.execute(
            "INSERT INTO view_pens (view_id, position, pen_class, source)"
            " VALUES (%s, 1, %s, 'suggested')",
            (view.id, pen),
        )
    return {
        "role": role,
        "crop_rule": cp.rule,
        "grid_labels": grid_labels(cp.grid),
        "grid_lines": len(cp.grid),
        "bubbles": len(cp.bubbles),
        "tos_rule": tos.rule,
        "tos_notes": tos.notes,
    }


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
        out = _run(conn, config, project_id, auto_id, sheets, pdf_path, crossing_rule)
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
    log.info(
        "auto build: %s pages, %s built, %s not built, %s pieces",
        out["pages"], out["built"], out["not_built"], out["pieces"],
    )  # fmt: skip
    return {"auto_build_id": auto_id, **out}


def _run(conn, config, project_id, auto_id, sheets, pdf_path, crossing_rule) -> dict[str, Any]:
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

    roles = {str(s["id"]): evidence[str(s["id"])]["role"] for s in sheets}
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
    conn.execute(
        "UPDATE auto_builds SET pages_done = pages_done + %s WHERE id = %s", (skipped, auto_id)
    )

    # the SYSTEM VERSION, frozen in the same transaction as the end of the run
    totals = {"pages": len(sheets), "built": 0, "not_built": 0, "skipped": skipped, "pieces": 0}
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
             Jsonb(pieces), Jsonb(_piece_counts(pieces))),
        )  # fmt: skip
    conn.execute(
        "UPDATE auto_builds SET status = 'done', finished_at = now(), counts = %s WHERE id = %s",
        (Jsonb(totals), auto_id),
    )
    conn.commit()
    return totals


def snapshot_setup(sheet: dict[str, Any], evidence: dict[str, Any], result: dict | None) -> dict:
    """Every setup value of the page with its source ('system' while not confirmed by a person)."""

    def src(col: str) -> str:
        return "person" if sheet.get(col) else SYSTEM

    def num(v) -> float | None:
        return None if v is None else float(v)

    return {
        "role": {"value": sheet["build_role"] or "skip", "source": src("role_confirmed_by")},
        "crop": {"value": sheet["crop_region"], "source": src("crop_confirmed_by")},
        "scale": {
            "value": num(sheet["build_scale_ratio"]),
            "text": sheet["build_scale_text"],
            "source": src("scale_confirmed_by"),
        },
        "pen_class": {"value": sheet["pen_class"], "source": src("pen_class_confirmed_by")},
        "tos": {"value_mm": num(sheet["tos_mm"]), "source": src("tos_confirmed_by")},
        "column_plan": {
            "value": None if sheet["column_plan_sheet_id"] is None
            else str(sheet["column_plan_sheet_id"]),
            "source": src("column_plan_confirmed_by"),
        },
        "evidence": evidence,
        "refused": (result or {}).get("refused"),
        "failed": (result or {}).get("failed"),
        "built": result is not None and "refused" not in result and "failed" not in result,
    }  # fmt: skip


def _xyz(x, y, z) -> list[float] | None:
    if x is None or y is None:
        return None
    return [float(x), float(y), 0.0 if z is None else float(z)]


def snapshot_pieces(conn, sheet_id: str) -> list[dict[str, Any]]:
    """Every built piece of the page as it is now (right after the auto build)."""
    out = []
    for r in conn.execute(
        "SELECT * FROM members WHERE sheet_id = %s AND build_run_id IS NOT NULL ORDER BY member_id",
        (sheet_id,),
    ):
        a = _xyz(r["start_x_mm"], r["start_y_mm"], r["start_z_mm"])
        b = _xyz(r["end_x_mm"], r["end_y_mm"], r["end_z_mm"])
        length = None if a is None or b is None else round(math.dist(a, b), 1)
        page = (
            None if r["page_x0"] is None
            else [float(r["page_x0"]), float(r["page_y0"]),
                  float(r["page_x1"] if r["page_x1"] is not None else r["page_x0"]),
                  float(r["page_y1"] if r["page_y1"] is not None else r["page_y0"])]
        )  # fmt: skip
        out.append(
            {
                "member_id": r["member_id"],
                "kind": r["kind"],
                "type": r["type"],
                "tag": None if r["tag_number"] is None
                else f"{r['tag_prefix'] or '?'}{r['tag_number']}",  # the API's tag text
                "profile": r["profile"],
                "profile_raw": r["profile_raw"],
                "page": page,
                "start": a,
                "end": b,
                "length_mm": length if length else None,
                "build_state": r["build_state"],
                "size_state": r["size_state"],
                "support_state": r["support_state"],
                "piece_index": r["piece_index"],
            }
        )  # fmt: skip
    return out


def _piece_counts(pieces: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {"pieces": len(pieces)}
    for p in pieces:
        out[f"kind:{p['kind']}"] = out.get(f"kind:{p['kind']}", 0) + 1
        out[f"state:{p['build_state']}"] = out.get(f"state:{p['build_state']}", 0) + 1
    return out


__all__ = ["JOB_TYPE", "auto_build", "person_actions", "run_auto_build", "snapshot_pieces"]
