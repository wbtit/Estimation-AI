"""Startup check of the database schema version (Review 3, item 7).

The migration files of this checkout (db/migrations) against the rows of schema_migrations. A worker
that runs newer code on an older database refuses to start with a clear message, instead of failing
jobs later with "UndefinedColumn". Read only. A database AHEAD of the code (a row with no file) is
not an error.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

import psycopg

# worker/src/schema_check.py -> repo root / db / migrations
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"
_FILE = re.compile(r"^\d{3}_.+\.sql$")


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[str]:
    if not directory.is_dir():
        return []
    return sorted(p.name for p in directory.iterdir() if _FILE.match(p.name))


def missing_from(files: Iterable[str], applied: Iterable[str]) -> list[str]:
    done = set(applied)
    return [f for f in files if f not in done]


def schema_message(missing: list[str]) -> str:
    nums = [f[:3] for f in missing]
    plural = "" if len(nums) == 1 else "s"
    return f"migration{plural} {', '.join(nums)} missing: run npm run migrate"


def missing_migrations(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    files = migration_files(directory)
    try:
        applied = [r["version"] for r in conn.execute("SELECT version FROM schema_migrations")]
    except psycopg.errors.UndefinedTable:
        conn.rollback()
        applied = []
    return missing_from(files, applied)


def assert_schema_current(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> None:
    """Raise RuntimeError with the clear message when the database lacks a migration."""
    missing = missing_migrations(conn, directory)
    if missing:
        raise RuntimeError(schema_message(missing))
