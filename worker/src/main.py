"""Explicit entry point for the Python worker: `python -m src.main` (or `make worker`)."""

import logging
import signal
import time
from collections.abc import Callable
from typing import Any

import psycopg

from src.build.auto import JOB_TYPE as AUTO_BUILD
from src.build.auto import run_auto_build
from src.build.job import JOB_TYPE as BUILD_SHEET
from src.build.job import run_build_sheet
from src.build.learn_style_job import JOB_TYPE as LEARN_STYLE
from src.build.learn_style_job import run_learn_style
from src.build.read_labels_job import JOB_TYPE as READ_LABELS
from src.build.read_labels_job import run_read_labels
from src.build.similar_job import JOB_TYPE as FIND_SIMILAR
from src.build.similar_job import run_find_similar
from src.config import WorkerConfig, load_config
from src.db import connect
from src.pdf_scan.job import JOB_TYPE as SCAN_PDF
from src.pdf_scan.job import run_scan_pdf
from src.queue import Job, claim_next_job, complete_job, fail_expired_jobs, fail_job
from src.review.auto_run import JOB_TYPE as AUTO_RUN
from src.review.auto_run import run_auto_run
from src.review.copy_job import JOB_TYPE as COPY_PROJECT
from src.review.copy_job import run_copy_project
from src.review.sheet_lines_job import JOB_TYPE as SHEET_LINES
from src.review.sheet_lines_job import run_sheet_lines
from src.schema_check import assert_schema_current

log = logging.getLogger("worker")

# Job type -> handler(connection, job, config) -> result stored on the job.
Handler = Callable[[psycopg.Connection, Job, WorkerConfig], dict[str, Any]]
HANDLERS: dict[str, Handler] = {
    SCAN_PDF: run_scan_pdf,
    AUTO_RUN: run_auto_run,
    SHEET_LINES: run_sheet_lines,
    BUILD_SHEET: run_build_sheet,
    AUTO_BUILD: run_auto_build,
    FIND_SIMILAR: run_find_similar,
    LEARN_STYLE: run_learn_style,
    READ_LABELS: run_read_labels,
    COPY_PROJECT: run_copy_project,
}


JOBS_CHANNEL = "jobs"


def wait_for_notify(conn: psycopg.Connection, timeout: float) -> bool:
    """Sleep until a notification on JOBS_CHANNEL arrives or `timeout` passes; True if one came."""
    return any(True for _ in conn.notifies(timeout=timeout, stop_after=1))


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_config()
    stopping = False

    def stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        log.info("signal %s received, stopping after current job", signum)
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    # Refuse to run newer code on an older database (migration files vs schema_migrations). A
    # database that cannot be reached yet is left to the retry loop below.
    try:
        with connect(config.database_url) as check_conn:
            assert_schema_current(check_conn)
    except RuntimeError as err:
        log.error("the database schema is out of date: %s", err)
        raise SystemExit(f"the database schema is out of date: {err}") from err
    except Exception:
        log.warning("could not check the database schema; will retry in the job loop")

    # Only claim types this worker can handle, so it never takes jobs meant for others.
    types = sorted(HANDLERS)
    log.info("started as %s, handling types: %s", config.worker_id, types or "none")
    if not types:
        log.info("no handlers registered; the worker will idle")

    while not stopping:
        try:
            with connect(config.database_url) as conn:
                # Phase 14e: the API notifies on JOBS_CHANNEL when it queues a job a person waits
                # for (Find similar); the idle wait wakes at once instead of after the poll
                conn.execute(f"LISTEN {JOBS_CHANNEL}")
                conn.commit()
                while not stopping:
                    fail_expired_jobs(conn, config.lock_timeout_seconds)
                    job = (
                        claim_next_job(conn, config.worker_id, config.lock_timeout_seconds, types)
                        if types
                        else None
                    )
                    if job is None:
                        wait_for_notify(conn, config.poll_interval_seconds)
                        continue
                    try:
                        complete_job(conn, job.id, HANDLERS[job.type](conn, job, config))
                        log.info("job %s (%s) completed", job.id, job.type)
                    except Exception as err:  # any handler failure is recorded
                        log.exception("job %s (%s) failed", job.id, job.type)
                        fail_job(conn, job.id, str(err))
        except Exception:  # keep polling across DB outages
            log.exception("database error; retrying in %ss", config.poll_interval_seconds)
            time.sleep(config.poll_interval_seconds)

    log.info("worker stopped")


if __name__ == "__main__":
    run()
