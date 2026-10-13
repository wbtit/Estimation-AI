"""Exploratory: on which stroke class do the measured length markups lie? Counts only.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.measured_classes
"""

from __future__ import annotations

import collections
import json

import numpy as np
import pymupdf

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from tools.takeoff.common import TAKEOFFS, drawing_documents
from tools.takeoff.geometry_study import (
    MATCH_SHARE,
    dist_points_segments,
    measure_scale,
    poly_length,
    samples_along,
    vertices_of,
)


def main() -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    out = collections.Counter()
    heavy = collections.Counter()
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job:
            continue
        tdoc, ddoc = pymupdf.open(TAKEOFFS / name), pymupdf.open(draws[job])
        for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
            tpage = tdoc[tp]
            marks = [
                a
                for a in tpage.annots() or []
                if a.type[1] in ("Line", "PolyLine")
                and "/Measure" in tdoc.xref_object(a.xref, compressed=False)
            ]
            if not marks:
                continue
            dpage = ddoc[dp]
            size = (dpage.rect.width, dpage.rect.height)
            in_view = lines_in_box(page_lines(dpage), (0, 0, *size), size)
            sug = suggest_classes(class_table(in_view))
            lines = [ln for ln in in_view if ln.length >= 3]
            segs = np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in lines])
            for a in marks:
                v = vertices_of(a, tpage)
                if (
                    len(v) < 2
                    or poly_length(v) < 3
                    or measure_scale(tdoc.xref_object(a.xref, compressed=False), tdoc) is None
                ):
                    continue
                pts = samples_along(v)
                near = (dist_points_segments(pts, segs) <= 6.0).sum(axis=0)
                k = int(near.argmax())
                if near[k] / len(pts) < MATCH_SHARE:
                    out["on no line of any class"] += 1
                    continue
                cls = lines[k].klass
                width, colour, style = cls.split("|")
                out["on the suggested class" if cls in sug else "on another class"] += 1
                out[f"colour {colour}"] += 1
                out[f"style {style}"] += 1
                heavy[width] += 1
    print(dict(out))
    print("stroke width bucket of the line the markup lies on:", dict(heavy))


if __name__ == "__main__":
    main()
