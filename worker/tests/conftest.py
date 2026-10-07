"""Pytest configuration for worker tests."""

import sys
from pathlib import Path

# Ensure worker root is in sys.path
worker_root = Path(__file__).resolve().parent.parent
if str(worker_root) not in sys.path:
    sys.path.insert(0, str(worker_root))
