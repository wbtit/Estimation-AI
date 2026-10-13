"""Phase 5u L: where is the WRITTEN length of the 15 sampled main rows (seed 5021)? Counts per source type only.

schedule = a line with the value shares its row (3 pt vertical band) with a profile text on the same page (or holds one);
plan dimension = a line made only of the dimension; callout = the dimension with other words, not a schedule row;
takeoff markup text = the value is in the text of a markup of the takeoff PDF; none written = none of these on the pages
the row's reference maps to (the first page of the document is the index and is not a referenced page).
A value found only on another sheet is reported apart ("elsewhere only") and counts as not written.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.length_source job-018 takeoff-10.pdf
"""

from __future__ import annotations

import collections
import json
import random
import re
import sys

import pymupdf

from src.text_layer.parsers.dimension import find_dimensions
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents
from tools.takeoff.target_tie import lines_norm
from tools.takeoff.target_workbook import norm_ref, num
from tools.takeoff.v3_trace import TOL_IN, main_rows


def page_lines(page: pymupdf.Page) -> list[tuple[str, float]]:
    out = []
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            t = "".join(s["text"] for s in ln["spans"]).strip()
            if t:
                x0, y0, x1, y1 = ln["bbox"]
                out.append((t, (y0 + y1) / 2))
    return out


def source_on_page(lines: list[tuple[str, float]], length_in: float) -> str | None:
    best = None
    prof_y = [y for t, y in lines if find_profiles(t)]
    for t, y in lines:
        dims = [d for d in find_dimensions(t) if abs(d.mm / 25.4 - length_in) <= TOL_IN]
        if not dims:
            continue
        if find_profiles(t) or any(abs(y - py) <= 3 for py in prof_y):
            return "schedule"
        rest = t
        for d in dims:
            rest = rest.replace(d.raw, "")
        only = not re.search(r"[A-Za-z0-9]", re.sub(r"[\s\-=/'\"]", "", rest))
        kind = "plan dimension" if only else "callout"
        if best != "plan dimension":
            best = kind
    return best


def main(job: str, takeoff: str) -> None:
    rows = main_rows()
    idx = sorted(random.Random(5021).sample(range(len(rows)), min(15, len(rows))))
    doc = pymupdf.open(drawing_documents()[job])
    norms = [lines_norm(p) for p in doc]
    lines = [page_lines(p) for p in doc]
    marks = []
    with pymupdf.open(TAKEOFFS / takeoff) as td:
        for pg in td:
            for a in pg.annots() or []:
                for t in (a.info.get("content") or "", a.info.get("subject") or ""):
                    marks += [d.mm / 25.4 for d in find_dimensions(t)]
    res: collections.Counter = collections.Counter()
    elsewhere = 0
    for i in idx:
        r = rows[i]
        ft, inch = num(r.get("len_ft")), num(r.get("len_in"))
        length = (ft or 0) * 12 + (inch or 0)
        ref = norm_ref(str(r.get("ref", "")))
        pages = [
            k
            for k in range(1, len(doc))
            if any(ref.endswith(x) and 4 <= len(x) <= 7 for x in norms[k])
        ]
        found = [s for k in pages if (s := source_on_page(lines[k], length))]
        order = ["schedule", "plan dimension", "callout"]
        src = next((o for o in order if o in found), None)
        if src is None and any(abs(x - length) <= TOL_IN for x in marks):
            src = "takeoff markup text"
        if src is None:
            if any(source_on_page(lines[k], length) for k in range(1, len(doc)) if k not in pages):
                elsewhere += 1
            src = "none written"
        res[src] += 1
    print(dict(res), "| of the none written, found only on another sheet:", elsewhere)
    (PRIVATE / "target" / "length_source.json").write_text(json.dumps(dict(res)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
