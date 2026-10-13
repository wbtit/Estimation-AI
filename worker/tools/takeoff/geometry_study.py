"""Step 3: geometry study of the length markups against our reconstructed lines (M1 to M6, see
docs/PHASE5T_PREREGISTRATION.md). Read-only. Prints counts only; raw per-markup results go to the
git-ignored private folder. Deterministic; no network except the local API for the confirmed scales.

usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.geometry_study [job-0NN ...]
"""

from __future__ import annotations

import collections
import json
import math
import re
import sys
import urllib.request

import numpy as np
import pymupdf

from src.linking.candidates import RADIUS_PT, candidates_for
from src.linking.labels import page_labels
from src.linking.lines import page_lines
from src.linking.rules import propose
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.pdf_scan.analyze import analyze_page
from src.text_layer.parsers.dimension import find_dimensions
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents

TOLS = (6.0, 3.0, 12.0)  # primary first
MATCH_SHARE = 0.8
MIN_MARKUP_PT = 3.0
API = "http://127.0.0.1:3000"
BANDS = [(0.25, "<0.25"), (0.75, "0.25-0.75"), (1.25, "0.75-1.25"), (1e9, ">1.25")]
UNIT_INCH = {"in": 1.0, "ft": 12.0, "mm": 1 / 25.4, "m": 1000 / 25.4, "cm": 10 / 25.4, "yd": 36.0}


def band(r: float) -> str:
    for hi, name in BANDS:
        if r < hi:
            return name
    return ">1.25"


def vertices_of(a: pymupdf.Annot, page: pymupdf.Page) -> list[tuple[float, float]]:
    v = a.vertices or []
    m = page.rotation_matrix
    return [tuple(pymupdf.Point(p) * m) for p in v]


def poly_length(v: list[tuple[float, float]]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(v, v[1:], strict=False))


def samples_along(v: list[tuple[float, float]], step: float = 1.0) -> np.ndarray:
    pts = []
    for a, b in zip(v, v[1:], strict=False):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for k in range(n + 1):
            t = k / n
            pts.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return np.array(pts)


def dist_points_segments(pts: np.ndarray, segs: np.ndarray) -> np.ndarray:
    """(n_points x n_segments) distances."""
    ax, ay, bx, by = segs[:, 0], segs[:, 1], segs[:, 2], segs[:, 3]
    dx, dy = bx - ax, by - ay
    l2 = np.maximum(dx * dx + dy * dy, 1e-9)
    px, py = pts[:, 0][:, None], pts[:, 1][:, None]
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def measure_scale(obj: str, doc: pymupdf.Document) -> tuple[float, str] | None:
    """(unit-per-point factor C, unit name) from the annotation's /Measure number format, if any."""
    m = re.search(r"/Measure\s+(\d+) 0 R", obj)
    mtxt = (
        doc.xref_object(int(m.group(1)), compressed=False)
        if m
        else (re.search(r"/Measure\s*<<.*", obj, re.S).group(0) if "/Measure" in obj else "")
    )
    if not mtxt:
        return None
    x = re.search(r"/X\s*\[\s*(?:(\d+) 0 R|<<(.*?)>>)", mtxt, re.S)
    body = (
        doc.xref_object(int(x.group(1)), compressed=False)
        if x and x.group(1)
        else (x.group(2) if x else "")
    )
    c = re.search(r"/C\s+([-\d.eE]+)", body)
    u = re.search(r"/U\s*\(([^)]*)\)", body)
    if not c or not u:
        return None
    unit = u.group(1).strip().lower().rstrip(".")
    unit = {
        "inch": "in",
        "inches": "in",
        "foot": "ft",
        "feet": "ft",
        "'": "ft",
        '"': "in",
        "millimeter": "mm",
        "millimeters": "mm",
        "meter": "m",
    }.get(unit, unit)
    return (float(c.group(1)), unit) if unit in UNIT_INCH else None


def ratio_from_measure(ms: tuple[float, str]) -> float:
    c, unit = ms
    return c * 72.0 * UNIT_INCH[unit]  # real inches per drawn inch = real length / drawn length


def api(path: str):
    try:
        return json.loads(urllib.request.urlopen(API + path, timeout=60).read())
    except Exception:  # noqa: BLE001
        return None


def study_inputs():
    split = json.loads((PRIVATE / "study" / "split.json").read_text())
    sample = {}
    for j, d in json.loads((PRIVATE / "study" / "labels_sample.json").read_text()).items():
        for lab in d["sample"]:
            sample[(j, lab["page"])] = sample.get((j, lab["page"]), []) + [
                (lab["bbox"], lab["label_id"])
            ]
    return split, sample


def study_half(split, sample, job, pidx, bbox) -> str:
    for bb, lid in sample.get((job, pidx), []):
        if max(abs(bb[i] - bbox[i]) for i in range(4)) <= 2.0:
            return split.get(lid, "outside sample")
    return "outside sample"


def run_job(job: str, tpath, tinfo, doc_path, tag: dict) -> dict:
    classes_file = PRIVATE / "study" / job / "structural_classes.json"
    study_classes = json.loads(classes_file.read_text()) if classes_file.exists() else {}
    split, sample = study_inputs()
    cal = (
        json.loads((PRIVATE / "study" / "phase5c_calibration.json").read_text())
        if (PRIVATE / "study" / "phase5c_calibration.json").exists()
        else {}
    )
    cal_pid = cal.get(job, {}).get("project")
    cal_members, cal_sheets = {}, {}
    if cal_pid:
        sh = api(f"/api/projects/{cal_pid}/sheets")
        ms = api(f"/api/projects/{cal_pid}/members?include_deleted=true")
        if sh and ms:
            cal_sheets = {s["id"]: s["page_number"] for s in sh["sheets"]}
            for m in ms["members"]:
                if m["link"]["line"]:
                    ln = m["link"]["line"]
                    key = (
                        cal_sheets[m["sheet_id"]] - 1,
                        tuple(round(v) for v in (ln["p"][0], ln["p"][1], ln["q"][0], ln["q"][1])),
                    )
                    cal_members.setdefault(key, set()).add(m["id"])
    res: dict = {
        "markups_total": 0,
        "length_markups": 0,
        "by_tol": {},
        "unmatched": collections.Counter(),
        "rows": [],
    }
    for t in TOLS:
        res["by_tol"][t] = {
            "matched": 0,
            "bands": collections.Counter(),
            "per_line": collections.Counter(),
        }
    page_map = {int(k): v for k, v in tinfo["page_map"].items()}
    tdoc, ddoc = pymupdf.open(tpath), pymupdf.open(doc_path)
    for tp, dp in sorted(page_map.items()):
        tpage = tdoc[tp]
        marks = [a for a in (tpage.annots() or []) if a.type[1] in ("Line", "PolyLine")]
        n_other = sum(1 for a in (tpage.annots() or []))
        res["markups_total"] += n_other
        if not marks:
            continue
        dpage = ddoc[dp]
        scan = analyze_page(dpage)
        size = (dpage.rect.width, dpage.rect.height)
        lines = page_lines(dpage)
        in_view = lines_in_box(lines, (0, 0, size[0], size[1]), size)
        table = class_table(in_view)
        if dp in [int(k) for k in study_classes] if study_classes else False:
            classes = study_classes[str(dp)]["structural"]
            class_src = "study"
        else:
            classes = suggest_classes(table)
            class_src = "suggested"
        res.setdefault("class_source", collections.Counter())[class_src] += 1
        structural = [ln for ln in in_view if ln.klass in classes and ln.length >= MIN_MARKUP_PT]
        segs = (
            np.array([[l.x0, l.y0, l.x1, l.y1] for l in structural])
            if structural
            else np.zeros((0, 4))
        )
        labels = [lb for lb in page_labels(dpage, f"{job}-{dp}") if lb.kind == "profile"]
        # the scale we use: the confirmed study view scale of this page, else the page's single scale
        ours = None
        ours = scan.scale_parsed_ratio
        for a in marks:
            v = vertices_of(a, tpage)
            if len(v) < 2:
                continue
            length = poly_length(v)
            if length < MIN_MARKUP_PT:
                res["unmatched"]["other (shorter than 3 pt)"] += 1
                continue
            res["length_markups"] += 1
            obj = tdoc.xref_object(a.xref, compressed=False)
            ms = measure_scale(obj, tdoc)
            text = " ".join([(a.info.get("content") or ""), (a.info.get("subject") or "")])
            dims = find_dimensions(text)
            stored_mm = dims[0].mm if dims else None
            profs = find_profiles(text)
            all_segs = np.array(
                [[ln_.x0, ln_.y0, ln_.x1, ln_.y1] for ln_ in lines if ln_.length >= MIN_MARKUP_PT]
            )
            pts0 = samples_along(v)
            any_share = 0.0
            if len(all_segs):
                any_share = float(
                    ((dist_points_segments(pts0, all_segs) <= TOLS[0]).sum(axis=0).max())
                    / len(pts0)
                )
            row = {
                "ratio_markup": round(ratio_from_measure(ms), 3) if ms else None,
                "ratio_ours": ours,
                "any_class_share": round(any_share, 2),
                "page": tp,
                "len_pt": round(length, 1),
                "has_measure": ms is not None,
                "has_stored": stored_mm is not None,
                "profile": bool(profs),
            }
            pts = samples_along(v)
            best = None
            if len(segs):
                d = dist_points_segments(pts, segs)
                for tol in TOLS:
                    near = (d <= tol).sum(axis=0)
                    k = int(near.argmax())
                    share = near[k] / len(pts)
                    ok = share >= MATCH_SHARE
                    row[f"match@{tol:g}"] = ok
                    if tol == TOLS[0]:
                        best = (k, share) if ok else None
                    bt = res["by_tol"][tol]
                    if ok:
                        bt["matched"] += 1
                        ratio = length / structural[k].length
                        bt["bands"][band(ratio)] += 1
                        bt["per_line"][(dp, k)] += 1
            else:
                for tol in TOLS:
                    row[f"match@{tol:g}"] = False
            outside = any(not (0 <= x <= size[0] and 0 <= y <= size[1]) for x, y in v)
            if best is None:
                if outside:
                    reason = "off-sheet"
                elif scan.page_kind != "vector" or scan.image_coverage >= 0.5:
                    reason = "raster underlay"
                elif (
                    stored_mm is not None
                    and ms
                    and ours
                    and abs(length * 25.4 / 72 * ours - stored_mm) / stored_mm > 0.10
                ):
                    reason = "scale mismatch"
                else:
                    reason = "not on any structural line"
                res["unmatched"][reason] += 1
                row["unmatched"] = reason
                res["rows"].append(row)
                continue
            k, share = best
            ln = structural[k]
            row["ratio"] = round(length / ln.length, 3)
            row["line_len_pt"] = round(ln.length, 1)
            row["line_key"] = [dp, k]
            row["shared_in_system"] = (
                len(
                    cal_members.get((dp, tuple(round(x) for x in (ln.x0, ln.y0, ln.x1, ln.y1))), ())
                )
                > 1
                if cal_members
                else None
            )
            # M5(a)
            if ms and stored_mm:
                geo = length * ms_to_mm(ms)
                row["m5a_rel"] = round(abs(geo - stored_mm) / stored_mm, 4)
            # M5(b)
            if ms and ours:
                theirs = length * ms_to_mm(ms)
                system = ln.length * 25.4 / 72 * ours
                row["m5b_rel"] = round(abs(system - theirs) / theirs, 4) if theirs else None
            # M4 / M6
            if profs:
                canon = {p.canonical for p in profs}
                near = []
                for lb in labels:
                    if lb.canonical not in canon:
                        continue
                    cx = np.clip(pts[:, 0], lb.bbox[0], lb.bbox[2])
                    cy = np.clip(pts[:, 1], lb.bbox[1], lb.bbox[3])
                    near.append((float(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy).min()), lb))
                near = [n for n in near if n[0] <= RADIUS_PT]
                row["label_within_150"] = bool(near)
                if near:
                    dist, lb = min(near, key=lambda n: n[0])
                    prop = propose(candidates_for(lb.bbox, lb.angle_deg, structural))
                    row["m6_conf"] = prop.confidence
                    row["m6_half"] = study_half(split, sample, job, dp, lb.bbox)
                    if not prop.ranked:
                        row["m6"] = "no candidate"
                    else:

                        def same(a_, b_):
                            return (
                                max(
                                    abs(a_.x0 - b_.x0),
                                    abs(a_.y0 - b_.y0),
                                    abs(a_.x1 - b_.x1),
                                    abs(a_.y1 - b_.y1),
                                )
                                <= 0.6
                                or max(
                                    abs(a_.x0 - b_.x1),
                                    abs(a_.y0 - b_.y1),
                                    abs(a_.x1 - b_.x0),
                                    abs(a_.y1 - b_.y0),
                                )
                                <= 0.6
                            )

                        if same(prop.best.candidate.line, ln):
                            row["m6"] = "correct"
                        else:
                            top3 = [r.candidate.line for r in prop.ranked[:3]]
                            row["m6"] = (
                                "wrong line, right line in top 3"
                                if any(same(t_, ln) for t_ in top3)
                                else "wrong line, right line not in top 3"
                            )
            res["rows"].append(row)
    res["by_tol"] = {
        t: {
            "matched": v["matched"],
            "bands": dict(v["bands"]),
            "per_line": dict(collections.Counter(min(c, 3) for c in v["per_line"].values())),
        }
        for t, v in res["by_tol"].items()
    }
    res["unmatched"] = dict(res["unmatched"])
    res["class_source"] = dict(res.get("class_source", {}))
    return res


def ms_to_mm(ms: tuple[float, str]) -> float:
    c, unit = ms
    return c * UNIT_INCH[unit] * 25.4


def main(argv: list[str]) -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    out = {}
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job or (argv and job not in argv):
            continue
        r = run_job(job, TAKEOFFS / name, info, draws[job], {})
        out[job] = r
        t6 = r["by_tol"][6.0]
        print(
            f"{job}: markups {r['markups_total']} (all subtypes on mapped pages), length markups {r['length_markups']}, matched@6 {t6['matched']}, unmatched {r['unmatched']}"
        )
    (TAKEOFFS / "geometry.json").write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
