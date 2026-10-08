"""The `classes_view` job: tabulate the stroke classes inside one view and suggest the member class.

Payload: {"view_id": "<uuid>"}. It writes `class_table` (every class with its line count and length)
and, only when a person has NOT confirmed the classes yet, the suggested class into
`structural_classes`. It never touches a confirmed choice. The link job refuses to run until a
person has confirmed the classes, so this job is what the person looks at first. Logs counts only.
"""

import logging
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.queue import Job

log = logging.getLogger("worker.classes")

JOB_TYPE = "classes_view"


class ClassesError(Exception):
    """A failure with a message that is safe to store (no page text)."""


def run_classes_view(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    return classes_view(conn, config, str(job.payload.get("view_id", "")))


def classes_view(conn: psycopg.Connection, config: WorkerConfig, view_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT v.*, s.page_index, f.stored_path"
        " FROM sheet_views v JOIN sheets s ON s.id = v.sheet_id"
        " JOIN project_files f ON f.project_id = s.project_id WHERE v.id = %s",
        (view_id,),
    ).fetchone()
    if row is None:
        raise ClassesError("view not found")
    box_json = row["box"]
    box = (
        float(box_json["x0"]),
        float(box_json["y0"]),
        float(box_json["x1"]),
        float(box_json["y1"]),
    )
    pdf_path = config.upload_dir / row["stored_path"]
    if not pdf_path.is_file():
        raise ClassesError("stored PDF is missing")
    with pymupdf.open(pdf_path) as doc:
        page = doc[row["page_index"]]
        in_view = lines_in_box(page_lines(page), box, (page.rect.width, page.rect.height))
        table = class_table(in_view)
    suggestion = suggest_classes(table)
    conn.execute(
        "UPDATE sheet_views SET class_table = %s WHERE id = %s",
        (
            Jsonb(
                [
                    {"key": c.key, "lines": c.lines, "length_pt": round(c.length_pt, 1)}
                    for c in table
                ]
            ),
            view_id,
        ),
    )
    if not row["classes_confirmed"]:
        conn.execute(
            "UPDATE sheet_views SET structural_classes = %s WHERE id = %s", (suggestion, view_id)
        )
    log.info("classes of a view: %s classes, suggestion %s", len(table), len(suggestion))
    return {
        "classes": len(table),
        "suggested": len(suggestion),
        "confirmed": bool(row["classes_confirmed"]),
    }
