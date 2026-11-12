"""Held-out page candidates for "profile from callout" (read-only; ids and counts only).

    cd worker && .venv/bin/python -m measure.profile_candidates [--min 20] [--json out]

A candidate page has a text layer with at least --min column-family profile labels (W, HSS, HP,
PIPE, S, M) in its text lines. Pages already used (fit / development / truth) are excluded, and a
project whose PDF hash equals a locked TEST job drawing is skipped (measure/jobs.py). Also says
whether the project's PDF is a drawing set with a past estimator takeoff (the loader's inventory
`match`): the takeoff has not been opened. Nothing is written to the database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent
sys.path.insert(0, str(WORKER))

COLUMN_FAMILIES = ("W", "HSS", "HP", "PIPE", "S", "M")


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--min", type=int, default=20)
    ap.add_argument("--exclude", default="", help="comma list of sheet id prefixes already used")
    ap.add_argument("--json")
    a = ap.parse_args()
    import psycopg
    import pymupdf
    from dotenv import load_dotenv
    from psycopg.rows import dict_row

    from measure.jobs import MARKUPS, test_jobs
    from measure.takeoff.common import drawing_documents, takeoff_inventory
    from src.build.segments import page_text_lines
    from src.text_layer.parsers.profile import find_profiles

    load_dotenv(ROOT / ".env")
    conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    locked_sha = {sha(p) for p in MARKUPS.glob("job-*.pdf") if p.stem in test_jobs().jobs}
    inv = takeoff_inventory()  # the loader: DEV jobs only (measure/jobs.py lock)
    takeoff_jobs = {v.get("match") for v in inv.values() if v.get("match")}
    # dev job drawing documents by hash -> job id (kept ones; locked jobs are not in the list)

    job_of = {sha(p): j for j, p in drawing_documents().items()}
    excl = [x for x in a.exclude.split(",") if x]
    upload = ROOT / os.environ.get("UPLOAD_DIR", "uploads")
    files = conn.execute(
        "SELECT DISTINCT ON (f.sha256) f.project_id, f.stored_path, f.sha256 FROM project_files f"
        " ORDER BY f.sha256, f.created_at"
    ).fetchall()
    out = []
    locked_hits = 0
    for f in files:
        if f["sha256"] in locked_sha:
            locked_hits += 1
            continue
        path = upload / f["stored_path"]
        if not path.exists():
            continue
        job = job_of.get(f["sha256"])
        sheets = conn.execute(
            "SELECT id, page_index FROM sheets WHERE project_id = %s ORDER BY page_index",
            (f["project_id"],),
        ).fetchall()
        with pymupdf.open(path) as doc:
            for s in sheets:
                if any(str(s["id"]).startswith(x) for x in excl) or s["page_index"] >= len(doc):
                    continue
                lines = page_text_lines(doc[s["page_index"]])
                n = sum(
                    1
                    for t in lines
                    for p in find_profiles(t.text)[:1]
                    if p.family in COLUMN_FAMILIES
                )
                if n >= a.min:
                    out.append(
                        {
                            "project": str(f["project_id"])[:8],
                            "sheet": str(s["id"])[:8],
                            "page": s["page_index"] + 1,
                            "column_labels": n,
                            "text_lines": len(lines),
                            "dev_job_drawing": job is not None,
                            "past_takeoff": job in takeoff_jobs if job else False,
                        }
                    )
    out.sort(key=lambda r: -r["column_labels"])
    print(json.dumps({"locked_hash_hits": locked_hits, "candidates": out[:40]}, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
