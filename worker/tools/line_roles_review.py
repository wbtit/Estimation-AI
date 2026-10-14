"""Phase 10 Part A3: hatch and dimension detection on owner-chosen pages (decision 128), read-only.

  PYTHONPATH=. .venv/bin/python -m tools.line_roles_review [pages-file]

The pages file (default fixtures/private/review/pages_128.txt) has one page per line:
`<project id or job id> <page index>` (spaces or a comma; `#` starts a comment). For each page it
writes an overlay PNG to fixtures/private/shots/phase10/line_roles/ with the extracted lines drawn
over the page: hatch red, dimension lines (and their ticks) blue, every other line grey; and prints
counts only (lines per role, dimension lines). Nothing is written to the database.
"""

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

import pymupdf

from src.config import load_config
from src.db import connect
from src.linking.lines import page_lines
from src.review.sheet_lines_job import lines_payload
from tools.takeoff.common import PRIVATE
from tools.takeoff.phase6c_trace import RUNS

PAGES = PRIVATE / "review" / "pages_128.txt"
OUT = PRIVATE / "shots" / "phase10" / "line_roles"
ROLE_NAMES = {0: "hatch", 1: "thin", 2: "medium", 3: "heavy"}
COLOURS = {"hatch": (0.85, 0.1, 0.1), "dimension": (0.1, 0.3, 0.95), "other": (0.55, 0.55, 0.55)}


def parse_pages(text: str) -> list[tuple[str, int]]:
    out = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p for p in re.split(r"[\s,]+", line) if p]
        if len(parts) != 2 or not parts[1].isdigit():
            raise ValueError(f"line {raw!r}: expected '<project or job id> <page index>'")
        out.append((parts[0], int(parts[1])))
    return out


def classify_rows(rows: list[list[float]]) -> tuple[list[str], dict]:
    """'hatch' / 'dimension' / 'other' per row of the sheet_lines payload, and counts."""
    marks = []
    counts: collections.Counter = collections.Counter()
    for r in rows:
        role, dim = int(r[6]), int(r[7])
        mark = "dimension" if dim else ("hatch" if role == 0 else "other")
        marks.append(mark)
        counts[mark] += 1
        counts["role " + ROLE_NAMES[role]] += 1
    return marks, dict(counts)


def overlay(page: pymupdf.Page, rows: list[list[float]], marks: list[str], out: Path) -> None:
    """The page with each line redrawn in its colour (displayed coordinates mapped back)."""
    doc = pymupdf.open()
    doc.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
    p = doc[0]
    back = p.derotation_matrix
    shape = p.new_shape()
    for r, mark in zip(rows, marks, strict=True):
        a = pymupdf.Point(r[0], r[1]) * back
        b = pymupdf.Point(r[2], r[3]) * back
        shape.draw_line(a, b)
        shape.finish(color=COLOURS[mark], width=1.6 if mark != "other" else 0.6)
    shape.commit()
    p.get_pixmap(dpi=60).save(out)


def main(argv: list[str]) -> None:
    pages_file = Path(argv[0]) if argv else PAGES
    if not pages_file.is_file():
        print(json.dumps({"skipped": True, "reason": "pages file not found"}))
        return
    pages = parse_pages(pages_file.read_text())
    runs = json.loads(RUNS.read_text())
    config = load_config()
    conn = connect(config.database_url)
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    for k, (who, page_index) in enumerate(pages, start=1):
        pid = runs[who]["project_id"] if who in runs else who
        row = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
        ).fetchone()
        if row is None:
            report.append({"page": k, "error": "project not found"})
            continue
        with pymupdf.open(config.upload_dir / row["stored_path"]) as doc:
            page = doc[page_index]
            _, rows, _ = lines_payload(page_lines(page), page)
            marks, counts = classify_rows(rows)
            overlay(page, rows, marks, OUT / f"page{k:02d}.png")
        report.append({"page": k, "lines": len(rows), **counts})
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
