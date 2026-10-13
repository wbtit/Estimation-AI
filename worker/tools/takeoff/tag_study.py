"""Phase 5u V1b/V2: per page, how count symbols and their tags relate. Counts only; tag text is never printed or stored.

A tag is the nearest FreeText to a count symbol (Polygon with 3 or 8 vertices) within 40 pt of its centre.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.tag_study
"""

from __future__ import annotations

import collections
import json
import math
import re

import pymupdf

from tools.takeoff.colour_study import colour_key
from tools.takeoff.common import TAKEOFFS, takeoff_files

RADIUS = 40.0


def prefix_group(text: str, groups: dict[str, str]) -> str:
    m = re.match(r"[A-Za-z]*", text.strip())
    p = m.group(0).upper() if m else ""
    return groups.setdefault(p, f"P{len(groups) + 1}")


def page_study(page: pymupdf.Page, groups: dict[str, str]) -> dict:
    syms, texts = [], []
    for a in page.annots() or []:
        st = a.type[1]
        if st == "Polygon" and len(a.vertices or []) in (3, 8):
            r = a.rect
            syms.append(
                (
                    (r.x0 + r.x1) / 2,
                    (r.y0 + r.y1) / 2,
                    len(a.vertices),
                    colour_key((a.colors or {}).get("stroke")),
                )
            )
        elif st == "FreeText":
            r = a.rect
            t = (a.info.get("content") or "").strip()
            if t:
                texts.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, t))
    tags, by_kind = [], collections.Counter()
    for x, y, nv, col in syms:
        best = min(texts, key=lambda t: math.hypot(t[0] - x, t[1] - y), default=None)
        if best and math.hypot(best[0] - x, best[1] - y) <= RADIUS:
            tags.append(best[2])
            by_kind[f"{col}|{nv}v|{prefix_group(best[2], groups)}"] += 1
        else:
            by_kind[f"{col}|{nv}v|no-tag"] += 1
    return {
        "symbols": len(syms),
        "tagged": len(tags),
        "distinct_tags": len(set(tags)),
        "by_colour_shape_prefix": dict(by_kind),
    }


def main() -> None:
    out = {}
    for p in takeoff_files():
        if p.suffix != ".pdf":
            continue
        groups: dict[str, str] = {}
        with pymupdf.open(p) as doc:
            out[p.name] = {str(i + 1): page_study(pg, groups) for i, pg in enumerate(doc)}
            out[p.name] = {k: v for k, v in out[p.name].items() if v["symbols"]}
    (TAKEOFFS / "tag_study.json").write_text(json.dumps(out, indent=1))
    pages = [(f, k, v) for f, d in out.items() for k, v in d.items()]
    allu = sum(1 for _, _, v in pages if v["tagged"] and v["distinct_tags"] == v["tagged"])
    print("pages with count symbols:", len(pages), "| pages where every tag is distinct:", allu)
    sym = sum(v["symbols"] for *_, v in pages)
    tg = sum(v["tagged"] for *_, v in pages)
    dist = sum(v["distinct_tags"] for *_, v in pages)
    print("symbols", sym, "tagged", tg, "distinct tags (sum over pages)", dist)
    for k in (19, 23, 15, 20, 12, 16):
        v = out["takeoff-10.pdf"][str(k)]
        print(k, {a: b for a, b in v.items() if a != "by_colour_shape_prefix"})
        for kk, n in sorted(v["by_colour_shape_prefix"].items(), key=lambda x: -x[1]):
            print("    ", n, kk)


if __name__ == "__main__":
    main()
