"""Phase 10 Part A2: sheet-number re-read with owner review (decision 123).

  PYTHONPATH=. .venv/bin/python -m tools.sheet_number_review           (preview: counts, CSV, crops)
  PYTHONPATH=. .venv/bin/python -m tools.sheet_number_review --apply   (job-018 + fill-ins)

Preview writes nothing to the database. It writes the git-ignored review file
fixtures/private/review/sheet_number_changes.csv (project id, page index, old, new, applied,
owner_ok left blank) for every page whose stored number would CHANGE, and a crop of each
page's title-block corner to fixtures/private/shots/phase10/titleblocks/. --apply re-reads
job-018's project in full (owner-approved) and, in every project, fills in pages that had no
number; a stored number is never overwritten elsewhere (the changed pages wait for owner_ok).
Counts only on stdout.
"""

from __future__ import annotations

import collections
import csv
import json
import sys

import pymupdf

from src.config import load_config
from src.db import connect
from src.pdf_scan.reread import reread_sheet_numbers
from tools.takeoff.common import PRIVATE
from tools.takeoff.phase6c_trace import RUNS

CSV = PRIVATE / "review" / "sheet_number_changes.csv"
CROPS = PRIVATE / "shots" / "phase10" / "titleblocks"
CORNER = (0.70, 0.70)


def crop(pdf, page_index: int, out) -> None:
    with pymupdf.open(pdf) as doc:
        page = doc[page_index]
        w, h = page.rect.width, page.rect.height
        shown = pymupdf.Rect(CORNER[0] * w, CORNER[1] * h, w, h)
        clip = shown * page.derotation_matrix
        clip.normalize()
        page.get_pixmap(clip=clip, dpi=110).save(out)


def main(argv: list[str]) -> None:
    apply = "--apply" in argv
    config = load_config()
    job018 = json.loads(RUNS.read_text())["job-018"]["project_id"]
    conn = connect(config.database_url)
    projects = conn.execute(
        "SELECT p.id, f.stored_path FROM projects p JOIN project_files f ON f.project_id = p.id"
        " ORDER BY p.created_at"
    ).fetchall()
    tot: collections.Counter = collections.Counter()
    rows = []
    for p in projects:
        pid = str(p["id"])
        pdf = config.upload_dir / p["stored_path"]
        if not pdf.is_file():
            tot["projects without their PDF"] += 1
            continue
        full = pid == job018
        r = reread_sheet_numbers(conn, config, pid, apply=apply, only_missing=apply and not full)
        tot["projects"] += 1
        tot["pages"] += r["sheets"]
        tot["unchanged"] += r["unchanged"]
        tot["fill-ins (no number stored before)"] += r["number_read_where_none"]
        tot["changed"] += r["number_changed"]
        tot["changed in job-018 (applied in full)" if full else "changed elsewhere (waiting)"] += r[
            "number_changed"
        ]
        tot["written"] += r["written"]
        if not apply:
            for c in r["changes"]:
                if c["kind"] != "number_changed":
                    continue
                rows.append([pid, c["page_index"], c["old"], c["new"], "yes" if full else "no", ""])
                CROPS.mkdir(parents=True, exist_ok=True)
                crop(pdf, c["page_index"], CROPS / f"{pid[:8]}_p{c['page_index']:03d}.png")
    if not apply:
        CSV.parent.mkdir(parents=True, exist_ok=True)
        with CSV.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["project_id", "page_index", "old", "new", "applied_job018", "owner_ok"])
            w.writerows(rows)
        tot["review rows written"] = len(rows)
    print(json.dumps({"applied": apply, **dict(tot)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
