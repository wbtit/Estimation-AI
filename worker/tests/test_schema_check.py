"""Startup schema check (pure parts, and against the test database)."""

from pathlib import Path

import pytest

from src.config import load_config
from src.db import connect
from src.schema_check import (
    assert_schema_current,
    migration_files,
    missing_from,
    missing_migrations,
    schema_message,
)


def test_message_names_the_missing_migrations_and_the_command():
    assert schema_message(["032_perimeter_angle.sql"]) == (
        "migration 032 missing: run npm run migrate"
    )
    assert schema_message(["032_a.sql", "033_b.sql"]) == (
        "migrations 032, 033 missing: run npm run migrate"
    )


def test_missing_is_the_files_without_a_row_and_a_database_ahead_is_fine():
    files = ["030_a.sql", "031_b.sql", "032_c.sql"]
    assert missing_from(files, ["030_a.sql"]) == ["031_b.sql", "032_c.sql"]
    assert missing_from(files, [*files, "099_future.sql"]) == []


def test_reads_only_numbered_sql_files(tmp_path: Path):
    for name in ("002_b.sql", "001_a.sql", "README.md", "x.sql"):
        (tmp_path / name).write_text("")
    assert migration_files(tmp_path) == ["001_a.sql", "002_b.sql"]
    assert migration_files(tmp_path / "nope") == []


def test_the_test_database_is_current_and_a_newer_file_is_refused(tmp_path: Path):
    with connect(load_config().database_url) as conn:
        assert missing_migrations(conn) == []
        assert_schema_current(conn)
        (tmp_path / "999_not_applied.sql").write_text("")
        with pytest.raises(RuntimeError, match="migration 999 missing: run npm run migrate"):
            assert_schema_current(conn, tmp_path)
