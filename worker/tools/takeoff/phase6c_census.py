"""Phase 6c Part B: census of what sits under the estimators' symbols that have no line of the
suggested class within 24 pt, and the blind sample files.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_census run [--corrected]
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_census report [--corrected]
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_census sample

Our side is the PDF the API stored for the Phase 6b project of each job (no other source path).
`--corrected` re-reads the pages whose Phase 5t page map was found wrong in the Part A audit
(post hoc sensitivity; the pre-registered run uses the Phase 6b map).
"""

from __future__ import annotations

import collections
import json
import sys

import numpy as np
import pymupdf

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff import phase6c_lib as L
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_study import their_symbols
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

STUDY = TAKEOFFS / "phase6b_study.json"
FRAMES = TAKEOFFS / "phase6c_frame_all.json"


def out_path(corrected: bool):
    return TAKEOFFS / ("phase6c_census_corrected.json" if corrected else "phase6c_census.json")


def page_plan(corrected: bool) -> list[dict]:
    """(job, takeoff file, takeoff page, drawing page, stored 6b symbol flags or None) in the order
    of the Phase 6b records."""
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    study = json.loads(STUDY.read_text())["pages"]
    shift: dict[tuple[str, int], int] = {}
    if corrected:
        for job, pages in json.loads(FRAMES.read_text()).items():
            for p in pages:
                if p["best_offset"]:
                    shift[(job, p["takeoff_page"])] = p["best_offset"]
    plan: list[dict] = []
    k = 0
    with_syms = []
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job:
            continue
        with pymupdf.open(TAKEOFFS / name) as tdoc:
            for tp, dp in sorted((int(a), b) for a, b in info["page_map"].items()):
                if their_symbols(tdoc[tp]):
                    with_syms.append((job, name, tp, dp))
    assert len(with_syms) == len(study), (len(with_syms), len(study))
    for (job, name, tp, dp), rec in zip(with_syms, study, strict=True):
        assert rec["job"] == job and rec["page"] == dp
        plan.append(
            {
                "job": job,
                "file": name,
                "tp": tp,
                "dp": dp + shift.get((job, tp), 0),
                "mapped_dp": dp,
                "flags": rec["symbols"],
            }
        )
        k += 1
    return plan


def rect_near(x: float, y: float, rects: np.ndarray, r: float) -> bool:
    if len(rects) == 0:
        return False
    dx = np.maximum(np.maximum(rects[:, 0] - x, x - rects[:, 2]), 0)
    dy = np.maximum(np.maximum(rects[:, 1] - y, y - rects[:, 3]), 0)
    return bool((np.hypot(dx, dy) <= r).any())


def census_page(
    page: pymupdf.Page, doc: pymupdf.Document, syms: list[dict], sheet_id: str
) -> list[dict]:
    m = page.rotation_matrix
    size = (page.rect.width, page.rect.height)
    b = whole_sheet_box(*size)
    box = (b["x0"], b["y0"], b["x1"], b["y1"])
    lines = page_lines(page)
    in_view = lines_in_box(lines, box, size)
    suggested = suggest_classes(class_table(in_view))
    structural = [ln for ln in in_view if ln.klass in suggested]
    seg_s = np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in structural]) if structural else None
    seg_a = np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in lines]) if lines else None
    cls_a = [ln.klass for ln in lines]

    def nearest(segs, x, y):
        if segs is None:
            return None, None
        ax, ay, bx, by = segs[:, 0], segs[:, 1], segs[:, 2], segs[:, 3]
        dx, dy = bx - ax, by - ay
        l2 = np.maximum(dx * dx + dy * dy, 1e-9)
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1)
        d = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
        i = int(np.argmin(d))
        return float(d[i]), i

    # drawings
    paths = []
    prects = []
    for d in page.get_drawings(extended=True):
        if d.get("type") not in ("s", "f", "fs"):
            continue
        r = pymupdf.Rect(d["rect"]) * m
        r.normalize()
        paths.append((d, (r.x0, r.y0, r.x1, r.y1)))
        prects.append((r.x0, r.y0, r.x1, r.y1))
    prects_a = np.array(prects) if prects else np.zeros((0, 4))
    quads = L.form_quads(doc, page)
    qboxes = (
        np.array(
            [
                [
                    min(p[0] for p in q),
                    min(p[1] for p in q),
                    max(p[0] for p in q),
                    max(p[1] for p in q),
                ]
                for q in quads
            ]
        )
        if quads
        else np.zeros((0, 4))
    )

    def in_form(cx: float, cy: float) -> bool:
        if len(qboxes) == 0:
            return False
        idx = np.nonzero(
            (qboxes[:, 0] <= cx)
            & (cx <= qboxes[:, 2])
            & (qboxes[:, 1] <= cy)
            & (cy <= qboxes[:, 3])
        )[0]
        return any(L.inside_polygon(cx, cy, quads[i]) for i in idx)

    area = page.mediabox.width * page.mediabox.height

    def box_of(r) -> tuple[float, float, float, float]:
        r = pymupdf.Rect(r)
        r.normalize()
        return (r.x0, r.y0, r.x1, r.y1)

    infos = page.get_image_info()
    images = [
        box_of(pymupdf.Rect(im["bbox"]) * m)
        for im in infos
        if pymupdf.Rect(im["bbox"]).get_area() < L.BACKGROUND_IMAGE_SHARE * area
    ]
    bgs = [
        box_of(pymupdf.Rect(im["bbox"]) * m)
        for im in infos
        if pymupdf.Rect(im["bbox"]).get_area() >= L.BACKGROUND_IMAGE_SHARE * area
    ]
    word_list = page.get_text("words")
    words = (
        np.array([box_of(pymupdf.Rect(w[:4]) * m) for w in word_list])
        if word_list
        else np.zeros((0, 4))
    )

    out = []
    for s in syms:
        x, y = s["x"], s["y"]
        rec: dict = {"idx": s["idx"], "x": round(x, 2), "y": round(y, 2)}
        d_struct, _ = nearest(seg_s, x, y)
        rec["pop"] = d_struct is None or d_struct > L.RADIUS_PT
        rec["outside_box"] = not (box[0] <= x <= box[2] and box[1] <= y <= box[3])
        d_any, i_any = nearest(seg_a, x, y)
        rec["extracted_nearest"] = None if d_any is None else round(d_any, 2)
        rec["extracted_class"] = None if i_any is None else cls_a[i_any]
        if seg_a is not None:
            ax, ay, bx, by = seg_a[:, 0], seg_a[:, 1], seg_a[:, 2], seg_a[:, 3]
            dx, dy = bx - ax, by - ay
            l2 = np.maximum(dx * dx + dy * dy, 1e-9)
            t = np.clip(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1)
            dd = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
            near_i = np.nonzero(dd <= L.RADIUS_PT)[0]
        else:
            near_i = []
        rec["extracted_within24"] = int(len(near_i))
        rec["extracted_classes"] = dict(
            collections.Counter(cls_a[i] for i in near_i).most_common(6)
        )
        # primitives within 24 pt
        mask = (
            np.nonzero(
                (prects_a[:, 0] - L.RADIUS_PT <= x)
                & (x <= prects_a[:, 2] + L.RADIUS_PT)
                & (prects_a[:, 1] - L.RADIUS_PT <= y)
                & (y <= prects_a[:, 3] + L.RADIUS_PT)
            )[0]
            if len(prects_a)
            else []
        )
        kept = 0
        dropped = collections.Counter()
        detail = collections.Counter()
        nearest_dropped: tuple[float, str] | None = None
        for pi in mask:
            d, pbox = paths[pi]
            ptype = d["type"]
            filled = ptype in ("f", "fs")
            width = d.get("width") or 0.0
            n_items = len(d["items"])
            for it in d["items"]:
                kind, pts, closed = L.item_shape(it, m)
                if not pts:
                    continue
                dist = L.polyline_distance(x, y, pts, closed, filled and kind in ("re", "qu"))
                if dist > L.RADIUS_PT:
                    continue
                length = (
                    ((pts[0][0] - pts[-1][0]) ** 2 + (pts[0][1] - pts[-1][1]) ** 2) ** 0.5
                    if kind == "l"
                    else 1e9
                )
                cls = L.classify_primitive(ptype, kind, pbox, length)
                if cls == L.KEPT:
                    kept += 1
                    continue
                dropped[cls] += 1
                cx = sum(p[0] for p in pts) / len(pts)
                cy = sum(p[1] for p in pts) / len(pts)
                key = "|".join(
                    (
                        cls,
                        {"s": "stroke", "f": "fill", "fs": "both"}[ptype],
                        L.width_bucket(width) if ptype != "f" else "-",
                        L.path_size_bucket(n_items),
                        "form" if in_form(cx, cy) else "page",
                    )
                )
                detail[key] += 1
                if nearest_dropped is None or dist < nearest_dropped[0]:
                    nearest_dropped = (dist, cls)
        rec["kept_primitives"] = kept
        rec["dropped"] = dict(dropped)
        rec["dropped_detail"] = dict(detail)
        rec["nearest_dropped"] = (
            None if nearest_dropped is None else [round(nearest_dropped[0], 2), nearest_dropped[1]]
        )
        rec["in_form"] = in_form(x, y)
        rec["in_image"] = any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in images)
        rec["in_background_image"] = any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in bgs)
        rec["text_within24"] = rect_near(x, y, words, L.RADIUS_PT)
        out.append(rec)
    return out


def cmd_run(corrected: bool) -> None:
    runs = json.loads(RUNS.read_text())
    plan = page_plan(corrected)
    conn = connect()
    docs: dict[str, tuple] = {}
    result: list[dict] = []
    stored_mismatch = 0
    for k, pg in enumerate(plan):
        job = pg["job"]
        if job not in docs:
            pid = runs[job]["project_id"]
            sheets = {
                r["page_index"]: str(r["id"])
                for r in conn.execute(
                    "SELECT id, page_index FROM sheets WHERE project_id = %s", (pid,)
                )
            }
            docs[job] = (pymupdf.open(stored_pdf(conn, pid)), sheets)
        ddoc, sheets = docs[job]
        with pymupdf.open(TAKEOFFS / pg["file"]) as tdoc:
            syms = their_symbols(tdoc[pg["tp"]])
        for i, s in enumerate(syms):
            s["idx"] = i
        rows = census_page(ddoc[pg["dp"]], ddoc, syms, sheets[pg["dp"]])
        if not corrected:
            for r, fl in zip(rows, pg["flags"], strict=True):
                if r["pop"] != (not fl["any_line_24"]):
                    stored_mismatch += 1
        result.append(
            {
                "job": job,
                "tp": pg["tp"],
                "dp": pg["dp"],
                "mapped_dp": pg["mapped_dp"],
                "symbols": rows,
            }
        )
        pop = sum(r["pop"] for r in rows)
        print(
            f"{k + 1}/{len(plan)} {job} tp {pg['tp']} dp {pg['dp']}: {len(rows)} symbols, {pop} in population",
            flush=True,
        )
        out_path(corrected).write_text(
            json.dumps({"pages": result, "stored_mismatch": stored_mismatch})
        )
    print(
        "population:",
        sum(r["pop"] for p in result for r in p["symbols"]),
        "stored flag mismatches:",
        stored_mismatch,
    )


def category_of(r: dict) -> str:
    return L.census_category(
        other_class_line=r["extracted_within24"] > 0,
        dropped=bool(r["dropped"]),
        in_image=r["in_image"],
        text_near=r["text_within24"],
    )


def cmd_report(corrected: bool) -> dict:
    data = json.loads(out_path(corrected).read_text())
    pop = [(p["job"], r) for p in data["pages"] for r in p["symbols"] if r["pop"]]
    jobs_sizes = collections.Counter(p["job"] for p in data["pages"] for _ in p["symbols"])
    largest2 = {j for j, _ in jobs_sizes.most_common(2)}

    def table(items):
        n = len(items)
        cats = collections.Counter(category_of(r) for _, r in items)
        res = {"n": n, "categories": {c: cats.get(c, 0) for c in L.CATEGORIES}}
        a = collections.Counter(
            (r["nearest_dropped"] or [0, "none"])[1]
            for _, r in items
            if category_of(r) == L.CATEGORIES[1]
        )
        res["a_by_nearest_type"] = dict(a)
        res["a_with_type_present"] = {
            t: sum(1 for _, r in items if category_of(r) == L.CATEGORIES[1] and r["dropped"].get(t))
            for t in L.DROPPED_TYPES
        }
        zero = [r for _, r in items if category_of(r) == L.CATEGORIES[0]]
        bands = collections.Counter()
        for r in zero:
            d = r["extracted_nearest"]
            bands["<=6 pt" if d <= 6 else ("6-12 pt" if d <= 12 else "12-24 pt")] += 1
        res["zero_by_nearest_extracted"] = dict(bands)
        res["zero_median_lines_within24"] = (
            float(np.median([r["extracted_within24"] for r in zero])) if zero else None
        )
        cls = collections.Counter()
        for r in zero:
            if r["extracted_class"]:
                cls[r["extracted_class"].split("|")[0]] += 1
        res["zero_nearest_class_width"] = dict(cls.most_common(8))
        d_items = [r for _, r in items if category_of(r) == L.CATEGORIES[4]]
        res["d_outside_view_box"] = sum(1 for r in d_items if r["outside_box"])
        res["overlap_flags"] = {
            "text_within24": sum(1 for _, r in items if r["text_within24"]),
            "in_image": sum(1 for _, r in items if r["in_image"]),
            "in_background_image": sum(1 for _, r in items if r["in_background_image"]),
            "in_form": sum(1 for _, r in items if r["in_form"]),
            "any_dropped": sum(1 for _, r in items if r["dropped"]),
            "any_kept_primitive": sum(1 for _, r in items if r["kept_primitives"]),
        }
        agg = collections.Counter()
        for _, r in items:
            for k, v in r["dropped_detail"].items():
                agg[k] += v
        by = {
            "paint": collections.Counter(),
            "width": collections.Counter(),
            "size": collections.Counter(),
            "form": collections.Counter(),
        }
        for k, v in agg.items():
            t, paint, w, sz, fm = k.split("|")
            by["paint"][f"{t}/{paint}"] += v
            by["width"][w] += v
            by["size"][sz] += v
            by["form"][fm] += v
        res["dropped_primitives"] = {
            "total": sum(agg.values()),
            **{k: dict(v.most_common()) for k, v in by.items()},
        }
        return res

    out = {
        "all": table(pop),
        "without_two_largest": table([(j, r) for j, r in pop if j not in largest2]),
        "two_largest": sorted(largest2),
        "per_job": {j: table([(jj, r) for jj, r in pop if jj == j]) for j in sorted(jobs_sizes)},
        "all_symbols": sum(jobs_sizes.values()),
        "stored_mismatch": data.get("stored_mismatch"),
    }
    (
        TAKEOFFS
        / ("phase6c_census_summary_corrected.json" if corrected else "phase6c_census_summary.json")
    ).write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    corrected = "--corrected" in sys.argv
    if cmd == "run":
        cmd_run(corrected)
    elif cmd == "report":
        r = cmd_report(corrected)
        print(json.dumps(r["all"], indent=1))
    elif cmd == "sample":
        from tools.takeoff import phase6c_sample

        phase6c_sample.main()
    else:
        print(__doc__)
