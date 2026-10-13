"""Phase 5u W2 / V3: where do the Size and Length of 15 sampled MAIN-steel rows appear in the job's drawing (text evidence).

MAIN rows = data rows of the workbook before its total row; sample = random.Random(5021).sample(range(n), 15), drawn once.
Per row the text layer of the drawing is searched: size as a plan label on the referenced page(s) or elsewhere; length as a
dimension text on the referenced page(s) or elsewhere, or in the text of a takeoff markup. Counts only; nothing is printed
from the workbook or the drawing. The image reading is done separately by a person (me) and recorded as counts.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.v3_trace job-018 takeoff-10.pdf
"""

from __future__ import annotations

import collections
import json
import random
import sys

import pymupdf

from src.text_layer.parsers.dimension import find_dimensions
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents
from tools.takeoff.target_tie import lines_norm
from tools.takeoff.target_workbook import norm_ref, num

FAMILY = {"HSS": "HSS", "WF": "W", "C": "C", "PL": "PL", "MC": "MC", "L": "L"}
TOL_IN = 0.5


def main_rows() -> list[dict]:
    d = json.load(open(PRIVATE / "target" / "rows.json"))
    out = []
    for r in d["rows"]:
        if "TOTAL" in str(r.get("grade", "")).upper():
            break
        if num(r.get("qty")) is not None:
            out.append(r)
    return out


def canon(shape: str, size: str) -> str | None:
    if shape not in FAMILY:
        return None
    ps = find_profiles(f"{FAMILY[shape]}{size}")
    return ps[0].canonical if ps else None


def main(job: str, takeoff: str) -> None:
    rows = main_rows()
    idx = random.Random(5021).sample(range(len(rows)), min(15, len(rows)))
    print(
        "main rows:",
        len(rows),
        "| sample indexes drawn with seed 5021 (positions only):",
        sorted(idx),
    )
    doc = pymupdf.open(drawing_documents()[job])
    page_lines: list[list[str]] = []
    page_norm: list[set[str]] = []
    for pg in doc:
        page_lines.append(
            [
                b
                for blk in pg.get_text("dict")["blocks"]
                for ln in blk.get("lines", [])
                for b in ["".join(s["text"] for s in ln["spans"])]
                if b.strip()
            ]
        )
        page_norm.append(lines_norm(pg))
    page_profiles = [{p.canonical for t in ls for p in find_profiles(t)} for ls in page_lines]
    page_dims = [[d.mm / 25.4 for t in ls for d in find_dimensions(t)] for ls in page_lines]
    marks = []
    with pymupdf.open(TAKEOFFS / takeoff) as td:
        for pg in td:
            for a in pg.annots() or []:
                for t in (a.info.get("content") or "", a.info.get("subject") or ""):
                    marks += [d.mm / 25.4 for d in find_dimensions(t)]
    res = collections.Counter()
    per_row = []
    for i in sorted(idx):
        r = rows[i]
        ref = norm_ref(str(r.get("ref", "")))
        ref_pages = [
            k
            for k, s in enumerate(page_norm)
            if any(ref.endswith(x) and 4 <= len(x) <= 7 for x in s)
        ]
        c = canon(str(r.get("shape", "")), str(r.get("size", "")))
        ft, inch = num(r.get("len_ft")), num(r.get("len_in"))
        length = None if ft is None and inch is None else (ft or 0) * 12 + (inch or 0)
        size_ref = bool(c) and any(c in page_profiles[k] for k in ref_pages)
        size_any = bool(c) and any(c in s for s in page_profiles)
        len_ref = length is not None and any(
            abs(x - length) <= TOL_IN for k in ref_pages for x in page_dims[k]
        )
        len_any = length is not None and any(
            abs(x - length) <= TOL_IN for xs in page_dims for x in xs
        )
        len_mark = length is not None and any(abs(x - length) <= TOL_IN for x in marks)
        res["size_on_ref_page"] += size_ref
        res["size_elsewhere_only"] += size_any and not size_ref
        res["size_not_in_text"] += not size_any
        res["len_dim_on_ref_page"] += len_ref
        res["len_dim_elsewhere_only"] += len_any and not len_ref
        res["len_in_markup_text_only"] += len_mark and not len_any
        res["len_not_in_text"] += not (len_any or len_mark)
        per_row.append(
            {
                "i": i,
                "ref_pages": [k + 1 for k in ref_pages],
                "size": [size_ref, size_any],
                "len": [len_ref, len_any, len_mark],
                "qty": r.get("qty"),
                "has_len": length is not None,
                "shape": r.get("shape"),
            }
        )
    (PRIVATE / "target" / "v3_rows.json").write_text(json.dumps(per_row, indent=1))
    print(dict(res))
    print(
        "rows without a length:",
        sum(not p["has_len"] for p in per_row),
        "| rows whose reference is on no page:",
        sum(not p["ref_pages"] for p in per_row),
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
