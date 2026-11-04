"""Pre-registration hashes: docs/ is local only, so the SHA-256 of a pre-registration document is
committed in worker/prereg/<NAME>.sha256 before any run, and every run verifies it.

  PYTHONPATH=. .venv/bin/python -m measure.prereg write <doc> <hash file>   # once, before the run
  PYTHONPATH=. .venv/bin/python -m measure.prereg verify <doc> <hash file>
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def digest(doc: Path) -> str:
    return hashlib.sha256(doc.read_bytes()).hexdigest()


def write(doc: Path, hash_file: Path) -> str:
    h = digest(doc)
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    hash_file.write_text(f"{h}  {doc.name}\n")
    return h


def verify(doc: Path, hash_file: Path) -> str:
    """The hash when the document matches the committed one; else the run stops."""
    if not doc.is_file():
        raise SystemExit(f"pre-registration {doc} is missing; the run stops")
    if not hash_file.is_file():
        raise SystemExit(f"hash file {hash_file} is missing; the run stops")
    want = hash_file.read_text().split()[0]
    got = digest(doc)
    if got != want:
        raise SystemExit(f"pre-registration {doc.name} changed (sha256 {got[:12]} != {want[:12]})")
    return got


if __name__ == "__main__":
    cmd, doc, hf = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    print((write if cmd == "write" else verify)(doc, hf))
