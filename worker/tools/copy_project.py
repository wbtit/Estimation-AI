"""Pilot preparation step 3: copy a project as a clean pilot project.

  PYTHONPATH=. .venv/bin/python -m tools.copy_project <job id or project id> <new name> [--apply]

Without --apply: a preview (what would be copied and what not, counts only; nothing written).
With --apply: the copy (one transaction), then the proof that the source is unchanged (its row
counts and a content hash of its members, sheets and member edits, before and after). Counts only.
"""

from __future__ import annotations

import json
import sys

from src.config import load_config
from src.db import connect
from src.review.copy_project import content_hash, copy_project, source_counts
from tools.takeoff.phase6c_trace import RUNS


def main(argv: list[str]) -> None:
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return
    runs = json.loads(RUNS.read_text())
    source = runs[args[0]]["project_id"] if args[0] in runs else args[0]
    config = load_config()
    conn = connect(config.database_url)
    before = source_counts(conn, source)
    h_before = content_hash(conn, source)
    out = copy_project(conn, config, source, args[1], apply="--apply" in argv)
    if out["applied"]:
        after = source_counts(conn, source)
        h_after = content_hash(conn, source)
        out["source_before"] = before
        out["source_after"] = after
        out["source_unchanged"] = before == after and h_before == h_after
        out["source_hash_equal"] = {k: h_before[k] == h_after[k] for k in h_before}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
