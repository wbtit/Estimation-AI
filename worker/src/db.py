"""Database connection helper."""

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    """Open a connection that returns rows as dicts."""
    return psycopg.connect(database_url, row_factory=dict_row)
