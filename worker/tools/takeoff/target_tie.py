"""Phase 5u W1: which of our documents carries the drawing references of the target workbook (counts only).

A reference is found in a document when its normalised form equals the normalised text of a whole text-layer line on some
page (annotations removed in memory). Also compared with the sheet numbers listed for job-001 in docs/SPEC.md.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.target_tie
"""

from __future__ import annotations

import json
import re

import pymupdf

from tools.takeoff.common import PRIVATE, drawing_documents, takeoff_files
from tools.takeoff.target_workbook import norm_ref, num

JOB001_SHEETS = ["S001", "S011", "S030", "S031", "S032", "S41"]  # from docs/SPEC.md, normalised


def lines_norm(page: pymupdf.Page) -> set[str]:
    try:
        a = page.first_annot
        while a:
            a = page.delete_annot(a)
    except Exception:  # noqa: BLE001
        pass
    out = set()
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            t = "".join(s["text"] for s in ln["spans"])
            if t.strip():
                out.add(norm_ref(t))
    return out


def main() -> None:
    d = json.load(open(PRIVATE / "target" / "rows.json"))
    refs = {
        norm_ref(str(r["ref"])) for r in d["rows"] if num(r.get("qty")) is not None and r.get("ref")
    }
    refs.discard("")
    shape = sorted({re.sub(r"[0-9]+", "9", re.sub(r"[A-Za-z]+", "A", norm_ref(x))) for x in refs})
    print("distinct references:", len(refs), "| shapes (letters=A, digits=9):", shape[:6])
    print("A) found among the job-001 sheet numbers in docs:", len(refs & set(JOB001_SHEETS)))
    res = {}
    paths = {f"{j}": p for j, p in drawing_documents().items()}
    paths.update({p.name: p for p in takeoff_files() if p.suffix == ".pdf"})
    for key, p in paths.items():
        found: set[str] = set()
        pages_text = 0
        with pymupdf.open(p) as doc:
            for pg in doc:
                s = lines_norm(pg)
                pages_text += bool(s)
                found |= refs & s
        res[key] = {"found": len(found), "pages_with_text": pages_text}
    (PRIVATE / "target" / "tie.json").write_text(json.dumps(res, indent=1))
    for k, v in sorted(res.items(), key=lambda kv: -kv[1]["found"])[:8]:
        print(
            f"  {k}: {v['found']} of {len(refs)} references found ({v['pages_with_text']} pages with text)"
        )


if __name__ == "__main__":
    main()
