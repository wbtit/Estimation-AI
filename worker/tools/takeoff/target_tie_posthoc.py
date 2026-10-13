"""Phase 5u W1 post-hoc (NOT pre-registered): references that END with the normalised text of a short whole line
(sheet-number-like: a letter, then digits, 4 to 7 characters) of a page. Counts only."""

from __future__ import annotations

import json
import re

import pymupdf

from tools.takeoff.common import PRIVATE, drawing_documents
from tools.takeoff.target_tie import lines_norm
from tools.takeoff.target_workbook import norm_ref, num

SHEETLIKE = re.compile(r"[A-Z]{1,2}[0-9]{2,5}[A-Z]?")


def main() -> None:
    d = json.load(open(PRIVATE / "target" / "rows.json"))
    refs = {
        norm_ref(str(r["ref"])) for r in d["rows"] if num(r.get("qty")) is not None and r.get("ref")
    }
    refs.discard("")
    out = {}
    for job, p in drawing_documents().items():
        hit: set[str] = set()
        pages: set[int] = set()
        with pymupdf.open(p) as doc:
            for i, pg in enumerate(doc):
                for s in lines_norm(pg):
                    if 4 <= len(s) <= 7 and SHEETLIKE.fullmatch(s):
                        for r in refs:
                            if r.endswith(s):
                                hit.add(r)
                                pages.add(i + 1)
        out[job] = (len(hit), len(pages))
    for j, (n, pg) in sorted(out.items(), key=lambda kv: -kv[1][0])[:6]:
        print(f"  {j}: {n} of {len(refs)} references end with a sheet-like line ({pg} pages)")


if __name__ == "__main__":
    main()
