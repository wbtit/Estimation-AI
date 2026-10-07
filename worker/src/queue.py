"""Postgres-backed job queue (the `jobs` table) using FOR UPDATE SKIP LOCKED.

Importing this module has no side effects. The polling loop lives in src.main and runs
only when that module is executed explicitly.
"""

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb


@dataclass(frozen=True)
class Job:
    id: str
    type: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int


# Claims the oldest pending job, or a processing job whose lock has expired (its worker
# died), in a single statement. SKIP LOCKED lets concurrent workers pass over rows that
# another worker is claiming at the same moment.
_CLAIM_SQL = """
UPDATE jobs
SET status = 'processing',
    locked_at = NOW(),
    locked_by = %(worker_id)s,
    attempts = attempts + 1
WHERE id = (
    SELECT id FROM jobs
    WHERE attempts < max_attempts
      AND (status = 'pending'
           OR (status = 'processing'
               AND locked_at < NOW() - make_interval(secs => %(lock_timeout)s)))
      AND (%(types)s::text[] IS NULL OR type = ANY(%(types)s::text[]))
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, type, payload, attempts, max_attempts
"""


def claim_next_job(
    conn: psycopg.Connection,
    worker_id: str,
    lock_timeout_seconds: float,
    types: list[str] | None = None,
) -> Job | None:
    """Claim one job and commit the claim. Returns None when nothing is claimable."""
    with conn.cursor() as cur:
        cur.execute(
            _CLAIM_SQL,
            {"worker_id": worker_id, "lock_timeout": lock_timeout_seconds, "types": types},
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return None
    return Job(
        id=str(row["id"]),
        type=row["type"],
        payload=row["payload"] or {},
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
    )


def complete_job(conn: psycopg.Connection, job_id: str, result: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET status = 'completed', result = %s, error = NULL, locked_at = NULL, locked_by = NULL
            WHERE id = %s
            """,
            (Jsonb(result), job_id),
        )
    conn.commit()


def fail_job(conn: psycopg.Connection, job_id: str, error: str) -> None:
    """Record the error. The job returns to pending until it runs out of attempts."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
                error = %s, locked_at = NULL, locked_by = NULL
            WHERE id = %s
            """,
            (error, job_id),
        )
    conn.commit()


def fail_expired_jobs(conn: psycopg.Connection, lock_timeout_seconds: float) -> int:
    """Mark jobs failed whose lock expired after their last allowed attempt."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET status = 'failed', error = 'lock expired on final attempt',
                locked_at = NULL, locked_by = NULL
            WHERE status = 'processing'
              AND attempts >= max_attempts
              AND locked_at < NOW() - make_interval(secs => %s)
            """,
            (lock_timeout_seconds,),
        )
        count = cur.rowcount
    conn.commit()
    return count
