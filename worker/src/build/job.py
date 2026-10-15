"""The `build_sheet` job: build one page line-first and store the result (Phase 11).

Payload: {"build_run_id": "<uuid>"} (the API writes the build_runs row and the job together). The
job refuses, with a clear reason stored on the run, when the page is not set up:
  - every page: a role (column plan or framing), a confirmed crop and a confirmed scale;
  - a framing page: also a confirmed T.O.S. and a confirmed beam pen class, and a built column plan
    (the one named in the run inputs, or the only built one of the project) unless the run says
    there is none ("no_column_plan": true).
A refusal is not a failure: the job completes with {"refused": [...]}.

Storage: the run's grid lines, support nodes and beam lines replace those of earlier runs of the
sheet. Pieces are members with stable ids (src/build/pieces.py). A member a person touched (an edit
row, reviewed, or confirmed or rejected in count mode) is never changed or deleted, and a new piece
that overlaps a touched piece is not added; untouched pieces of earlier runs that are gone are
removed. Category = members.kind ('Beams', 'Column'); tags (the BOM piecemark) follow the
project's tag scope. Logs counts only, never page text.
"""

from __future__ import annotations

import logging
import math
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.build import RULES_VERSION
from src.build.geom import Pt, angle_deg, angle_diff, project
from src.build.grids import CROSSING_RULES, Bubble, GridLine
from src.build.labels import Attached
from src.build.page import ColumnPlanRef, PageBuild, Setup, build_page
from src.build.pieces import build_state, length_mm, plan_mm, stable_member_id
from src.build.segments import TextLine
from src.config import WorkerConfig
from src.queue import Job

log = logging.getLogger("worker.build")

JOB_TYPE = "build_sheet"
BEAM_KIND, COLUMN_KIND = "Beams", "Column"
OVERLAP_ANGLE_DEG, OVERLAP_PERP_PT, OVERLAP_SHARE = 2.0, 2.0, 0.5


class BuildError(Exception):
    """A failure with a message that is safe to store (no page text)."""


def run_build_sheet(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    return build_sheet(conn, config, str(job.payload.get("build_run_id", "")))


def setup_reasons(sheet: dict[str, Any]) -> list[str]:
    """Why the page cannot be built yet (empty when it can). Same rules as the API."""
    out = []
    role = sheet.get("build_role")
    if role not in ("column_plan", "framing"):
        out.append("page role not set (column plan or framing)")
    if sheet.get("crop_region") is None or not sheet.get("crop_confirmed_by"):
        out.append("crop not confirmed")
    if sheet.get("build_scale_ratio") is None or not sheet.get("scale_confirmed_by"):
        out.append("scale not confirmed")
    if role == "framing":
        if not sheet.get("tos_confirmed_by"):
            out.append("T.O.S. not confirmed")
        if not sheet.get("pen_class") or not sheet.get("pen_class_confirmed_by"):
            out.append("beam pen class not confirmed")
    return out


def _finish(conn, run_id: str, status: str, **fields: Any) -> None:
    sets = ["status = %s", "finished_at = now()"]
    vals: list[Any] = [status]
    for k, v in fields.items():
        sets.append(f"{k} = %s")
        vals.append(Jsonb(v) if k in ("inputs", "counts") else v)
    conn.execute(f"UPDATE build_runs SET {', '.join(sets)} WHERE id = %s", [*vals, run_id])


def _refuse(conn, run_id: str, reasons: list[str]) -> dict[str, Any]:
    _finish(conn, run_id, "refused", error="; ".join(reasons))
    conn.commit()
    log.info("build refused: %s reasons", len(reasons))
    return {"refused": reasons}


def _column_plan(
    conn, project_id: str, sheet_id: str, inputs: dict[str, Any]
) -> tuple[ColumnPlanRef | None, str | None, list[str]]:
    """(column plan, its sheet id, refusal reasons) for a framing page."""
    if inputs.get("no_column_plan"):
        return None, None, []
    rows = conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s AND build_role = 'column_plan'"
        " AND build_status = 'built' AND id <> %s ORDER BY page_index",
        (project_id, sheet_id),
    ).fetchall()
    wanted = inputs.get("column_plan_sheet_id")
    if wanted:
        if str(wanted) not in {str(r["id"]) for r in rows}:
            return None, None, ["the named column plan page is not built"]
        plan_id = str(wanted)
    elif len(rows) == 1:
        plan_id = str(rows[0]["id"])
    elif not rows:
        return None, None, ["build the column plan page first, or say the job has none"]
    else:
        return None, None, ["several column plan pages are built: name one"]
    plan = conn.execute("SELECT * FROM sheets WHERE id = %s", (plan_id,)).fetchone()
    run = conn.execute(
        "SELECT id FROM build_runs WHERE sheet_id = %s AND status = 'done'"
        " ORDER BY finished_at DESC LIMIT 1",
        (plan_id,),
    ).fetchone()
    if run is None:
        return None, None, ["the column plan page has no finished build"]
    grid = [
        GridLine(
            r["label"],
            r["family"],
            (float(r["x0"]), float(r["y0"])),
            (float(r["x1"]), float(r["y1"])),
            [],
            [],
        )
        for r in conn.execute(
            "SELECT * FROM grid_lines WHERE build_run_id = %s ORDER BY label", (run["id"],)
        )
        if r["label"]
    ]
    cols = [
        (
            (float(r["x_pt"]), float(r["y_pt"])),
            {
                "column_member_id": str(r["column_member_id"]),
                "grid": [r["grid_x"], r["grid_y"]] if r["grid_x"] else None,
            },
        )
        for r in conn.execute(
            "SELECT * FROM support_nodes WHERE build_run_id = %s AND column_member_id IS NOT NULL"
            " ORDER BY y_pt, x_pt",
            (run["id"],),
        )
    ]
    return ColumnPlanRef(grid, float(plan["build_scale_ratio"]), cols), plan_id, []


def _text_lines(conn, sheet_id: str) -> list[TextLine]:
    out = []
    for r in conn.execute(
        "SELECT x0, y0, x1, y1, text, angle_deg, orientation FROM text_items"
        " WHERE sheet_id = %s AND level = 'line' AND text IS NOT NULL ORDER BY y0, x0",
        (sheet_id,),
    ):
        ang = r["angle_deg"]
        if ang is None:
            ang = 90.0 if r["orientation"] == "vertical" else 0.0
        box = (float(r["x0"]), float(r["y0"]), float(r["x1"]), float(r["y1"]))
        out.append(TextLine(r["text"], box, float(ang) % 180.0))
    return out


def _legend(conn, project_id: str) -> dict[str, list[tuple[str, str | None]]]:
    out: dict[str, list[tuple[str, str | None]]] = {}
    for r in conn.execute(
        "SELECT mark, designation_raw, profile FROM legend_rows WHERE project_id = %s"
        " ORDER BY created_at, id",
        (project_id,),
    ):
        out.setdefault(r["mark"], []).append((r["designation_raw"], r["profile"]))
    return out


def build_sheet(conn: psycopg.Connection, config: WorkerConfig, run_id: str) -> dict[str, Any]:
    run = conn.execute("SELECT * FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    if run is None:
        raise BuildError("build run not found")
    sheet = conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id"
        " WHERE s.id = %s",
        (run["sheet_id"],),
    ).fetchone()
    if sheet is None:
        raise BuildError("sheet not found")
    reasons = setup_reasons(sheet)
    if reasons:
        return _refuse(conn, run_id, reasons)
    project_id, sheet_id = str(sheet["project_id"]), str(sheet["id"])
    inputs = dict(run["inputs"] or {})
    plan_ref, plan_sheet = None, None
    if sheet["build_role"] == "framing":
        plan_ref, plan_sheet, reasons = _column_plan(conn, project_id, sheet_id, inputs)
        if reasons:
            return _refuse(conn, run_id, reasons)
    pdf_path = config.upload_dir / sheet["stored_path"]
    if not pdf_path.is_file():
        raise BuildError("stored PDF is missing")
    crop = sheet["crop_region"]
    setup = Setup(
        (float(crop["x0"]), float(crop["y0"]), float(crop["x1"]), float(crop["y1"])),
        float(sheet["build_scale_ratio"]),
        None if sheet["tos_mm"] is None else float(sheet["tos_mm"]),
        sheet["pen_class"],
        sheet["build_role"],
        str(inputs.get("crossing_rule") or "family"),
    )
    if setup.crossing_rule not in CROSSING_RULES:
        return _refuse(conn, run_id, [f"unknown crossing rule {setup.crossing_rule!r}"])
    inputs.update(
        crossing_rule=setup.crossing_rule,
        crop=crop,
        scale_ratio=setup.ratio,
        scale_text=sheet["build_scale_text"],
        tos_mm=setup.tos_mm,
        tos_raw=sheet["tos_raw"],
        pen_class=setup.pen_class,
        role=setup.role,
        column_plan_sheet_id=plan_sheet,
    )
    conn.execute(
        "UPDATE build_runs SET status = 'running', inputs = %s, rules_version = %s WHERE id = %s",
        (Jsonb(inputs), RULES_VERSION, run_id),
    )
    conn.execute("UPDATE sheets SET build_status = 'building' WHERE id = %s", (sheet_id,))
    conn.commit()
    try:
        text = _text_lines(conn, sheet_id)
        with pymupdf.open(pdf_path) as doc:
            pb = build_page(
                doc[sheet["page_index"]],
                setup,
                text or None,
                _legend(conn, project_id),
                plan_ref,
            )
        counts = store(conn, project_id, sheet_id, run_id, sheet, pb)
        _finish(conn, run_id, "done", counts=counts, notes=pb.notes)
        conn.execute(
            "UPDATE sheets SET build_status = 'built', built_at = now(), registration = %s"
            " WHERE id = %s",
            (Jsonb(pb.registration.to_json()) if pb.registration else None, sheet_id),
        )
        conn.commit()
    except Exception as err:
        conn.rollback()
        msg = str(err) if isinstance(err, BuildError) else type(err).__name__
        _finish(conn, run_id, "failed", error=msg)
        conn.execute("UPDATE sheets SET build_status = 'failed' WHERE id = %s", (sheet_id,))
        conn.commit()
        raise
    log.info("built a sheet: %s pieces, %s columns", counts["pieces"], counts["columns"])
    return {"build_run_id": run_id, **counts, "notes": pb.notes}


# ---- storage ------------------------------------------------------------------------------------
def _touched_rows(conn, sheet_id: str) -> dict[str, dict[str, Any]]:
    """Built members of the sheet (member_id -> row) with a `touched` flag."""
    rows = conn.execute(
        "SELECT m.id, m.member_id, m.review_status, m.count_state, m.page_x0, m.page_y0,"
        " m.page_x1, m.page_y1,"
        " EXISTS (SELECT 1 FROM member_edits e WHERE e.member_id = m.id) AS has_edit"
        " FROM members m WHERE m.sheet_id = %s AND m.member_id LIKE 'LF-%%'",
        (sheet_id,),
    ).fetchall()
    out = {}
    for r in rows:
        touched = r["has_edit"] or r["review_status"] != "unreviewed"
        touched = touched or r["count_state"] != "suggested"
        out[r["member_id"]] = {**r, "touched": touched}
    return out


def _overlaps(a: Pt, b: Pt, row: dict[str, Any]) -> bool:
    if row["page_x0"] is None:
        return False
    c = (float(row["page_x0"]), float(row["page_y0"]))
    d = (float(row["page_x1"]), float(row["page_y1"]))
    if angle_diff(angle_deg(a, b), angle_deg(c, d)) > OVERLAP_ANGLE_DEG:
        return False
    s0, p0 = project(c, a, b)
    s1, p1 = project(d, a, b)
    if max(p0, p1) > OVERLAP_PERP_PT:
        return False
    lo, hi = sorted((s0, s1))
    shared = min(hi, math.dist(a, b)) - max(lo, 0.0)
    return shared >= OVERLAP_SHARE * min(math.dist(a, b), math.dist(c, d))


def _size_fields(att: Attached) -> dict[str, Any]:
    lb = att.label
    return {
        "profile_raw": lb.raw if lb else None,
        "profile": lb.canonical if lb else None,
        "mark": lb.mark if lb else None,
        "studs": lb.studs if lb else None,
        "camber_raw": lb.camber_raw if lb else None,
        "camber_mm": None if lb is None or lb.camber_mm is None else round(lb.camber_mm, 2),
        "size_state": att.size_state,
        "label_evidence": Jsonb(att.evidence()),
    }


def store(conn, project_id: str, sheet_id: str, run_id: str, sheet, pb: PageBuild) -> dict:
    ratio = pb.setup.ratio
    tos = pb.setup.tos_mm
    # geometry of earlier runs goes, except what a touched piece still points at (a foreign key
    # SET NULL would change that piece)
    kept = (
        "SELECT {col} FROM members m WHERE m.sheet_id = %s AND m.{col} IS NOT NULL AND ("
        " m.review_status <> 'unreviewed' OR m.count_state <> 'suggested'"
        " OR EXISTS (SELECT 1 FROM member_edits e WHERE e.member_id = m.id))"
    )
    conn.execute(
        "DELETE FROM grid_lines WHERE sheet_id = %s AND build_run_id IS DISTINCT FROM %s",
        (sheet_id, run_id),
    )
    conn.execute(
        "DELETE FROM beam_lines WHERE sheet_id = %s AND build_run_id IS DISTINCT FROM %s"
        f" AND id NOT IN ({kept.format(col='beam_line_id')})",
        (sheet_id, run_id, sheet_id),
    )
    conn.execute(
        "DELETE FROM support_nodes WHERE sheet_id = %s AND build_run_id IS DISTINCT FROM %s"
        f" AND id NOT IN ({kept.format(col='start_node_id')})"
        f" AND id NOT IN ({kept.format(col='end_node_id')})",
        (sheet_id, run_id, sheet_id, sheet_id),
    )
    for g in pb.grid_lines:
        b: Bubble | None = g.bubbles[0] if g.bubbles else None
        conn.execute(
            "INSERT INTO grid_lines (sheet_id, build_run_id, label, family, x0, y0, x1, y1,"
            " bubble, source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'found')",
            (sheet_id, run_id, g.label, g.family, *_r(g.p0), *_r(g.p1),
             Jsonb({"cx": round(b.centre[0], 2), "cy": round(b.centre[1], 2),
                    "r": round(b.radius, 2), "count": len(g.bubbles)}) if b else None),
        )  # fmt: skip
    existing = _touched_rows(conn, sheet_id)
    touched = [r for r in existing.values() if r["touched"]]
    new_ids: set[str] = set()
    counts = {"kept_edited": 0, "kept_edited_overlap": 0, "created": 0, "updated": 0}

    def upsert(member_id: str, fields: dict[str, Any]) -> str | None:
        row = existing.get(member_id)
        if row is not None and row["touched"]:
            counts["kept_edited"] += 1
            new_ids.add(member_id)
            return str(row["id"])
        if row is None and fields.get("page_x1") is not None:
            a, b = (fields["page_x0"], fields["page_y0"]), (fields["page_x1"], fields["page_y1"])
            if any(_overlaps(a, b, t) for t in touched):
                counts["kept_edited_overlap"] += 1
                return None
        new_ids.add(member_id)
        cols = list(fields)
        if row is None:
            got = conn.execute(
                f"INSERT INTO members (project_id, sheet_id, member_id, origin, quantity,"
                f" {', '.join(cols)}) VALUES (%s, %s, %s, 'extracted', 1,"
                f" {', '.join(['%s'] * len(cols))}) RETURNING id",
                [project_id, sheet_id, member_id, *fields.values()],
            ).fetchone()
            counts["created"] += 1
            return str(got["id"])
        conn.execute(
            f"UPDATE members SET {', '.join(f'{c} = %s' for c in cols)} WHERE id = %s",
            [*fields.values(), row["id"]],
        )
        counts["updated"] += 1
        return str(row["id"])

    # columns of the column plan: members first, so their nodes can point at them
    column_member: dict[int, str] = {}
    for k, (g, att) in enumerate(zip(pb.columns, pb.column_labels, strict=True)):
        x, y = plan_mm(g.centre, ratio)
        grid = [g.grid.n_label, g.grid.a_label] if g.grid else [None, None]
        fields = {
            "type": "column",
            "kind": COLUMN_KIND,
            "kind_evidence": Jsonb({"source": "line_first_build", "rule": pb.column_rule}),
            **_size_fields(att),
            "build_run_id": run_id,
            "page_x0": round(g.centre[0], 2),
            "page_y0": round(g.centre[1], 2),
            "page_x1": None,
            "page_y1": None,
            "support_state": None,
            "build_state": "found" if att.size_state == "sized" else "attention",
            "start_grid_x": grid[0],
            "start_grid_y": grid[1],
            "start_x_mm": round(x, 1),
            "start_y_mm": round(y, 1),
            "end_x_mm": round(x, 1),
            "end_y_mm": round(y, 1),
            "start_resolution_method": "line_first_build",
            "end_resolution_method": "line_first_build",
            "source_bbox": Jsonb(_box(g.box)),
        }
        mid = upsert(stable_member_id(sheet_id, COLUMN_KIND, g.centre), fields)
        if mid is not None:
            column_member[k] = mid
    glyph_column = {id(g): column_member.get(k) for k, g in enumerate(pb.columns)}

    node_uuid: dict[int, str] = {}
    for n in pb.supports.nodes:
        col = None
        grid = [None, None]
        if n.source == "glyph" and n.glyph is not None:
            glyph = _support_glyphs(pb)[n.glyph]
            col = glyph_column.get(id(glyph))
            if glyph.grid:
                grid = [glyph.grid.n_label, glyph.grid.a_label]
        elif n.source == "projected":
            col = n.evidence.get("column_member_id")
            grid = n.evidence.get("grid") or grid
        x, y = plan_mm(n.point, ratio)
        got = conn.execute(
            "INSERT INTO support_nodes (project_id, sheet_id, build_run_id, x_pt, y_pt, plan_x_mm,"
            " plan_y_mm, grid_x, grid_y, source, column_member_id, evidence)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (project_id, sheet_id, run_id, *_r(n.point), round(x, 1), round(y, 1), grid[0],
             grid[1], n.source, col, Jsonb(_json_safe(n.evidence))),
        ).fetchone()  # fmt: skip
        node_uuid[n.id] = str(got["id"])

    line_uuid: dict[int, str] = {}
    for ln in pb.lines:
        got = conn.execute(
            "INSERT INTO beam_lines (sheet_id, build_run_id, x0, y0, x1, y1, source_segments,"
            " gaps_bridged, gaps_pt, pen_class, role)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (sheet_id, run_id, *_r(ln.p0), *_r(ln.p1), len(ln.seg_ids), len(ln.gaps),
             Jsonb(ln.gaps), pb.setup.pen_class, ln.role),
        ).fetchone()  # fmt: skip
        line_uuid[ln.id] = str(got["id"])

    for p, att in zip(pb.supports.pieces, pb.piece_labels, strict=True):
        sx, sy = plan_mm(p.a, ratio)
        ex, ey = plan_mm(p.b, ratio)
        state = build_state(att.size_state, p.support_state)
        fields = {
            "type": "beam",
            "kind": BEAM_KIND,
            "kind_evidence": Jsonb({"source": "line_first_build"}),
            **_size_fields(att),
            "build_run_id": run_id,
            "beam_line_id": line_uuid[p.line],
            "piece_index": p.index,
            "page_x0": round(p.a[0], 2),
            "page_y0": round(p.a[1], 2),
            "page_x1": round(p.b[0], 2),
            "page_y1": round(p.b[1], 2),
            "start_node_id": node_uuid.get(p.start_node) if p.start_node is not None else None,
            "end_node_id": node_uuid.get(p.end_node) if p.end_node is not None else None,
            "support_state": p.support_state,
            "build_state": state,
            "start_x_mm": round(sx, 1),
            "start_y_mm": round(sy, 1),
            "start_z_mm": tos,
            "end_x_mm": round(ex, 1),
            "end_y_mm": round(ey, 1),
            "end_z_mm": tos,
            "start_elevation_mm": tos,
            "end_elevation_mm": tos,
            "start_elevation_raw": sheet["tos_raw"],
            "end_elevation_raw": sheet["tos_raw"],
            "start_resolution_method": "line_first_build",
            "end_resolution_method": "line_first_build",
            "length_source": "plan_geometry",
            "plan_sheet_id": sheet_id,
            "plan_start_x_mm": round(sx, 1),
            "plan_start_y_mm": round(sy, 1),
            "plan_end_x_mm": round(ex, 1),
            "plan_end_y_mm": round(ey, 1),
            "plan_scale_ratio": ratio,
            "plan_method": "pdf_geometry",
            "source_bbox": Jsonb(_box((*p.a, *p.b))),
        }
        upsert(stable_member_id(sheet_id, BEAM_KIND, p.a, p.b), fields)

    removed = 0
    for mid, row in existing.items():
        if mid not in new_ids and not row["touched"]:
            conn.execute("DELETE FROM members WHERE id = %s", (row["id"],))
            removed += 1
    assign_tags(conn, project_id, sheet_id)
    out = pb.counts()
    out.update(counts)
    out["removed"] = removed
    out["length_mm_total"] = round(sum(length_mm(p.a, p.b, ratio) for p in pb.supports.pieces), 1)
    out["build_found"] = sum(
        build_state(a.size_state, p.support_state) == "found"
        for p, a in zip(pb.supports.pieces, pb.piece_labels, strict=True)
    )
    out["build_needs_review"] = sum(
        build_state(a.size_state, p.support_state) == "needs_review"
        for p, a in zip(pb.supports.pieces, pb.piece_labels, strict=True)
    )
    out["build_attention"] = out["pieces"] - out["build_found"] - out["build_needs_review"]
    return out


def _support_glyphs(pb: PageBuild) -> list:
    """The glyph list the supports were built from (the columns on a column plan)."""
    if pb.setup.role == "column_plan":
        keep = {id(g) for g in pb.columns}
        return [g for g in pb.glyphs if id(g) in keep]
    return pb.glyphs


def _r(p: Pt) -> tuple[float, float]:
    return (round(p[0], 2), round(p[1], 2))


def _box(b) -> dict[str, float]:
    x0, x1 = sorted((b[0], b[2]))
    y0, y1 = sorted((b[1], b[3]))
    return {"x0": round(x0, 2), "y0": round(y0, 2), "x1": round(x1, 2), "y1": round(y1, 2)}


def _json_safe(ev: dict) -> dict:
    return {k: (list(v) if isinstance(v, tuple) else v) for k, v in ev.items()}


def assign_tags(conn, project_id: str, sheet_id: str) -> int:
    """Tag (prefix + running number) for every built member of the sheet that has none, in
    reading order. Numbers continue after the highest number in use for that prefix in the job
    (tag scope 'job') or on the sheet (scope 'sheet'); a tag is never reused or changed."""
    scope = conn.execute("SELECT tag_scope FROM projects WHERE id = %s", (project_id,)).fetchone()[
        "tag_scope"
    ]
    rows = conn.execute(
        "SELECT m.id, COALESCE(k.abbreviation, k.provisional_prefix) AS prefix FROM members m"
        " LEFT JOIN member_kinds k ON k.kind = m.kind WHERE m.sheet_id = %s"
        " AND m.member_id LIKE 'LF-%%' AND m.tag_number IS NULL"
        " ORDER BY m.page_y0 NULLS LAST, m.page_x0 NULLS LAST, m.member_id",
        (sheet_id,),
    ).fetchall()
    where = "project_id = %s" if scope == "job" else "sheet_id = %s"
    used: dict[str | None, int] = {}
    for r in conn.execute(
        f"SELECT tag_prefix AS p, MAX(tag_number) AS n FROM members WHERE {where}"
        " AND tag_number IS NOT NULL GROUP BY tag_prefix",
        (project_id if scope == "job" else sheet_id,),
    ):
        used[r["p"]] = int(r["n"])
    for r in rows:
        used[r["prefix"]] = used.get(r["prefix"], 0) + 1
        conn.execute(
            "UPDATE members SET tag_prefix = %s, tag_number = %s WHERE id = %s",
            (r["prefix"], used[r["prefix"]], r["id"]),
        )
    return len(rows)


__all__ = ["JOB_TYPE", "BuildError", "build_sheet", "run_build_sheet", "setup_reasons"]
