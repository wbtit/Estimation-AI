"""The `sheet_lines` job: every extracted line of one sheet, of ANY class (the snap targets).

Payload: {"sheet_id": "<uuid>"}. It writes one row of `sheet_lines`: the class keys, the lines as
[x0, y0, x1, y1, class_index, width] in displayed page points, and a version hash of the lines (the
click evidence names the version, so it stays meaningful after a re-extraction). Lines shorter
than MIN_SNAP_PT are left out (they are drawn dots and tick marks). Logs counts only.
"""

import hashlib
import json
import logging
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.linking.lines import Line, page_lines
from src.queue import Job

log = logging.getLogger("worker.sheet_lines")

JOB_TYPE = "sheet_lines"
MIN_SNAP_PT = 3.0
MAX_LINES = 250_000


class SheetLinesError(Exception):
    """A failure with a message that is safe to store (no page text)."""


def lines_payload(lines: list[Line]) -> tuple[list[str], list[list[float]], str]:
    """(class keys, rows, version): deterministic, so the same page gives the same version."""
    kept = [ln for ln in lines if ln.length >= MIN_SNAP_PT]
    classes = sorted({ln.klass for ln in kept})
    index = {k: i for i, k in enumerate(classes)}
    rows = [
        [
            round(ln.x0, 2),
            round(ln.y0, 2),
            round(ln.x1, 2),
            round(ln.y1, 2),
            index[ln.klass],
            round(ln.width, 3),
        ]
        for ln in kept
    ]
    rows.sort(key=lambda r: (r[4], r[0], r[1], r[2], r[3]))
    rows = rows[:MAX_LINES]
    version = hashlib.sha1(json.dumps([classes, rows], separators=(",", ":")).encode()).hexdigest()[
        :16
    ]
    return classes, rows, version


def run_sheet_lines(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    return sheet_lines(conn, config, str(job.payload.get("sheet_id", "")))


def sheet_lines(conn: psycopg.Connection, config: WorkerConfig, sheet_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT s.page_index, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id WHERE s.id = %s",
        (sheet_id,),
    ).fetchone()
    if row is None:
        raise SheetLinesError("sheet not found")
    pdf_path = config.upload_dir / row["stored_path"]
    if not pdf_path.is_file():
        raise SheetLinesError("stored PDF is missing")
    with pymupdf.open(pdf_path) as doc:
        classes, rows, version = lines_payload(page_lines(doc[row["page_index"]]))
    conn.execute(
        "INSERT INTO sheet_lines (sheet_id, classes, lines, n_lines, version)"
        " VALUES (%s, %s, %s, %s, %s)"
        " ON CONFLICT (sheet_id) DO UPDATE SET classes = EXCLUDED.classes, lines = EXCLUDED.lines,"
        " n_lines = EXCLUDED.n_lines, version = EXCLUDED.version, created_at = now()",
        (sheet_id, Jsonb(classes), Jsonb(rows), len(rows), version),
    )
    log.info("sheet lines: %s lines, %s classes", len(rows), len(classes))
    return {"lines": len(rows), "classes": len(classes), "version": version}
