"""Phase 5c item 2a: what are the lines that carry more than one member made of? Counts only.

For each line shared by several members of a project (same sheet, same chosen line) it looks at the
ORIGINAL drawn segments behind the merged line (before the merge of touching collinear segments),
the seams between them, what sits at each seam, and where each member's label projects onto the
line. It reads the PDF (path to it from the git-ignored inventory map) and the API; it prints only
numbers.

usage (from worker/):  PYTHONPATH=. .venv/bin/python ../scripts/calibration/phase5c_shared_lines.py <job> <project id>
"""

from __future__ import annotations

import collections
import importlib.util
import json
import math
import sys
import urllib.request
from pathlib import Path

import pymupdf

from src.linking.lines import (
    ANGLE_BIN_DEG,
    COLLINEAR_PT,
    page_segments,
    reconstruct,
)

API = "http://127.0.0.1:3000"
ROOT = Path(__file__).resolve().parents[2]
TOL = 0.6


def get(path: str):
    return json.loads(urllib.request.urlopen(API + path, timeout=300).read())


def pdf_of(job: str) -> Path:
    spec = importlib.util.spec_from_file_location("cal", ROOT / "scripts/calibration/phase5b_calibrate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.pdf_of(job)


def key(line: dict) -> tuple:
    a = (round(line["p"][0]), round(line["p"][1]))
    b = (round(line["q"][0]), round(line["q"][1]))
    return (a, b) if a <= b else (b, a)


def seg_len(s) -> float:
    return math.hypot(s[2] - s[0], s[3] - s[1])


def ang_of(s) -> float:
    return math.atan2(s[3] - s[1], s[2] - s[0]) % math.pi


def dist_point_seg(px, py, s) -> float:
    x0, y0, x1, y1 = s[:4]
    dx, dy = x1 - x0, y1 - y0
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / l2))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def ang_diff(a: float, b: float) -> float:
    d = abs(a - b) % math.pi
    return min(d, math.pi - d)


def small_closed_shapes(page: pymupdf.Page) -> list[tuple[float, float, float, float]]:
    m = page.rotation_matrix
    out = []
    for d in page.get_cdrawings():
        items = d["items"]
        if not items or len(items) > 8:
            continue
        closed = d.get("closePath") or items[0][0] == "re"
        if not closed and all(i[0] == "l" for i in items):
            first = pymupdf.Point(items[0][1])
            last = pymupdf.Point(items[-1][2])
            closed = first.distance_to(last) < 0.5
        if not closed:
            continue
        r = pymupdf.Rect(d["rect"]) * m
        r.normalize()
        w, h = r.width, r.height
        if 4 <= w <= 60 and 4 <= h <= 60 and max(w, h) / max(min(w, h), 0.1) <= 3:
            out.append((r.x0, r.y0, r.x1, r.y1))
    return out


def main(job: str, pid: str) -> None:
    sheets = {s["id"]: s for s in get(f"/api/projects/{pid}/sheets")["sheets"]}
    members = [m for m in get(f"/api/projects/{pid}/members?include_deleted=true")["members"]
               if not m["deleted"] and m["link"]["line"] and m["bbox"]]
    views_by_sheet = {sid: get(f"/api/projects/{pid}/sheets/{sid}/views")["views"] for sid in sheets}
    groups: dict[tuple, list[dict]] = collections.defaultdict(list)
    for m in members:
        groups[(m["sheet_id"], key(m["link"]["line"]))].append(m)
    shared = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"{job}: {len(members)} members on {len(groups)} lines; {len(shared)} lines carry more than one member ({sum(len(v) for v in shared.values())} members)")
    if not shared:
        return
    doc = pymupdf.open(pdf_of(job))
    stats = collections.Counter()
    seam_kinds = collections.Counter()
    by_page: dict[int, list] = collections.defaultdict(list)
    for (sid, _), v in shared.items():
        by_page[sheets[sid]["page_index"]].append((sid, v))
    for pidx, items in sorted(by_page.items()):
        page = doc[pidx]
        segs = page_segments(page)
        lines = reconstruct(segs)
        shapes = small_closed_shapes(page)
        classes = set()
        for sid, _ in items:
            for vw in views_by_sheet[sid]:
                classes.update(vw["structural_classes"])
        from src.linking.lines import class_key, width_bucket  # noqa: PLC0415

        def klass_of(s):
            return class_key(s[4], s[5], False)

        structural_segs = [s for s in segs if klass_of(s) in classes and seg_len(s) >= 3]
        long_other = [ln for ln in lines if ln.klass not in classes and ln.length >= 200]
        for sid, v in items:
            line = v[0]["link"]["line"]
            p, q = line["p"], line["q"]
            L = (p[0], p[1], q[0], q[1])
            la = ang_of(L)
            ux, uy = math.cos(la), math.sin(la)
            origin = (p[0], p[1])
            proj = lambda x, y: (x - origin[0]) * ux + (y - origin[1]) * uy  # noqa: E731
            off0 = -p[0] * uy + p[1] * ux
            t_end = proj(q[0], q[1])
            lo_L, hi_L = min(0.0, t_end), max(0.0, t_end)
            # the merged line as the worker has it (to read n_src)
            merged = [ln for ln in lines if max(abs(ln.x0 - L[0]), abs(ln.y0 - L[1]), abs(ln.x1 - L[2]), abs(ln.y1 - L[3])) <= TOL
                      or max(abs(ln.x0 - L[2]), abs(ln.y0 - L[3]), abs(ln.x1 - L[0]), abs(ln.y1 - L[1])) <= TOL]
            n_src = merged[0].n_src if merged else None
            # original segments on this line
            ivs = []
            for s in structural_segs:
                if ang_diff(ang_of(s), la) > math.radians(ANGLE_BIN_DEG) * 1.5:
                    continue
                if abs((-s[0] * uy + s[1] * ux) - off0) > COLLINEAR_PT * 1.5:
                    continue
                a, b = proj(s[0], s[1]), proj(s[2], s[3])
                lo, hi = min(a, b), max(a, b)
                if hi < lo_L - 0.5 or lo > hi_L + 0.5:
                    continue
                ivs.append((lo, hi))
            ivs.sort()
            distinct: list[tuple[float, float]] = []
            for lo, hi in ivs:  # drop a segment that lies inside an earlier one (a line drawn twice)
                if distinct and lo >= distinct[-1][0] - 0.5 and hi <= distinct[-1][1] + 0.5:
                    continue
                distinct.append((lo, hi))
            stats["shared lines"] += 1
            stats["one drawn segment" if len(distinct) <= 1 else "several drawn segments"] += 1
            if n_src is not None:
                stats["worker n_src == 1" if n_src == 1 else "worker n_src > 1 (merged)"] += 1
            # seams
            for (a_lo, a_hi), (b_lo, b_hi) in zip(distinct, distinct[1:], strict=False):
                t = (a_hi + b_lo) / 2
                sx, sy = origin[0] + t * ux, origin[1] + t * uy
                kind = "nowhere identifiable"
                perp = [s for s in structural_segs if ang_diff(ang_of(s), la + math.pi / 2) <= math.radians(5) and dist_point_seg(sx, sy, s) <= 3.0]
                if perp:
                    kind = "perpendicular structural line"
                elif any(x0 - 3 <= sx <= x1 + 3 and y0 - 3 <= sy <= y1 + 3 for x0, y0, x1, y1 in shapes):
                    kind = "column-sized closed shape"
                elif any(ang_diff(ang_of((ln.x0, ln.y0, ln.x1, ln.y1)), la + math.pi / 2) <= math.radians(3) and dist_point_seg(sx, sy, (ln.x0, ln.y0, ln.x1, ln.y1)) <= 2.0 for ln in long_other):
                    kind = "grid line"
                seam_kinds[kind] += 1
            stats["seams"] += max(len(distinct) - 1, 0)
            # supports along the single drawn segment: perpendicular structural lines that cross or touch it,
            # and column-sized closed shapes on it. These are NOT seams of the line (it has none); they are
            # where a person would cut the member.
            sup: list[float] = []
            for sg in structural_segs:
                if ang_diff(ang_of(sg), la + math.pi / 2) > math.radians(5):
                    continue
                for end in ((sg[0], sg[1]), (sg[2], sg[3])):
                    if dist_point_seg(end[0], end[1], L) <= 1.5:
                        sup.append(proj(*end))
                        break
                else:
                    # crosses the line in the middle
                    mx, my = (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2
                    if dist_point_seg(sg[0], sg[1], L) > 1.5 and dist_point_seg(sg[2], sg[3], L) > 1.5:
                        # intersect axis point
                        t0 = proj(sg[0], sg[1])
                        t1 = proj(sg[2], sg[3])
                        n0 = (-(sg[0] - origin[0]) * uy + (sg[1] - origin[1]) * ux)
                        n1 = (-(sg[2] - origin[0]) * uy + (sg[3] - origin[1]) * ux)
                        if n0 * n1 < 0:
                            f = n0 / (n0 - n1)
                            sup.append(t0 + f * (t1 - t0))
            for x0, y0, x1, y1 in shapes:
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                if dist_point_seg(cx, cy, L) <= max(x1 - x0, y1 - y0) / 2 + 1.5:
                    sup.append(proj(cx, cy))
            sup = sorted(t for t in sup if lo_L - 1 <= t <= hi_L + 1)
            merged_sup: list[float] = []
            for t in sup:  # supports closer than 6 pt are one support
                if not merged_sup or t - merged_sup[-1] > 6:
                    merged_sup.append(t)
            stats["supports found on shared lines"] += len(merged_sup)
            cuts = merged_sup
            slots = collections.defaultdict(list)
            for i, m in enumerate(v):
                b_ = m["bbox"]
                t = proj((b_["x0"] + b_["x1"]) / 2, (b_["y0"] + b_["y1"]) / 2)
                slots[sum(1 for c in cuts if c < t)].append(i)
            alone = sum(1 for ix in slots.values() if len(ix) == 1)
            stats["members alone between two supports"] += alone
            stats["members sharing the stretch between two supports"] += sum(len(ix) for ix in slots.values() if len(ix) > 1)
            if all(len(ix) == 1 for ix in slots.values()):
                stats["lines where supports separate every member"] += 1
            if not cuts:
                stats["lines with no support found"] += 1
            # members: which drawn segment holds the label's projection
            owner: dict[int, list[int]] = collections.defaultdict(list)
            for i, m in enumerate(v):
                b = m["bbox"]
                cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
                t = proj(cx, cy)
                if not distinct:
                    stats["members: no original segment found"] += 1
                    continue
                inside = [k for k, (lo, hi) in enumerate(distinct) if lo - 0.5 <= t <= hi + 0.5]
                if inside:
                    k = inside[0]
                    stats["members: label projects inside a drawn segment"] += 1
                else:
                    k = min(range(len(distinct)), key=lambda j: min(abs(t - distinct[j][0]), abs(t - distinct[j][1])))
                    stats["members: label projects outside every segment (nearest used)"] += 1
                owner[k].append(i)
            if distinct:
                for k, idxs in owner.items():
                    stats["members: alone on their drawn segment" if len(idxs) == 1 else "members: sharing a drawn segment with another member"] += len(idxs)
                if all(len(ix) == 1 for ix in owner.values()):
                    stats["lines where every member has its own drawn segment"] += 1
            stats["members in shared lines"] += len(v)
    for k, n in stats.items():
        print(f"   {k}: {n}")
    print("   seams by what is at them:", dict(seam_kinds))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
