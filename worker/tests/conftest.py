"""Pytest configuration for worker tests."""

import sys
from pathlib import Path

# Ensure worker root is in sys.path
worker_root = Path(__file__).resolve().parent.parent
if str(worker_root) not in sys.path:
    sys.path.insert(0, str(worker_root))

import os  # noqa: E402
from urllib.parse import urlparse, urlunparse  # noqa: E402

from dotenv import dotenv_values  # noqa: E402

# Tests use a SEPARATE database: DATABASE_URL is replaced by the derived test URL (database name
# + "_test", or TEST_DATABASE_URL) before any test module loads the config. `make test-db`
# creates and migrates it. The real database is never opened by a test.
_env = {**dotenv_values(worker_root.parent / ".env"), **os.environ}
_real = _env.get("DATABASE_URL")
if _real:
    _explicit = _env.get("TEST_DATABASE_URL")
    if _explicit:
        _test = _explicit
    else:
        _parts = urlparse(_real)
        _name = _parts.path.lstrip("/")
        _test = (
            _real if _name.endswith("_test") else urlunparse(_parts._replace(path=f"/{_name}_test"))
        )
    if not urlparse(_test).path.lstrip("/").endswith("_test"):
        raise RuntimeError('TEST_DATABASE_URL must name a database ending with "_test"')
    os.environ["DATABASE_URL"] = _test

from db_fixtures import dbp  # noqa: E402,F401  (fixture shared by the database tests)
