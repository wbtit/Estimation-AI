"""Phase 5v: measured length study (Q1 to Q5, see docs/PHASE5V_PREREGISTRATION.md). Read-only.

Prints counts only. Per-markup rows go to the git-ignored fixtures/private/takeoffs/measure_study.json.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.measure_study
"""

from __future__ import annotations

import collections
import json
import math
import re

import numpy as np
import pymupdf

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.pdf_scan.analyze import analyze_page
from src.text_layer.parsers.dimension import find_dimensions
from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents
from tools.takeoff.geometry_study import (
    MIN_MARKUP_PT,
    measure_scale,
    poly_length,
    ratio_from_measure,
    vertices_of,
)

TOLS = (12.0, 6.0, 24.0)  # primary first
DIST_BANDS = [(3, "up to 3"), (6, "3 to 6"), (12, "6 to 12"), (24, "12 to 24"), (1e18, "over 24")]
REL_TOL, ABS_TOL_MM = 0.005, 25.4
PT_TO_MM = 25.4 / 72


def agrees(ours_mm: float, theirs_mm: float) -> bool:
    """Within 1 inch or 0.5% of theirs (the registered bar)."""
    d = abs(ours_mm - theirs_mm)
    return d <= ABS_TOL_MM or (theirs_mm > 0 and d / theirs_mm <= REL_TOL)


def pair_distance(a, b, line: tuple[float, float, float, float]) -> float:
    """Larger of the two click-to-end distances, for the better of the two end orders."""
    x0, y0, x1, y1 = line
    d1 = max(math.hypot(a[0] - x0, a[1] - y0), math.hypot(b[0] - x1, b[1] - y1))
    d2 = max(math.hypot(a[0] - x1, a[1] - y1), math.hypot(b[0] - x0, b[1] - y0))
    return min(d1, d2)


def nearest_line(a, b, segs: np.ndarray) -> tuple[int, float] | None:
    """Index and pair distance of the nearest line (ties: the longer line); None if no lines."""
    if len(segs) == 0:
        return None
    ax, ay = a
    bx, by = b
    d1 = np.maximum(
        np.hypot(ax - segs[:, 0], ay - segs[:, 1]), np.hypot(bx - segs[:, 2], by - segs[:, 3])
    )
    d2 = np.maximum(
        np.hypot(ax - segs[:, 2], ay - segs[:, 3]), np.hypot(bx - segs[:, 0], by - segs[:, 1])
    )
    d = np.minimum(d1, d2)
    length = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    order = np.lexsort((-length, d))
    k = int(order[0])
    return k, float(d[k])


def dist_band(d: float | None) -> str:
    if d is None:
        return "no line on page"
    for hi, name in DIST_BANDS:
        if d <= hi:
            return name
    return DIST_BANDS[-1][1]


def length_cell_class(v: str | None) -> str:
    """Format class of one length cell (never the value)."""
    t = (v or "").strip()
    if not t:
        return "empty"
    if re.fullmatch(r"\d+", t):
        return "whole number"
    if re.fullmatch(r"\d+\.\d+", t):
        n = len(t.split(".")[1])
        return (
            f"decimal, {n} place" + ("" if n == 1 else "s")
            if n < 3
            else "decimal, 3 or more places"
        )
    if re.fullmatch(r"\d+\s+\d+/\d+", t):
        return "mixed fraction text"
    if "/" in t:
        return "fraction text"
    return "text other"


def multiple_of(x: float, step: float) -> bool:
    return abs(x / step - round(x / step)) < 1e-6


def band_share(rel: float) -> str:
    if rel <= 0.02:
        return "within 2%"
    if rel <= 0.05:
        return "2 to 5%"
    return "over 5%"


def structural_lines(dpage, scan, classes_by_page, dp, which):
    size = (dpage.rect.width, dpage.rect.height)
    lines = page_lines(dpage)
    in_view = lines_in_box(lines, (0, 0, size[0], size[1]), size)
    if which == "all":
        keep = in_view
    else:
        if str(dp) in classes_by_page:
            classes = classes_by_page[str(dp)]["structural"]
        else:
            classes = suggest_classes(class_table(in_view))
        keep = [ln for ln in in_view if ln.klass in classes]
    keep = [ln for ln in keep if ln.length >= MIN_MARKUP_PT]
    return np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in keep]) if keep else np.zeros((0, 4))


def q1_q2_q3() -> dict:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    rows, pages = [], []
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job:
            continue
        cf = PRIVATE / "study" / job / "structural_classes.json"
        classes_by_page = json.loads(cf.read_text()) if cf.exists() else {}
        tdoc, ddoc = pymupdf.open(TAKEOFFS / name), pymupdf.open(draws[job])
        for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
            tpage, dpage = tdoc[tp], ddoc[dp]
            marks = []
            for a in tpage.annots() or []:
                if a.type[1] not in ("Line", "PolyLine"):
                    continue
                v = vertices_of(a, tpage)
                if len(v) < 2 or poly_length(v) < MIN_MARKUP_PT:
                    continue
                ms = measure_scale(tdoc.xref_object(a.xref, compressed=False), tdoc)
                if ms is None:
                    continue
                text = " ".join([(a.info.get("content") or ""), (a.info.get("subject") or "")])
                dims = find_dimensions(text)
                marks.append((v, ratio_from_measure(ms), dims[0].mm if dims else None))
            if not marks:
                continue
            scan = analyze_page(dpage)
            raster = scan.page_kind != "vector" or scan.image_coverage >= 0.5
            ours = scan.scale_parsed_ratio
            ratios = sorted({round(m[1], 3) for m in marks})
            merged: list[float] = []
            for r in ratios:
                if not merged or abs(r - merged[-1]) / merged[-1] > 0.01:
                    merged.append(r)
            pages.append(
                {
                    "job": job,
                    "page": dp,
                    "n_marks": len(marks),
                    "markup_ratios": merged,
                    "ours": ours,
                    "agree": bool(ours and any(abs(ours - r) / r <= 0.01 for r in merged)),
                    "raster": raster,
                    "n_scales_found": len(scan.scales),
                }
            )
            segs = {
                w: structural_lines(dpage, scan, classes_by_page, dp, w)
                for w in ("structural", "all")
            }
            for v, mratio, theirs in marks:
                path = poly_length(v)
                row = {
                    "job": job,
                    "page": dp,
                    "n_vertices": len(v),
                    "raster": raster,
                    "has_value": theirs is not None,
                    "has_ours": ours is not None,
                    "path_pt": round(path, 1),
                }
                if theirs:
                    row["maths_ok"] = agrees(path * PT_TO_MM * mratio, theirs)
                    if ours:
                        o = path * PT_TO_MM * ours
                        row["q2_ok"] = agrees(o, theirs)
                        row["q2_rel"] = abs(o - theirs) / theirs
                if len(v) == 2 and not raster:
                    a, b = v[0], v[-1]
                    click_mm_theirs = math.hypot(b[0] - a[0], b[1] - a[1]) * PT_TO_MM
                    for w, s in segs.items():
                        nl = nearest_line(a, b, s)
                        row[f"{w}_dist"] = None if nl is None else round(nl[1], 2)
                        if nl is None:
                            continue
                        ln = s[nl[0]]
                        ln_pt = math.hypot(ln[2] - ln[0], ln[3] - ln[1])
                        row[f"{w}_len_vs_click"] = ln_pt / (click_mm_theirs / PT_TO_MM)
                        if theirs and ours and nl[1] <= TOLS[0]:
                            row[f"{w}_auto_ok"] = agrees(ln_pt * PT_TO_MM * ours, theirs)
                            row[f"{w}_clicks_ok"] = agrees(click_mm_theirs * ours, theirs)
                rows.append(row)
    return {"pages": pages, "rows": rows}


def summarise_q123(d: dict) -> None:
    pages, rows = d["pages"], d["rows"]
    print(f"Q1 pages with measured markups: {len(pages)}")
    print(
        f"  all markup ratios on the page agree (single ratio): {sum(len(p['markup_ratios']) == 1 for p in pages)}"
    )
    with_ours = [p for p in pages if p["ours"]]
    print(
        f"  pages where we read one scale: {len(with_ours)}; agree within 1%: {sum(p['agree'] for p in with_ours)}; differ: {sum(not p['agree'] for p in with_ours)}; none: {len(pages) - len(with_ours)}"
    )
    print(
        f"Q2 markups {len(rows)}; with value {sum(r['has_value'] for r in rows)}; with our scale {sum('q2_ok' in r for r in rows)}"
    )
    q2 = [r for r in rows if "q2_ok" in r]
    print(
        f"  agree {sum(r['q2_ok'] for r in q2)}; disagree {sum(not r['q2_ok'] for r in q2)}",
        collections.Counter(band_share(r["q2_rel"]) for r in q2 if not r["q2_ok"]),
    )
    mm = [r for r in rows if "maths_ok" in r]
    print(
        f"  with THEIR ratio (maths only): tested {len(mm)}, agree {sum(r['maths_ok'] for r in mm)}"
    )
    print(
        f"Q3 raster (cannot auto-measure): {sum(r['raster'] for r in rows)}; multi-vertex vector (not used): {sum((not r['raster']) and r['n_vertices'] > 2 for r in rows)}"
    )
    vec = [r for r in rows if not r["raster"] and r["n_vertices"] == 2]
    print(f"  vector two-click markups: {len(vec)}")
    for w in ("structural", "all"):
        for t in TOLS:
            n = sum(1 for r in vec if r.get(f"{w}_dist") is not None and r[f"{w}_dist"] <= t)
            print(f"  (a) {w} lines, both ends within {t:g} pt: {n}")
        print(
            f"  (b) {w} distance bands:",
            dict(collections.Counter(dist_band(r.get(f"{w}_dist")) for r in vec)),
        )
        near = [r for r in vec if r.get(f"{w}_dist") is not None and r[f"{w}_dist"] <= TOLS[0]]
        far = sum(1 for r in near if abs(r[f"{w}_len_vs_click"] - 1) > 0.10)
        print(f"      line length differs from clicked distance by over 10%: {far} of {len(near)}")
        t_ = [r for r in near if f"{w}_auto_ok" in r]
        print(
            f"  (c) {w}: tested {len(t_)}; auto agrees {sum(r[f'{w}_auto_ok'] for r in t_)}; clicks agree {sum(r[f'{w}_clicks_ok'] for r in t_)}"
        )


def q4() -> None:
    d = json.load(open(PRIVATE / "target" / "rows.json"))
    main = []
    for r in d["rows"]:
        if "TOTAL" in str(r.get("grade", "")).upper():
            break
        if r.get("qty") not in (None, ""):
            main.append(r)
    print(f"Q4 main rows with a quantity: {len(main)}")
    for col in ("len_ft", "len_in"):
        print(f"  {col}:", dict(collections.Counter(length_cell_class(r.get(col)) for r in main)))
    print(
        "  joint:",
        dict(
            collections.Counter(
                (length_cell_class(r.get("len_ft")), length_cell_class(r.get("len_in")))
                for r in main
            )
        ),
    )
    nums = []
    for r in main:
        try:
            nums.append(float(r.get("len_in")))
        except (TypeError, ValueError):
            pass
    print(f"  in values that are numbers: {len(nums)}")
    for step, nm in ((1, "1"), (0.5, "1/2"), (0.25, "1/4"), (0.125, "1/8"), (0.0625, "1/16")):
        print(f"    multiple of {nm} inch: {sum(multiple_of(x, step) for x in nums)}")


def main() -> None:
    d = q1_q2_q3()
    (TAKEOFFS / "measure_study.json").write_text(json.dumps(d, indent=1, default=str))
    summarise_q123(d)
    q4()


if __name__ == "__main__":
    main()


def q5() -> dict:
    """Feasibility only: written dimension strings against the drawn dimension line x scale."""
    from src.linking.candidates import rect_segment_distance

    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    jobs = sorted({i["match"] for i in inv.values() if i.get("match")})
    draws = drawing_documents()
    out = {"pages": 0, "strings": 0, "clear_line": 0, "agree": 0, "rows": []}
    for job in jobs:
        if out["pages"] >= 5:
            break
        doc = pymupdf.open(draws[job])
        for pi in range(len(doc)):
            page = doc[pi]
            scan = analyze_page(page)
            if (
                scan.page_type_guess != "framing_plan"
                or scan.page_kind != "vector"
                or scan.image_coverage >= 0.5
                or not scan.scale_parsed_ratio
                or len(scan.scales) != 1
            ):
                continue
            out["pages"] += 1
            segs = [ln for ln in page_lines(page) if ln.length >= 20]
            arr = np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in segs]) if segs else None
            found = 0
            for blk in page.get_text("dict")["blocks"]:
                for line in blk.get("lines", []):
                    text = "".join(s["text"] for s in line["spans"])
                    dims = find_dimensions(text)
                    if not dims or found >= 2:
                        continue
                    found += 1
                    out["strings"] += 1
                    bx = line["bbox"]
                    dx, dy = line["dir"]
                    tang = math.degrees(math.atan2(-dy, dx)) % 180
                    best = None
                    if arr is not None:
                        d = rect_segment_distance(tuple(bx), arr)
                        for k in np.argsort(d):
                            if d[k] > 12:
                                break
                            ln = segs[int(k)]
                            ang = math.degrees(math.atan2(-(ln.y1 - ln.y0), ln.x1 - ln.x0)) % 180
                            diff = min(abs(ang - tang), 180 - abs(ang - tang))
                            if diff <= 5:
                                best = ln
                                break
                    row = {"job": job, "page": pi, "clear_line": best is not None}
                    if best is not None:
                        out["clear_line"] += 1
                        ours = best.length * PT_TO_MM * scan.scale_parsed_ratio
                        row["agree"] = abs(ours - dims[0].mm) <= ABS_TOL_MM
                        out["agree"] += row["agree"]
                    out["rows"].append(row)
            break  # one page per job
    return out


if __name__ == "__main__":
    r = q5()
    (TAKEOFFS / "measure_q5.json").write_text(json.dumps(r, indent=1))
    print({k: v for k, v in r.items() if k != "rows"})
