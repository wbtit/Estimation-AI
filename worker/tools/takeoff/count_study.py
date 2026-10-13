"""EXPLORATORY (post-hoc, NOT pre-registered): the count markups (polygon symbols) against our lines.

The pre-registered measures cover length markups. The files turned out to be mostly count takeoffs
(a small polygon symbol plus a short tag per counted member), so this module reports, clearly
labelled as exploratory, where the count symbols sit relative to our reconstructed structural lines.
Counts only. usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.count_study [job ...]
"""

from __future__ import annotations

import collections
import json
import sys

import numpy as np
import pymupdf

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents
from tools.takeoff.geometry_study import dist_points_segments, vertices_of

TOLS = (6.0, 12.0, 25.0)


def run(job: str, name: str, info: dict, doc_path) -> dict:
    cf = PRIVATE / "study" / job / "structural_classes.json"
    sc = json.loads(cf.read_text()) if cf.exists() else {}
    tdoc, ddoc = pymupdf.open(TAKEOFFS / name), pymupdf.open(doc_path)
    out = {
        "symbols": 0,
        "by_verts": collections.Counter(),
        "near": {t: 0 for t in TOLS},
        "per_line": collections.Counter(),
        "kind": collections.Counter(),
        "dist_bands": collections.Counter(),
        "tagged": 0,
    }
    for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
        tpage, dpage = tdoc[tp], ddoc[dp]
        syms = []
        tags = 0
        tag_pts = []
        for a in tpage.annots() or []:
            st = a.type[1]
            if st == "Polygon":
                v = vertices_of(a, tpage)
                if len(v) in (3, 8):
                    syms.append((len(v), np.mean([p[0] for p in v]), np.mean([p[1] for p in v])))
            elif st == "FreeText":
                tags += 1
                r = a.rect * tpage.rotation_matrix
                tc = (a.info.get("content") or "").strip()
                tag_pts.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, tc[:1].upper() if tc else ""))
        if not syms:
            continue
        size = (dpage.rect.width, dpage.rect.height)
        in_view = lines_in_box(page_lines(dpage), (0, 0, *size), size)
        classes = (
            sc[str(dp)]["structural"] if str(dp) in sc else suggest_classes(class_table(in_view))
        )
        structural = [ln for ln in in_view if ln.klass in classes and ln.length >= 12]
        if not structural:
            out["symbols"] += len(syms)
            out["dist_bands"]["no structural line on the page"] += len(syms)
            continue
        segs = np.array([[l.x0, l.y0, l.x1, l.y1] for l in structural])
        pts = np.array([[s[1], s[2]] for s in syms])
        d = dist_points_segments(pts, segs)
        k = d.argmin(axis=1)
        dm = d.min(axis=1)
        for (nv, sx, sy), kk, dd in zip(syms, k, dm, strict=False):
            out["symbols"] += 1
            out["by_verts"][nv] += 1
            letter = "no tag"
            if tag_pts:
                near_tag = min(tag_pts, key=lambda t_: (t_[0] - sx) ** 2 + (t_[1] - sy) ** 2)
                if ((near_tag[0] - sx) ** 2 + (near_tag[1] - sy) ** 2) ** 0.5 <= 60:
                    letter = (
                        near_tag[2] if near_tag[2] in ("B", "C", "W", "H", "J", "L") else "other"
                    )
            out["kind"][(nv, letter, bool(dd <= 12))] += 1
            for t in TOLS:
                out["near"][t] += int(dd <= t)
            if dd <= 12:
                out["per_line"][(dp, int(kk))] += 1
            out["dist_bands"][
                "<=6"
                if dd <= 6
                else "6-12"
                if dd <= 12
                else "12-25"
                if dd <= 25
                else "25-60"
                if dd <= 60
                else ">60"
            ] += 1
        out["tagged"] += tags
    pl = collections.Counter(min(c, 4) for c in out["per_line"].values())
    return {
        "symbols": out["symbols"],
        "by_verts": dict(out["by_verts"]),
        "near": out["near"],
        "dist_bands": dict(out["dist_bands"]),
        "symbols_per_line(<=12pt)": dict(sorted(pl.items())),
        "tags": out["tagged"],
    }


def main(argv: list[str]) -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    allres = {}
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job or (argv and job not in argv):
            continue
        r = run(job, name, info, draws[job])
        allres[job] = r
        print(job, r)
    (TAKEOFFS / "count_study.json").write_text(json.dumps(allres, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
