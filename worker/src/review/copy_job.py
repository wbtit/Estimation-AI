"""The `copy_project` job: "Duplicate as demo" on the projects screen (migration 025).

Payload: {"project_id": "<uuid>", "name": "<new name>", "purpose": "demo"}. Runs
`src/review/copy_project.copy_project` with apply=True (one transaction; the source is only read)
and returns the new project's id and the counts copied. The person's request is logged by the API
(count_actions action 'project'); this job only copies. Logs counts only, never names.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from src.config import WorkerConfig
from src.queue import Job
from src.review.copy_project import copy_project

log = logging.getLogger("worker.copy_project")

JOB_TYPE = "copy_project"


def run_copy_project(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    p = job.payload
    out = copy_project(
        conn,
        config,
        str(p.get("project_id", "")),
        str(p.get("name", "")).strip(),
        apply=True,
        purpose=str(p.get("purpose") or "demo"),
    )
    log.info("copy_project: %s sheets copied", out["copied"].get("sheets"))
    return {"project_id": out["project_id"], "copied": out["copied"]}
