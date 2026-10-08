"""Database connection helper."""

import os
from urllib.parse import unquote, urlparse

import psycopg
from psycopg.rows import dict_row


def database_name(database_url: str) -> str:
    return unquote(urlparse(database_url).path.lstrip("/"))


def connect(database_url: str) -> psycopg.Connection:
    """Open a connection that returns rows as dicts.

    Under pytest only a database whose name ends with "_test" may be opened, so tests can never
    touch the real database (the message never contains the URL or password).
    """
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("PYTEST_VERSION"):
        name = database_name(database_url)
        if not name.endswith("_test"):
            raise RuntimeError(
                f'refusing to run tests against database "{name}": a test database name must '
                'end with "_test" (run `make test-db`; the test setup derives the URL).'
            )
    return psycopg.connect(database_url, row_factory=dict_row)
