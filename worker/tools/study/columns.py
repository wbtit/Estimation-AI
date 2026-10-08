"""STEP 5: column hypothesis, detected WITHOUT labels, plus schedule parsing.

Hypothesis: columns are small closed shapes of consistent size near beam intersections or ends.
Detection: closed rectangular shapes (rectangle items or closed 4-line paths, stroked or filled),
4 to 60 pt on a side, aspect 0.6 to 1.67. Per plan page: how many, how many fall in the modal size
cluster (+-15%), size spread, and how many touch a structural line (within 2 pt). Schedule parsing:
rows of the text layer with a mark-like token and a profile in the same row.
    columns.py --jobs job-004,... ; writes columns_results.json; stdout counts only.
"""

import argparse
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidates  # noqa: E402
import common  # noqa: E402
import numpy as np  # noqa: E402
from src.pdf_scan.scale import normalize  # noqa: E402
from src.text_layer.parsers.marks import MARK_RE  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

MIN_SIDE, MAX_SIDE = 4.0, 60.0
ASPECT = (0.6, 1.67)
TOUCH_PT = 2.0
CLUSTER_TOL = 0.15


def detect_shapes(job: str, page: int) -> list[dict]:
    dump = json.loads((common.doc_dir(job) / f"page_{page}.json").read_text())
    out = []
    for s in dump["shapes"]:
        x0, y0, x1, y1 = s["bbox"]
        w, h = x1 - x0, y1 - y0
        if MIN_SIDE <= min(w, h) and max(w, h) <= MAX_SIDE and ASPECT[0] <= w / h <= ASPECT[1]:
            out.append(
                {"bbox": s["bbox"], "w": w, "h": h, "filled": s["filled"], "colour": s["colour"]}
            )
    return out


def analyse_page(job: str, page: int, struct: set[str]) -> dict:
    shapes = detect_shapes(job, page)
    lines = candidates.structural_lines_for(job, page, struct)
    arr = (
        np.array([[l["p"][0], l["p"][1], l["q"][0], l["q"][1]] for l in lines])
        if lines
        else np.zeros((0, 4))
    )
    sizes = [(s["w"] + s["h"]) / 2 for s in shapes]
    modal = None
    if sizes:
        best = max(sizes, key=lambda c: sum(abs(x - c) <= CLUSTER_TOL * c for x in sizes))
        modal = (best, sum(abs(x - best) <= CLUSTER_TOL * best for x in sizes))
    touching = 0
    if len(arr):
        for s in shapes:
            d = candidates.rect_segment_distance(s["bbox"], arr).min()
            touching += int(d <= TOUCH_PT)
    cv = None
    if modal:
        in_cluster = [x for x in sizes if abs(x - modal[0]) <= CLUSTER_TOL * modal[0]]
        if len(in_cluster) > 1:
            cv = statistics.pstdev(in_cluster) / statistics.mean(in_cluster)
    return {
        "shapes": len(shapes), "filled": sum(s["filled"] for s in shapes),
        "modal_size_pt": None if not modal else round(modal[0], 1),
        "in_modal_cluster": None if not modal else modal[1],
        "cluster_cv": None if cv is None else round(cv, 3), "touching_structural": touching,
        "structural_lines": len(lines),
    }  # fmt: skip


def schedule_rows(job: str, page: int) -> dict:
    """Rows with a mark-like token and a profile in the same row (words grouped by y)."""
    with common.open_doc(job) as doc:
        p = doc[page]
        m = p.rotation_matrix
        words = []
        for w in p.get_text("words"):
            r = __import__("pymupdf").Rect(w[:4]) * m
            r.normalize()
            words.append(((r.y0 + r.y1) / 2, r.x0, r.height, w[4]))
    words.sort()
    rows: list[list] = []
    for w in words:
        if rows and abs(rows[-1][0][0] - w[0]) <= 0.5 * max(w[2], 1):
            rows[-1].append(w)
        else:
            rows.append([w])
    hit = marks_only = 0
    for row in rows:
        row.sort(key=lambda t: t[1])
        toks = [t[3].strip(",;:()") for t in row]
        has_mark = any(MARK_RE.match(t.upper()) for t in toks)
        has_prof = bool(find_profiles(normalize(" ".join(toks))))
        hit += has_mark and has_prof
        marks_only += has_mark and not has_prof
    return {"rows": len(rows), "mark_and_profile_rows": hit, "mark_only_rows": marks_only}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    args = ap.parse_args()
    sel = json.loads((common.STUDY / "selection.json").read_text())["selection"]
    out: dict[str, dict] = {}
    for job in args.jobs.split(","):
        struct = candidates.load_structural(job)
        pages = sel[job]["plan_pages"]
        out[job] = {
            "plan_pages": {str(p): analyse_page(job, p, struct.get(p, set())) for p in pages}
        }
        sched = sorted(
            {*sel[job]["schedule_pages"], *sel[job]["legend_pages"], *sel[job]["elevation_pages"]}
        )
        out[job]["schedule_like_pages"] = {str(p): schedule_rows(job, p) for p in sched}
        # whole-document scan for mark+profile row tables (large pages)
        with common.open_doc(job) as doc:
            allp = common.large_pages(doc)
        out[job]["doc_pages_with_3plus_mark_profile_rows"] = sum(
            1 for p in allp if schedule_rows(job, p)["mark_and_profile_rows"] >= 3
        )
        tot = Counter()
        for v in out[job]["plan_pages"].values():
            tot["shapes"] += v["shapes"]
            tot["in_modal_cluster"] += v["in_modal_cluster"] or 0
            tot["touching"] += v["touching_structural"]
        print(
            job,
            dict(tot),
            "schedule-like pages:",
            out[job]["doc_pages_with_3plus_mark_profile_rows"],
        )
    (common.STUDY / "columns_results.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
