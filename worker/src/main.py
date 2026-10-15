"""Explicit entry point for the Python worker: `python -m src.main` (or `make worker`)."""

import logging
import signal
import time
from collections.abc import Callable
from typing import Any

import psycopg

from src.build.job import JOB_TYPE as BUILD_SHEET
from src.build.job import run_build_sheet
from src.config import WorkerConfig, load_config
from src.db import connect
from src.pdf_scan.job import JOB_TYPE as SCAN_PDF
from src.pdf_scan.job import run_scan_pdf
from src.queue import Job, claim_next_job, complete_job, fail_expired_jobs, fail_job
from src.review.auto_run import JOB_TYPE as AUTO_RUN
from src.review.auto_run import run_auto_run
from src.review.classes_job import JOB_TYPE as CLASSES_VIEW
from src.review.classes_job import run_classes_view
from src.review.link_job import JOB_TYPE as LINK_VIEW
from src.review.link_job import run_link_view
from src.review.sheet_lines_job import JOB_TYPE as SHEET_LINES
from src.review.sheet_lines_job import run_sheet_lines
from src.text_reader.job import JOB_TYPE as READ_TEXT
from src.text_reader.job import run_read_text

log = logging.getLogger("worker")

# Job type -> handler(connection, job, config) -> result stored on the job.
Handler = Callable[[psycopg.Connection, Job, WorkerConfig], dict[str, Any]]
HANDLERS: dict[str, Handler] = {
    SCAN_PDF: run_scan_pdf,
    READ_TEXT: run_read_text,
    LINK_VIEW: run_link_view,
    CLASSES_VIEW: run_classes_view,
    AUTO_RUN: run_auto_run,
    SHEET_LINES: run_sheet_lines,
    BUILD_SHEET: run_build_sheet,
}


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

    # Only claim types this worker can handle, so it never takes jobs meant for others.
    types = sorted(HANDLERS)
    log.info("started as %s, handling types: %s", config.worker_id, types or "none")
    if not types:
        log.info("no handlers registered; the worker will idle")

    while not stopping:
        try:
            with connect(config.database_url) as conn:
                while not stopping:
                    fail_expired_jobs(conn, config.lock_timeout_seconds)
                    job = (
                        claim_next_job(conn, config.worker_id, config.lock_timeout_seconds, types)
                        if types
                        else None
                    )
                    if job is None:
                        time.sleep(config.poll_interval_seconds)
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
