"""Tests never touch the real database (see conftest.py and src/db.py)."""

import os
from urllib.parse import urlparse

import pytest

from src.config import load_config
from src.db import connect, database_name

REAL = "postgresql://someone@localhost:5432/estimation_ai"  # no password (secret scanner)


def test_the_configured_database_is_the_test_database() -> None:
    assert database_name(load_config().database_url).endswith("_test")
    assert urlparse(os.environ["DATABASE_URL"]).path.lstrip("/").endswith("_test")


def test_a_connection_reports_the_test_database() -> None:
    with connect(load_config().database_url) as conn:
        assert conn.execute("SELECT current_database() AS n").fetchone()["n"].endswith("_test")


def test_connecting_to_a_non_test_database_fails_loudly_without_leaking_the_url() -> None:
    with pytest.raises(RuntimeError) as err:
        connect(REAL)
    message = str(err.value)
    assert 'refusing to run tests against database "estimation_ai"' in message
    assert "someone" not in message and "postgresql://" not in message
