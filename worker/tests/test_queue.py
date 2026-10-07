"""Queue tests against the real Postgres from docker compose (run `make up` and `make migrate`).

Each test uses its own job type so it never touches other rows in the jobs table.
"""

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

from src.config import load_config
from src.db import connect
from src.queue import claim_next_job, complete_job, fail_job

WORKER_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def database_url() -> str:
    return load_config().database_url


@pytest.fixture
def job_type(database_url: str) -> Iterator[str]:
    jt = f"test-{uuid.uuid4()}"
    yield jt
    with connect(database_url) as conn:
        conn.execute("DELETE FROM jobs WHERE type = %s", (jt,))


def insert_job(database_url: str, job_type: str, max_attempts: int = 3) -> str:
    with connect(database_url) as conn:
        row = conn.execute(
            "INSERT INTO jobs (type, payload, max_attempts) VALUES (%s, %s, %s) RETURNING id",
            (job_type, '{"job": "job-001"}', max_attempts),
        ).fetchone()
    return str(row["id"])


def test_importing_modules_starts_nothing() -> None:
    """Importing the queue and entry-point modules must not start a worker or connect."""
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    proc = subprocess.run(
        [sys.executable, "-c", "import src.queue, src.main; print('imported')"],
        cwd=WORKER_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "imported"


def test_claim_complete(database_url: str, job_type: str) -> None:
    job_id = insert_job(database_url, job_type)
    with connect(database_url) as conn:
        job = claim_next_job(conn, "worker-a", 600, [job_type])
        assert job is not None
        assert (job.id, job.attempts, job.payload) == (job_id, 1, {"job": "job-001"})
        assert claim_next_job(conn, "worker-a", 600, [job_type]) is None

        complete_job(conn, job.id, {"ok": True})
        row = conn.execute(
            "SELECT status, result, locked_by FROM jobs WHERE id = %s", (job_id,)
        ).fetchone()
    assert (row["status"], row["result"], row["locked_by"]) == ("completed", {"ok": True}, None)


def test_skip_locked_lets_concurrent_workers_take_different_jobs(
    database_url: str, job_type: str
) -> None:
    first, second = insert_job(database_url, job_type), insert_job(database_url, job_type)
    with connect(database_url) as conn_a, connect(database_url) as conn_b:
        # Worker A holds a row lock on the oldest job inside an open transaction.
        conn_a.execute("SELECT id FROM jobs WHERE id = %s FOR UPDATE", (first,))
        # Worker B must skip it instead of blocking, and claim the next one.
        job_b = claim_next_job(conn_b, "worker-b", 600, [job_type])
        conn_a.rollback()
    assert job_b is not None and job_b.id == second


def test_failed_job_is_retried_until_max_attempts(database_url: str, job_type: str) -> None:
    job_id = insert_job(database_url, job_type, max_attempts=2)
    with connect(database_url) as conn:
        for attempt in (1, 2):
            job = claim_next_job(conn, "worker-a", 600, [job_type])
            assert job is not None and job.attempts == attempt
            fail_job(conn, job.id, f"boom {attempt}")
        row = conn.execute(
            "SELECT status, attempts, error FROM jobs WHERE id = %s", (job_id,)
        ).fetchone()
        assert claim_next_job(conn, "worker-a", 600, [job_type]) is None
    assert (row["status"], row["attempts"], row["error"]) == ("failed", 2, "boom 2")


def test_expired_lock_is_reclaimed(database_url: str, job_type: str) -> None:
    job_id = insert_job(database_url, job_type)
    with connect(database_url) as conn:
        assert claim_next_job(conn, "worker-dead", 600, [job_type]) is not None
        conn.execute(
            "UPDATE jobs SET locked_at = NOW() - interval '1 hour' WHERE id = %s", (job_id,)
        )
        conn.commit()
        job = claim_next_job(conn, "worker-b", 600, [job_type])
    assert job is not None and job.id == job_id and job.attempts == 2
