"""The `auto_run` job: after the scan, read the text of every vector page, then queue auto mode.

Payload: {"project_id": "<uuid>", "document_id": "<uuid>"}. It
  1. reads the text of every vector sheet (text items, schedule and legend rows; the Build and the
     page names use them),
  2. queues `auto_build` (Phase 11b auto mode: suggested setup per page, nothing built) unless one
     is queued or already done.
The label-first part (a whole-sheet sheet_views row per page, its scale guess, its stroke classes
and the label linking) was removed in the cleanup: nothing on the live path read it. Logs counts
only, never page text.
"""

import logging
from collections import Counter
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.queue import Job
from src.text_reader.job import read_project

log = logging.getLogger("worker.autorun")

JOB_TYPE = "auto_run"
BORDER_FRACTION = 0.025  # the same fixed margin and title strip as the API's whole-sheet view
TITLE_STRIP_FRACTION = 0.14


def whole_sheet_box(width: float, height: float) -> dict[str, float]:
    """The API's whole-sheet box (kept for the TEST-set intake tool tools/takeoff/phase6c_trace)."""
    return {
        "x0": round(width * BORDER_FRACTION, 2),
        "y0": round(height * BORDER_FRACTION, 2),
        "x1": round(width * (1 - TITLE_STRIP_FRACTION), 2),
        "y1": round(height * (1 - BORDER_FRACTION), 2),
    }


def run_auto_run(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    project_id = str(job.payload.get("project_id", ""))
    document_id = str(job.payload.get("document_id", ""))
    return auto_run(conn, config, project_id, document_id)


def auto_run(
    conn: psycopg.Connection,
    config: WorkerConfig,
    project_id: str,
    document_id: str,
) -> dict[str, Any]:
    totals: Counter = Counter()
    read_project(conn, config, project_id, document_id, config.glyph_font_id)
    conn.commit()
    totals["sheets"] = conn.execute(
        "SELECT count(*) AS n FROM sheets WHERE project_id = %s", (project_id,)
    ).fetchone()["n"]
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
