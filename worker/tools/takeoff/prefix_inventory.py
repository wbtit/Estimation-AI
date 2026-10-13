"""Phase 5u P: private inventory of the tag prefixes of the estimators' count symbols.

Writes fixtures/private/takeoffs/prefix_inventory.csv (git-ignored; it holds the prefix letters). Prints only counts.
A tag is the nearest FreeText within 40 pt of a count symbol (Polygon with 3 or 8 vertices); the prefix is its leading
letters in upper case ("(none)" when it has none). The `meaning` column is left empty for the owner and the estimators.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.prefix_inventory
"""

from __future__ import annotations

import collections
import csv
import json
import math
import re

import pymupdf

from tools.takeoff.colour_study import colour_key
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.tag_study import RADIUS

COLUMNS = [
    "prefix",
    "symbols",
    "pages",
    "files",
    "jobs",
    "dominant_colour",
    "dominant_colour_share",
    "dominant_vertices",
    "dominant_vertices_share",
    "meaning",
]


def prefix_of(text: str) -> str:
    m = re.match(r"[A-Za-z]+", text.strip())
    return m.group(0).upper() if m else "(none)"


def collect() -> dict[str, dict]:
    inv = json.load(open(TAKEOFFS / "inventory.json"))
    acc: dict[str, dict] = collections.defaultdict(
        lambda: {
            "n": 0,
            "pages": set(),
            "files": set(),
            "jobs": set(),
            "colour": collections.Counter(),
            "verts": collections.Counter(),
        }
    )
    for name, v in inv.items():
        if not name.endswith(".pdf") or not v.get("annotations"):
            continue
        with pymupdf.open(TAKEOFFS / name) as doc:
            for pno, page in enumerate(doc, 1):
                syms, texts = [], []
                for a in page.annots() or []:
                    st = a.type[1]
                    r = a.rect
                    c = ((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
                    if st == "Polygon" and len(a.vertices or []) in (3, 8):
                        syms.append(
                            (*c, len(a.vertices), colour_key((a.colors or {}).get("stroke")))
                        )
                    elif st == "FreeText" and (a.info.get("content") or "").strip():
                        texts.append((*c, a.info["content"]))
                for x, y, nv, col in syms:
                    best = min(texts, key=lambda t: math.hypot(t[0] - x, t[1] - y), default=None)
                    ok = best and math.hypot(best[0] - x, best[1] - y) <= RADIUS
                    p = prefix_of(best[2]) if ok else "(no tag)"
                    e = acc[p]
                    e["n"] += 1
                    e["pages"].add((name, pno))
                    e["files"].add(name)
                    if v.get("match"):
                        e["jobs"].add(v["match"])
                    e["colour"][col] += 1
                    e["verts"][nv] += 1
    return acc


def main() -> None:
    acc = collect()
    rows = []
    for p, e in sorted(acc.items(), key=lambda kv: -kv[1]["n"]):
        col, cn = e["colour"].most_common(1)[0]
        vt, vn = e["verts"].most_common(1)[0]
        rows.append(
            {
                "prefix": p,
                "symbols": e["n"],
                "pages": len(e["pages"]),
                "files": len(e["files"]),
                "jobs": len(e["jobs"]),
                "dominant_colour": col,
                "dominant_colour_share": round(cn / e["n"], 3),
                "dominant_vertices": vt,
                "dominant_vertices_share": round(vn / e["n"], 3),
                "meaning": "",
            }
        )
    with open(TAKEOFFS / "prefix_inventory.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    total = sum(r["symbols"] for r in rows)
    print("distinct prefixes:", len(rows), "| symbols:", total)
    for k in (3, 5, 10, 20):
        print(
            f"  top {k} prefixes cover {sum(r['symbols'] for r in rows[:k]) / total:.1%} of symbols"
        )
    print(
        "  prefixes used in 1 file only:",
        sum(r["files"] == 1 for r in rows),
        "| in 5 or more files:",
        sum(r["files"] >= 5 for r in rows),
    )
    print(
        "  prefixes with one dominant colour+shape >= 90%:",
        sum(min(r["dominant_colour_share"], r["dominant_vertices_share"]) >= 0.9 for r in rows),
    )


if __name__ == "__main__":
    main()
