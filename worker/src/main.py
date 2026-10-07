"""Explicit entry point for the Python worker: `python -m src.main` (or `make worker`)."""

import logging
import signal
import time
from collections.abc import Callable
from typing import Any

from src.config import load_config
from src.db import connect
from src.queue import Job, claim_next_job, complete_job, fail_expired_jobs, fail_job

log = logging.getLogger("worker")

# Job type -> handler. Empty in Phase 0; extraction handlers are added in later phases.
Handler = Callable[[Job], dict[str, Any]]
HANDLERS: dict[str, Handler] = {}


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
        log.info("no handlers registered in Phase 0; the worker will idle")

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
                        complete_job(conn, job.id, HANDLERS[job.type](job))
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
