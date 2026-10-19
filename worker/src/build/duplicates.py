"""Phase 12b rule "column_duplicates" (docs/PHASE12B_PLAN.md rule 5): count each column once per
project.

After a column-plan page is stored, each of its columns is compared with the columns of the
project's OTHER column-plan pages that are already built (and not themselves duplicates):
  - "grid_labels": both carry the same grid crossing (start_grid_x and start_grid_y, both set); or
  - "registered": the two pages' grids register (src/build/register.py) and the other column,
    projected into this page, lies within DUP_TOL_IN real inches of it.
A matched column is kept but marked in its kind evidence: duplicate_of = the other member's row id,
duplicate_rule = the rule. The BOM and the totals leave it out. A page built later is the one whose
columns are marked, so auto mode (column plans in page order) keeps the first page's columns.
"""

from __future__ import annotations

import math
from typing import Any

from psycopg.types.json import Jsonb

from src.build.grids import GridLine
from src.build.register import project_columns, register

DUP_TOL_IN = 24.0


def _grid(conn, run_id: str) -> list[GridLine]:
    return [
        GridLine(
            r["label"],
            r["family"],
            (float(r["x0"]), float(r["y0"])),
            (float(r["x1"]), float(r["y1"])),
            [],
            [],
        )  # fmt: skip
        for r in conn.execute(
            "SELECT * FROM grid_lines WHERE build_run_id = %s ORDER BY label", (run_id,)
        )
        if r["label"]
    ]


def mark_duplicate_columns(
    conn, project_id: str, sheet_id: str, run_id: str, ratio: float, grid: list[GridLine]
) -> int:
    """Mark this page's columns that another built column-plan page already has. Returns the
    count marked."""
    mine = conn.execute(
        "SELECT id, page_x0, page_y0, start_grid_x, start_grid_y, kind_evidence FROM members"
        " WHERE sheet_id = %s AND build_run_id = %s AND type = 'column'",
        (sheet_id, run_id),
    ).fetchall()
    if not mine:
        return 0
    others = conn.execute(
        "SELECT m.id, m.sheet_id, m.build_run_id, m.page_x0, m.page_y0, m.start_grid_x,"
        " m.start_grid_y, r.inputs FROM members m JOIN build_runs r ON r.id = m.build_run_id"
        " WHERE m.project_id = %s AND m.sheet_id <> %s AND m.type = 'column'"
        " AND m.build_run_id IS NOT NULL AND r.status = 'done'"
        " AND COALESCE(m.kind_evidence->>'duplicate_of', '') = ''"
        " ORDER BY m.sheet_id, m.page_y0, m.page_x0, m.id",
        (project_id, sheet_id),
    ).fetchall()
    if not others:
        return 0
    found: dict[str, tuple[str, str]] = {}
    by_label: dict[tuple[str, str], str] = {}
    for o in others:
        if o["start_grid_x"] and o["start_grid_y"]:
            by_label.setdefault((o["start_grid_x"], o["start_grid_y"]), str(o["id"]))
    for m in mine:
        key = (m["start_grid_x"], m["start_grid_y"])
        if key[0] and key[1] and key in by_label:
            found[str(m["id"])] = (by_label[key], "grid_labels")
    # registered positions, page by page
    tol = DUP_TOL_IN * 72.0 / ratio
    by_sheet: dict[str, list[Any]] = {}
    for o in others:
        by_sheet.setdefault(str(o["sheet_id"]), []).append(o)
    for _sid, cols in sorted(by_sheet.items()):
        inputs = cols[0]["inputs"] or {}
        their_ratio = inputs.get("scale_ratio")
        if not their_ratio or not grid:
            continue
        reg = register(grid, ratio, _grid(conn, str(cols[0]["build_run_id"])), float(their_ratio))
        if not reg.ok:
            continue
        pts = project_columns(
            [(float(o["page_x0"]), float(o["page_y0"])) for o in cols],
            float(their_ratio),
            reg,
            ratio,
        )
        for m in mine:
            if str(m["id"]) in found:
                continue
            p = (float(m["page_x0"]), float(m["page_y0"]))
            best = min(
                ((math.dist(p, q), str(o["id"])) for q, o in zip(pts, cols, strict=True)),
                default=None,
            )
            if best is not None and best[0] <= tol:
                found[str(m["id"])] = (best[1], "registered")
    for m in mine:
        hit = found.get(str(m["id"]))
        if hit is None:
            continue
        ev = dict(m["kind_evidence"] or {})
        ev.update(duplicate_of=hit[0], duplicate_rule=hit[1])
        conn.execute("UPDATE members SET kind_evidence = %s WHERE id = %s", (Jsonb(ev), m["id"]))
    return len(found)
