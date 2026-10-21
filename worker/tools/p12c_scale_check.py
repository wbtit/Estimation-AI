"""Phase 12c-A check: their /BBMeasure calibration against the scale the Phase 12c run used.

  PYTHONPATH=. .venv/bin/python -m tools.p12c_scale_check

Read-only. For every drawing page where their /BBMeasure calibration exists (inventory page map +
the Phase 6c frame offset), their distinct scales (merged within 1%) against the scale stored in the
frozen system version of `p12c-<job>` and its source. Agree = within 1% of any of theirs. Writes
fixtures/private/eval/p12c/scale_check.json; prints job ids, page numbers and ratios only.
"""

from __future__ import annotations

import collections
import json

import pymupdf

from src.config import load_config
from src.db import connect
from tools.bbmeasure import bb_measure_ratio
from tools.p12c_lib import JOBS, RATIO_MERGE, _frames, project_name
from tools.takeoff.common import PRIVATE, TAKEOFFS

AGREE = 0.01
OUT = PRIVATE / "eval" / "p12c" / "scale_check.json"


def theirs_by_page() -> dict[str, dict[int, list[float]]]:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    frames = _frames()
    out: dict[str, dict[int, list[float]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if job not in JOBS:
            continue
        with pymupdf.open(TAKEOFFS / name) as doc:

            def resolve(x: int, doc=doc) -> str:
                return doc.xref_object(x, compressed=False)

            for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
                off = frames.get((job, tp), (0, 0.0, 0.0))[0]
                for a in doc[tp].annots() or []:
                    r = bb_measure_ratio(doc.xref_object(a.xref, compressed=False), resolve)
                    if r is not None:
                        out[job][dp + off].append(r)
    merged: dict[str, dict[int, list[float]]] = {}
    for job, pages in out.items():
        merged[job] = {}
        for dp, rs in pages.items():
            vals: list[float] = []
            for r in sorted(rs):
                if not vals or abs(r - vals[-1]) / vals[-1] > RATIO_MERGE:
                    vals.append(r)
            merged[job][dp] = [round(v, 3) for v in vals]
    return merged


def main() -> None:
    cfg = load_config()
    theirs = theirs_by_page()
    rows = []
    with connect(cfg.database_url) as conn:
        for job in JOBS:
            if job not in theirs:
                continue
            pid = conn.execute(
                "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                (project_name(job),),
            ).fetchone()["id"]
            snaps = {
                r["page_index"]: r["setup"]
                for r in conn.execute(
                    "SELECT s.page_index, b.setup FROM build_snapshots b JOIN sheets s"
                    " ON s.id = b.sheet_id WHERE b.project_id = %s",
                    (pid,),
                )
            }
            for dp, vals in sorted(theirs[job].items()):
                setup = snaps.get(dp) or {}
                tag = (setup.get("evidence") or {}).get("p12c_person_setup") or {}
                ours = (setup.get("scale") or {}).get("value")
                row = {
                    "job": job,
                    "page": dp + 1,
                    "theirs": vals,
                    "in_12c_run": bool(tag.get("built")),
                    "built": bool(setup.get("built")),
                    "ours": ours,
                    "source": tag.get("scale_source"),
                }
                if tag.get("built") and ours:
                    row["agree"] = any(abs(ours - v) / v <= AGREE for v in vals)
                    row["agree_each"] = [abs(ours - v) / v <= AGREE for v in vals]
                rows.append(row)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1))
    cmp_ = [r for r in rows if "agree" in r]
    print(
        "pages with their calibration",
        len(rows),
        "| in the 12c run with a scale",
        len(cmp_),
        "| agree",
        sum(r["agree"] for r in cmp_),
        "| differ",
        sum(not r["agree"] for r in cmp_),
    )
    for r in rows:
        print(json.dumps(r))


if __name__ == "__main__":
    main()
