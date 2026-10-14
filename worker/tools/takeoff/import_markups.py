"""Phase 10 Part D: import the estimators' count markups of one job for comparison (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.import_markups <job-id>

Each count symbol (a Polygon of 3 or 8 vertices) of the job's marked-up PDF, on a page that maps to
our drawing, with its tag (the reply-linked FreeText) and the KIND given by the project's mapping
of estimator mark prefixes (`project_prefix_kinds`, owner decision 124); a prefix that is not mapped
gives no kind. Nothing is written to the database. The rows go to the git-ignored
fixtures/private/takeoffs/markups_<job>.json; stdout has counts only.
"""

from __future__ import annotations

import collections
import json
import re
import sys

import pymupdf

from src.config import load_config
from src.db import connect
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.geometry_study import vertices_of
from tools.takeoff.phase6c_trace import RUNS

_MARK = re.compile(r"^([A-Za-z]{1,6})[-\s]?\d+[A-Za-z]?$")


def prefix_of(mark: str | None) -> str | None:
    m = _MARK.match((mark or "").strip())
    return m.group(1).upper() if m else None


def kind_for_mark(mark: str | None, mapping: dict[str, str]) -> str | None:
    """The same rule as the API (api/src/review/prefix-kinds.ts kindForMark)."""
    p = prefix_of(mark)
    return mapping.get(p) if p else None


def page_symbols(doc: pymupdf.Document, page: pymupdf.Page) -> list[dict]:
    """Count symbols of a page with the text of their reply-linked tag (None when there is none)."""
    syms: dict[int, dict] = {}
    for a in page.annots() or []:
        if a.type[1] == "Polygon":
            v = vertices_of(a, page)
            if len(v) in (3, 8):
                syms[a.xref] = {
                    "x": sum(p[0] for p in v) / len(v),
                    "y": sum(p[1] for p in v) / len(v),
                    "mark": None,
                }
    for a in page.annots() or []:
        if a.type[1] != "FreeText":
            continue
        t, val = doc.xref_get_key(a.xref, "IRT")
        if t == "xref" and int(val.split()[0]) in syms:
            syms[int(val.split()[0])]["mark"] = (a.info.get("content") or "").strip()
    return list(syms.values())


def import_job(job: str, mapping: dict[str, str]) -> tuple[list[dict], dict]:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    name, info = next((n, i) for n, i in sorted(inv.items()) if i.get("match") == job)
    rows = []
    counts: collections.Counter = collections.Counter()
    with pymupdf.open(TAKEOFFS / name) as doc:
        for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
            for s in page_symbols(doc, doc[tp]):
                kind = kind_for_mark(s["mark"], mapping)
                counts["symbols"] += 1
                counts["with a tag"] += s["mark"] is not None
                counts["with a mark prefix"] += prefix_of(s["mark"]) is not None
                counts["kind from the mapping"] += kind is not None
                rows.append(
                    {"page_index": dp, "x": s["x"], "y": s["y"], "mark": s["mark"], "kind": kind}
                )
    return rows, dict(counts)


def main(argv: list[str]) -> None:
    if not argv:
        print(__doc__)
        return
    job = argv[0]
    pid = json.loads(RUNS.read_text())[job]["project_id"]
    conn = connect(load_config().database_url)
    mapping = {
        r["prefix"]: r["kind"]
        for r in conn.execute(
            "SELECT prefix, kind FROM project_prefix_kinds WHERE project_id = %s", (pid,)
        )
    }
    rows, counts = import_job(job, mapping)
    (TAKEOFFS / f"markups_{job}.json").write_text(json.dumps(rows))
    print(json.dumps({"job": job, "mapped_prefixes": len(mapping), **counts}))


if __name__ == "__main__":
    main(sys.argv[1:])
