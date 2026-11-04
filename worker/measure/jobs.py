"""The locked held-out TEST jobs (Phase 12e) and the explicit opt-in to read them.

The lock is fixtures/private/markups/heldout_test.lock: job ids with their drawing and markup
(`takeoffs/takeoff-NN.pdf`). Every shared loader (measure/takeoff/common.py) returns DEV jobs only;
a locked job is returned only with `include_test=True`, which a command line gives only through
`--include-test --prereg <path of the pre-registration document>` (and then a warning is printed).
No tuning, threshold choice or rule change may look at the detection results of a locked job.
(The Phase 7 lock, takeoffs/phase7_heldout.lock, freezes the Phase 7 grammar code, not a job list.)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MARKUPS = ROOT / "fixtures" / "private" / "markups"
LOCK = MARKUPS / "heldout_test.lock"
MAPPING = MARKUPS / "MAPPING.json"


@dataclass(frozen=True)
class Locked:
    jobs: frozenset[str]
    takeoffs: frozenset[str]  # markup file names, e.g. takeoff-23.pdf


def test_jobs() -> Locked:
    """The locked jobs. No lock and no intake: none. An intake without its lock: stop."""
    if not LOCK.exists():
        if MAPPING.exists():
            raise SystemExit(f"{LOCK} is missing but an intake exists; refusing to guess the set")
        return Locked(frozenset(), frozenset())
    jobs = json.loads(LOCK.read_text())["jobs"]
    return Locked(
        frozenset(jobs),
        frozenset(Path(v["markup"]).name for v in jobs.values() if v.get("markup")),
    )


def is_locked(name: str, locked: Locked | None = None) -> bool:
    """A job id or a takeoff file name of the locked set."""
    lk = locked or test_jobs()
    return name in lk.jobs or Path(name).name in lk.takeoffs


def dev_jobs(names) -> list:
    """`names` without the locked jobs and takeoffs (keeps the order)."""
    lk = test_jobs()
    return [n for n in names if not is_locked(str(n), lk)]


def include_test_from_argv(argv: list[str]) -> bool:
    """True only for `--include-test --prereg <existing file>`; then a loud warning on stderr.
    `--include-test` without a readable pre-registration stops the run."""
    if "--include-test" not in argv:
        return False
    try:
        prereg = Path(argv[argv.index("--prereg") + 1])
    except (ValueError, IndexError):
        raise SystemExit(
            "--include-test needs --prereg <path of the pre-registration document>"
        ) from None
    if not prereg.is_file():
        raise SystemExit(f"--prereg {prereg}: no such file; the locked TEST jobs stay out")
    lk = test_jobs()
    bar = "!" * 78
    print(
        f"{bar}\n!! LOCKED HELD-OUT TEST JOBS INCLUDED ({len(lk.jobs)}):"
        f" {', '.join(sorted(lk.jobs))}\n"
        f"!! pre-registration: {prereg}\n"
        "!! Report only the pre-registered measures. No tuning, threshold choice or rule change\n"
        f"!! may look at these results.\n{bar}",
        file=sys.stderr,
    )
    return True


def strip_test_flags(argv: list[str]) -> list[str]:
    """`argv` without --include-test and --prereg <path> (for tools that read job ids from argv)."""
    out, skip = [], False
    for a in argv:
        if skip:
            skip = False
        elif a == "--prereg":
            skip = True
        elif a != "--include-test":
            out.append(a)
    return out
