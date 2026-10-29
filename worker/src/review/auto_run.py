"""The `auto_run` job: the whole pipeline for a project, end to end, with best guesses (Phase 6a).

Payload: {"project_id": "<uuid>", "document_id": "<uuid>"}. After the scan it
  1. reads the text of every vector sheet (text items, schedule and legend rows),
  2. for every sheet that is in the takeoff (a person's decision, else the page type default) and is
     a vector page: makes a whole-sheet view if the sheet has none (marked `auto_created`), guesses
     the view's scale (the sheet's most frequent printed scale, left UNCONFIRMED; none = "scale
     needed"), suggests the line classes (left UNCONFIRMED) and runs the frozen linking rule.
Everything a person did is kept: a view that exists is not replaced, a confirmed scale or class is
not touched, and the link job never changes a member a person has touched. Every guess is a flag
the screen derives from the unconfirmed state. Last it queues `auto_build` (Phase 11b auto mode)
unless one is queued or already done. Logs counts only, never page text.
"""

import logging
from collections import Counter
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.queue import Job
from src.review.classes_job import classes_view
from src.review.link_job import link_view
from src.review.sheet_state import sheet_included
from src.text_reader.job import read_project

log = logging.getLogger("worker.autorun")

JOB_TYPE = "auto_run"
BORDER_FRACTION = 0.025  # the same fixed margin and title strip as the API's whole-sheet view
TITLE_STRIP_FRACTION = 0.14


def whole_sheet_box(width: float, height: float) -> dict[str, float]:
    return {
        "x0": round(width * BORDER_FRACTION, 2),
        "y0": round(height * BORDER_FRACTION, 2),
        "x1": round(width * (1 - TITLE_STRIP_FRACTION), 2),
        "y1": round(height * (1 - BORDER_FRACTION), 2),
    }


def most_frequent_scale(scales: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The printed scale with the highest count (ties: the first listed); needs a ratio."""
    best: dict[str, Any] | None = None
    for s in scales or []:
        ratio = s.get("ratio")
        if s.get("kind") != "ratio" or not isinstance(ratio, int | float) or ratio <= 0:
            continue
        if best is None or int(s.get("count") or 1) > int(best.get("count") or 1):
            best = s
    return best


def run_auto_run(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    project_id = str(job.payload.get("project_id", ""))
    document_id = str(job.payload.get("document_id", ""))
    # session preparation: the label-first linking (members from labels, Phase 6a) runs only when
    # the job asks for it; a new upload reads the text and builds nothing
    return auto_run(
        conn, config, project_id, document_id, bool(job.payload.get("link_labels", False))
    )


def auto_run(
    conn: psycopg.Connection,
    config: WorkerConfig,
    project_id: str,
    document_id: str,
    link_labels: bool = False,
) -> dict[str, Any]:
    totals: Counter = Counter()
    read_project(conn, config, project_id, document_id, config.glyph_font_id)
    conn.commit()
    sheets = conn.execute(
        "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (project_id,)
    ).fetchall()
    for sheet in sheets:
        totals["sheets"] += 1
        if sheet["page_kind"] != "vector":
            totals["sheets_not_vector"] += 1
            continue
        if not sheet_included(conn, sheet):
            totals["sheets_out_of_takeoff"] += 1
            continue
        totals["sheets_in_takeoff"] += 1
        views = conn.execute(
            "SELECT * FROM sheet_views WHERE sheet_id = %s ORDER BY created_at", (sheet["id"],)
        ).fetchall()
        if not views and sheet["width_pt"] and sheet["height_pt"]:
            box = whole_sheet_box(float(sheet["width_pt"]), float(sheet["height_pt"]))
            row = conn.execute(
                "INSERT INTO sheet_views (sheet_id, name, box, created_by, auto_created)"
                " VALUES (%s, 'whole sheet', %s, 'system', TRUE) RETURNING *",
                (sheet["id"], Jsonb(box)),
            ).fetchone()
            conn.commit()
            views = [row]
            totals["views_created"] += 1
        for view in views:
            view_id = str(view["id"])
            if not view["scale_confirmed"] and view["scale_ratio"] is None:
                guess = most_frequent_scale(sheet["scales"])
                if guess is not None:
                    conn.execute(
                        "UPDATE sheet_views SET scale_ratio = %s, scale_text = %s,"
                        " scale_source = 'detected_text', scale_confirmed = FALSE WHERE id = %s",
                        (guess["ratio"], guess["raw"], view_id),
                    )
                    conn.commit()
                    totals["scales_guessed"] += 1
                else:
                    totals["scale_needed"] += 1
            classes_view(conn, config, view_id)
            conn.commit()
            if not link_labels:  # no members from labels: pieces come only from a person's Build
                totals["views_not_linked"] += 1
                continue
            try:
                result = link_view(conn, config, view_id)
            except Exception as err:  # one view must not stop the others
                log.warning("auto link failed for a view: %s", type(err).__name__)
                conn.rollback()
                totals["views_failed"] += 1
                continue
            totals["views_linked"] += 1
            totals["members_created"] += int(result.get("created", 0))
            totals["members_updated"] += int(result.get("updated", 0))
            totals["members_kept"] += int(result.get("kept_reviewed", 0))
    # Phase 11b: auto mode (the line-first build with system values) follows the pipeline
    queued = conn.execute(
        "SELECT 1 FROM jobs WHERE type = 'auto_build' AND status IN ('pending', 'processing')"
        " AND payload->>'project_id' = %s UNION ALL SELECT 1 FROM auto_builds"
        " WHERE project_id = %s AND status = 'done' LIMIT 1",
        (project_id, project_id),
    ).fetchone()
    if queued is None:
        conn.execute(
            "INSERT INTO jobs (type, payload) VALUES ('auto_build', %s)",
            (Jsonb({"project_id": project_id}),),
        )
        conn.commit()
        totals["auto_build_queued"] += 1
    log.info("auto run: %s", dict(totals))
    return {k: int(v) for k, v in sorted(totals.items())}
