"""Review 4: learn the page beam style of a view from one picked beam (job type `learn_style`).

The API queues one job after a pen pick: {sheet_id, view_id, x, y, pen_class, mode}. The worker
parses the page, takes the pen's lines, and decides whether the clicked beam is a heavy single
line or a thin pair with a dashed centreline (src/build/double_line.learn_style). The result is
stored on the view (build_views.beam_style and friends) unless a person already set the style
(source 'person'): a person's choice is never replaced by a learned value. Mode "add" (a second
pen): the new pen's style is combined with the stored one ("both" when they differ). Read-only on
the drawing.
"""

from __future__ import annotations

import logging
from typing import Any

import pymupdf
from psycopg.types.json import Jsonb

from src.build.beam_lines import beam_lines
from src.build.clean import clean
from src.build.double_line import centrelines, learn_style
from src.build.segments import crop, page_text_lines, parse_page
from src.build.views import load_views, pick_view
from src.config import WorkerConfig
from src.queue import Job

JOB_TYPE = "learn_style"
log = logging.getLogger("worker.learn_style")


def run_learn_style(conn, job: Job, config: WorkerConfig) -> dict[str, Any]:
    payload = job.payload
    sheet_id, view_id = str(payload["sheet_id"]), str(payload["view_id"])
    pen_class = str(payload["pen_class"])
    click = (float(payload["x"]), float(payload["y"]))
    mode = str(payload.get("mode") or "replace")
    page = conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s JOIN project_files f"
        " ON f.project_id = s.project_id WHERE s.id = %s",
        (sheet_id,),
    ).fetchone()
    if page is None:
        raise RuntimeError("sheet not found")
    views = load_views(conn, sheet_id)
    view = pick_view(views, view_id)
    if view is None:
        raise RuntimeError("view not found")
    if view.row.get("beam_style_source") == "person":
        return {"kept": "a person set the beam style", "style": view.row.get("beam_style")}
    box = view.row["box"]
    ratio = view.row["scale_ratio"]
    with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
        pg = doc[page["page_index"]]
        w, h = float(page["width_pt"]), float(page["height_pt"])
        text = page_text_lines(pg)
        region = (
            (float(box["x0"]), float(box["y0"]), float(box["x1"]), float(box["y1"]))
            if box
            else (0.0, 0.0, w, h)
        )
        ps = crop(parse_page(pg), region)
    cleaned = clean(ps, [t for t in text if region[0] <= t.centre[0] <= region[2]])
    lines = beam_lines(ps, cleaned.keep, pen_class)
    learned = learn_style(
        lines, click, pen_class, None if ratio is None else float(ratio), centrelines(ps)
    )
    style, gmin, gmax, centre = (
        learned.style,
        learned.gap_min_pt,
        learned.gap_max_pt,
        learned.centreline_required,
    )
    old = view.row.get("beam_style")
    if mode == "add" and old in ("single", "double", "both") and old != style:
        style = "both"
        if old != "single":  # keep the stored double gap when the new pen adds nothing to it
            gmin, gmax = view.row.get("beam_gap_min_pt"), view.row.get("beam_gap_max_pt")
            centre = bool(view.row.get("beam_centreline_required", True))
    conn.execute(
        "UPDATE build_views SET beam_style = %s, beam_gap_min_pt = %s, beam_gap_max_pt = %s,"
        " beam_centreline_required = %s, beam_style_source = 'learned',"
        " beam_style_evidence = %s, beam_style_by = 'learn_style', beam_style_at = now(),"
        " setup_changed_at = now() WHERE id = %s",
        (style, gmin, gmax, centre, Jsonb({**learned.evidence, "pen_class": pen_class}), view_id),
    )
    conn.commit()
    log.info("learned beam style %s", style)
    return {"style": style, "reason": learned.evidence.get("reason")}


__all__ = ["JOB_TYPE", "run_learn_style"]
