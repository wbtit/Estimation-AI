"""Projects for the cover-details measurement (read-only; ids and counts only).

    cd worker && .venv/bin/python -m measure.details_candidates [--take 8] [--json out]

Eligible: a project whose PDF (deduped by hash: one project per PDF) is not a locked TEST job
drawing (measure/jobs.py, by PDF hash), is not the same drawing set as another one (cover text
overlap >= 0.9: one is kept), has at least 6 pages, and whose first page, or a page with the role
"Cover / Title page", has a text layer with at least 15 text lines. NOTHING about what the reader
would find is used to choose. The pick is every k-th eligible project in order of PDF hash.
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--take", type=int, default=8)
    ap.add_argument("--json")
    a = ap.parse_args()
    import psycopg
    import pymupdf
    from dotenv import load_dotenv
    from psycopg.rows import dict_row

    from measure.jobs import MARKUPS, test_jobs
    from src.pdf_scan.textlines import page_words_and_lines

    load_dotenv(ROOT / ".env")
    conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")

    def sha(p: Path) -> str:
        return hashlib.sha256(p.read_bytes()).hexdigest()

    locked = {sha(p) for p in MARKUPS.glob("job-*.pdf") if p.stem in test_jobs().jobs}
    upload = ROOT / os.environ.get("UPLOAD_DIR", "uploads")
    rows = conn.execute(
        "SELECT DISTINCT ON (f.sha256) f.sha256, f.project_id, f.stored_path, p.purpose,"
        " (SELECT count(*) FROM sheets s WHERE s.project_id = f.project_id) AS pages"
        " FROM project_files f JOIN projects p ON p.id = f.project_id"
        " ORDER BY f.sha256, (p.purpose = 'real') DESC, f.created_at"
    ).fetchall()
    eligible, skipped_locked = [], 0
    for r in rows:
        if r["sha256"] in locked:
            skipped_locked += 1
            continue
        path = upload / r["stored_path"]
        if r["pages"] < 6 or not path.exists():
            continue
        cover = [
            s["page_index"]
            for s in conn.execute(
                "SELECT s.page_index FROM sheets s JOIN build_views v ON v.sheet_id = s.id"
                " WHERE s.project_id = %s AND v.role_name = 'Cover / Title page'",
                (r["project_id"],),
            )
        ] or [0]
        with pymupdf.open(path) as doc:
            got = [page_words_and_lines(doc[i])[1] for i in cover if i < len(doc)]
        lines = max(len(g) for g in got)
        words = {w for g in got for ln in g for w in ln.text.upper().split()}
        if lines >= 15:
            eligible.append(
                {
                    "project": str(r["project_id"])[:8],
                    "project_id": str(r["project_id"]),
                    "sha8": r["sha256"][:8],
                    "pages": r["pages"],
                    "purpose": r["purpose"],
                    "cover_pages": cover,
                    "cover_text_lines": lines,
                    "_words": words,
                }
            )
    eligible.sort(key=lambda e: e["sha8"])
    # the same drawing set saved twice (different bytes): the cover text is (almost) the same
    unique: list[dict] = []
    dupes = 0
    for e in eligible:
        w = e["_words"]
        if any(len(w & u["_words"]) / max(1, len(w | u["_words"])) >= 0.9 for u in unique):
            dupes += 1
            continue
        unique.append(e)
    eligible = unique
    real = [e for e in eligible if e["purpose"] == "real"]
    pool = real if len(real) >= a.take else eligible
    step = max(1, len(pool) // a.take)
    picked = pool[::step][: a.take]
    shown = [{k: v for k, v in e.items() if k not in ("project_id", "_words")} for e in picked]
    summary = {
        "locked_hash_hits": skipped_locked,
        "content_duplicates_dropped": dupes,
        "eligible": len(eligible),
        "eligible_real": len(real),
        "picked": shown,
    }
    print(json.dumps(summary, indent=1))
    if a.json:
        Path(a.json).write_text(
            json.dumps([{k: v for k, v in e.items() if k != "_words"} for e in picked], indent=1)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
