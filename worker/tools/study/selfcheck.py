"""STEP 6: self-consistency checks without a takeoff (descriptive, not tuned).

(a) dimension strings: the printed value against the distance between the two arrowheads that flank
    the string on the same level (x page scale), and against the nearest parallel structural line
    (length x page scale). Scale = the page's single parsed scale, else the page is skipped.
(b) mark and legend completeness: marks that appear in legend-like lines (mark followed by a profile)
    against mark-shaped tokens elsewhere on the selected pages.
(c) quantity notes: "(N) profile" against the number of near-coincident parallel lines of similar
    length around the nearest candidate line.
stdout: counts and rates only; details in selfcheck_results.json.
"""

import argparse
import json
import math
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidates  # noqa: E402
import common  # noqa: E402
import pymupdf  # noqa: E402
from src.pdf_scan.textlines import page_words_and_lines  # noqa: E402
from src.pdf_scan.textscan import scan_text  # noqa: E402
from src.text_layer.parsers.dimension import find_dimensions  # noqa: E402
from src.text_layer.parsers.marks import MARK_RE  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

AGREE_REL, AGREE_ABS_MM = 0.03, 50.0  # agreement: within 3% or 50 mm
ADJACENT_PT = 45.0
LEVEL_TOL = 3.0
MM_PER_PT = 25.4 / 72.0


def page_scale(page: pymupdf.Page) -> float | None:
    words, lines = page_words_and_lines(page)
    found = scan_text(words, lines, page.rect.width, page.rect.height)
    ratios = {s["ratio"] for s in found.scales if s["kind"] == "ratio"}
    return ratios.pop() if len(ratios) == 1 else None


def arrowheads(job: str, page: int) -> list[tuple[float, float]]:
    dump = json.loads((common.doc_dir(job) / f"page_{page}.json").read_text())
    return [
        ((s["bbox"][0] + s["bbox"][2]) / 2, (s["bbox"][1] + s["bbox"][3]) / 2)
        for s in dump["shapes"]
        if s["filled"] and 3 <= s["items"] <= 4 and max(s["bbox"][2] - s["bbox"][0], s["bbox"][3] - s["bbox"][1]) <= 14
    ]  # fmt: skip


def agree(printed: float, measured: float) -> bool:
    return abs(printed - measured) <= max(AGREE_REL * printed, AGREE_ABS_MM)


def dimension_checks(job: str, page_idx: int, struct: set[str]) -> dict:
    out = Counter()
    errs_arrow: list[float] = []
    errs_line: list[float] = []
    with common.open_doc(job) as doc:
        page = doc[page_idx]
        scale = page_scale(page)
        out["pages"] += 1
        if scale is None:
            out["pages_without_unique_scale"] += 1
            return {"counts": dict(out), "errs_arrow": errs_arrow, "errs_line": errs_line}
        m = page.rotation_matrix
        heads = arrowheads(job, page_idx)
        lines = candidates.structural_lines_for(job, page_idx, struct)
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for ln in block["lines"]:
                text = "".join(sp["text"] for sp in ln["spans"])
                dims = find_dimensions(text)
                if not dims:
                    continue
                r = pymupdf.Rect(ln["bbox"]) * m
                r.normalize()
                cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
                horizontal = (
                    abs(ln["dir"][1]) < 0.2
                    if page.rotation in (0, 180)
                    else abs(ln["dir"][0]) < 0.2
                )
                for d in dims:
                    out["dimension_strings"] += 1
                    printed = d.mm
                    # (a1) flanking arrowheads on the same level
                    left = [
                        h for h in heads if h[0] < cx and abs(h[1] - cy) <= 14 and cx - h[0] <= 400
                    ]
                    right = [
                        h for h in heads if h[0] > cx and abs(h[1] - cy) <= 14 and h[0] - cx <= 400
                    ]
                    pair = [(a, b) for a in left for b in right if abs(a[1] - b[1]) <= LEVEL_TOL]
                    if horizontal and pair:
                        a, b = min(pair, key=lambda t: t[1][0] - t[0][0])
                        measured = (b[0] - a[0]) * MM_PER_PT * scale
                        out["arrowhead_pairs"] += 1
                        ok = agree(printed, measured)
                        out["arrowhead_agree"] += ok
                        errs_arrow.append((measured - printed) / printed if printed else 0.0)
                    # (a2) nearest parallel structural line
                    par = []
                    for ln2 in lines:
                        (px, py), (qx, qy) = ln2["p"], ln2["q"]
                        ang = math.degrees(math.atan2(qy - py, qx - px)) % 180
                        want = 0.0 if horizontal else 90.0
                        if min(abs(ang - want), 180 - abs(ang - want)) > 8:
                            continue
                        dist = abs((qx - px) * (py - cy) - (px - cx) * (qy - py)) / (
                            ln2["length"] or 1
                        )
                        t = ((cx - px) * (qx - px) + (cy - py) * (qy - py)) / (
                            ln2["length"] ** 2 or 1
                        )
                        if dist <= ADJACENT_PT and 0 <= t <= 1:
                            par.append((dist, ln2))
                    if par:
                        out["adjacent_parallel_line"] += 1
                        _, nearest = min(par, key=lambda t: t[0])
                        measured = nearest["length"] * MM_PER_PT * scale
                        out["line_agree"] += agree(printed, measured)
                        errs_line.append((measured - printed) / printed if printed else 0.0)
    return {"counts": dict(out), "errs_arrow": errs_arrow, "errs_line": errs_line}


def legend_completeness(job: str, pages: list[int]) -> dict:
    legend: set[str] = set()
    used: Counter = Counter()
    with common.open_doc(job) as doc:
        for i in pages:
            for block in doc[i].get_text("dict")["blocks"]:
                if block["type"] != 0:
                    continue
                for ln in block["lines"]:
                    text = re.sub(r"\s+", " ", "".join(sp["text"] for sp in ln["spans"])).strip()
                    toks = [t.strip(",;:()") for t in text.split()]
                    marks = [t.upper() for t in toks if MARK_RE.match(t.upper())]
                    if marks and find_profiles(text):
                        # mark followed by a profile in the same line: a legend-like or schedule-like row
                        if len(toks) <= 8:
                            legend.update(marks)
                            continue
                    for mk in marks:
                        used[mk] += 1
    used_set = set(used)
    return {
        "legend_marks": len(legend), "marks_used_elsewhere": len(used_set),
        "used_and_in_legend": len(used_set & legend), "used_not_in_legend": len(used_set - legend),
        "legend_not_used": len(legend - used_set),
    }  # fmt: skip


def quantity_checks(job: str, data: dict, cands: dict) -> dict:
    out = Counter()
    for lab in data["sample"]:
        if not lab["quantity_prefix"]:
            continue
        out["quantity_labels_in_sample"] += 1
        c = cands[lab["label_id"]]["candidates"]
        if not c:
            out["without_candidates"] += 1
            continue
        best = c[0]
        near = [
            x
            for x in c
            if x["rel_angle"] <= 10 and abs(x["length"] - best["length"]) <= 0.1 * best["length"]
        ]
        out["with_candidates"] += 1
        out["stacked_parallel_lines_ge2"] += len(near) >= 2
    return dict(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    args = ap.parse_args()
    sel = json.loads((common.STUDY / "selection.json").read_text())["selection"]
    sample = json.loads((common.STUDY / "labels_sample.json").read_text())
    cands = json.loads((common.STUDY / "labels_candidates.json").read_text())
    result: dict[str, dict] = {}
    for job in args.jobs.split(","):
        struct = candidates.load_structural(job)
        agg: Counter = Counter()
        ea: list[float] = []
        el: list[float] = []
        for p in sel[job]["plan_pages"]:
            r = dimension_checks(job, p, struct.get(p, set()))
            agg.update(r["counts"])
            ea += r["errs_arrow"]
            el += r["errs_line"]
        pages = sorted(
            {*sel[job]["plan_pages"], *sel[job]["schedule_pages"], *sel[job]["legend_pages"]}
        )
        result[job] = {
            "dimension": dict(agg),
            "arrow_median_abs_rel_err": None
            if not ea
            else round(statistics.median(abs(x) for x in ea), 4),
            "line_median_abs_rel_err": None
            if not el
            else round(statistics.median(abs(x) for x in el), 4),
            "legend": legend_completeness(job, pages),
            "quantity": quantity_checks(job, sample[job], cands),
        }
        print(job, result[job]["dimension"], result[job]["legend"], result[job]["quantity"])
    (common.STUDY / "selfcheck_results.json").write_text(json.dumps(result, indent=1))


if __name__ == "__main__" and "--quantity-pool" not in sys.argv:
    main()


def quantity_pool(job: str, pages: list[int], struct: dict) -> dict:
    """(c) over ALL profile labels of the plan pages (not only the sample): a quantity prefix (N)
    against the number of near-coincident parallel lines of similar length around the nearest line."""
    import labels

    out = Counter()
    for p in pages:
        lab, _ = labels.page_labels(job, p)
        lines = candidates.structural_lines_for(job, p, struct.get(p, set()))
        for item in lab:
            if not item["quantity_prefix"]:
                continue
            out["quantity_labels"] += 1
            cs = candidates.candidates_for(item, lines)
            if not cs:
                out["without_candidates"] += 1
                continue
            best = cs[0]
            near = [
                c for c in cs
                if c["rel_angle"] <= 10 and abs(c["length"] - best["length"]) <= 0.1 * best["length"]
            ]  # fmt: skip
            out["with_candidates"] += 1
            out["stacked_parallel_lines_ge2"] += len(near) >= 2
    return dict(out)


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--quantity-pool":
    sel_ = json.loads((common.STUDY / "selection.json").read_text())["selection"]
    for job_ in sel_:
        print(job_, quantity_pool(job_, sel_[job_]["plan_pages"], candidates.load_structural(job_)))
