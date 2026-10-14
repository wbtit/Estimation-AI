"""Phase 7 Part B: member-geometry re-scoring (docs/PHASE7_PREREGISTRATION.md section 3).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_partb build    # pieces with geometry, 136 pages
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_partb score    # matching, controls, tables

`build` needs the read-only API on PHASE6B_API (default http://127.0.0.1:3100) because the counted
labels of Phase 6b are the API's members. Our side is the PDF the API stored for the job's project.
Outputs (git-ignored): fixtures/private/takeoffs/phase7_pieces.json, phase7_partb.json.
"""

from __future__ import annotations

import collections
import json
import random
import sys

import numpy as np
import pymupdf

from src.linking.labels import page_labels
from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff import phase7_lib as L
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_lib import verdict
from tools.takeoff.phase6b_study import (
    BASES,
    bases_for,
    bbox_key,
    f1_at12,
    is_raster,
    project_data,
    score_pieces,
    their_symbols,
)
from tools.takeoff.phase6c_census import page_plan
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

PIECES = TAKEOFFS / "phase7_pieces.json"
RESULT = TAKEOFFS / "phase7_partb.json"
MODES = ("suggested", "oracle")
LARGEST_TWO = ("job-012", "job-015")


# ---- build ----------------------------------------------------------------------------------------
def centre(b) -> list[float]:
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]


def piece_json(p, basis: str) -> dict:
    x0, y0, x1, y1 = p.line
    pt = (
        centre(p.box)
        if p.box is not None and basis != "line_first"
        else [(x0 + x1) / 2, (y0 + y1) / 2]
    )
    return {"line": [x0, y0, x1, y1], "pt": pt, "colour": p.colour}


def page_record(page, sheet, members, marks, syms) -> dict:
    size = (page.rect.width, page.rect.height)
    b = whole_sheet_box(*size)
    box = (b["x0"], b["y0"], b["x1"], b["y1"])
    in_view = lines_in_box(page_lines(page), box, size)
    table = class_table(in_view)
    suggested = suggest_classes(table)
    labels_all = [
        lb
        for lb in page_labels(page, sheet["id"], marks)
        if box[0] <= (lb.bbox[0] + lb.bbox[2]) / 2 <= box[2]
        and box[1] <= (lb.bbox[1] + lb.bbox[3]) / 2 <= box[3]
    ]
    counted = {
        bbox_key(m["bbox"]): m
        for m in members
        if m["bbox"]
        and m["counting"] == "counted"
        and not m["deleted"]
        and m["merged_into"] is None
        and m["not_member"] is None
        and not m["existing"]
    }
    labels = [lb for lb in labels_all if bbox_key(lb.bbox) in counted]
    colours = {k: m["status"]["color"] for k, m in counted.items()}
    xy = [(s["x"], s["y"]) for s in syms]

    def run(classes):
        return bases_for(labels, [ln for ln in in_view if ln.klass in classes], colours)

    main = run(suggested)
    best = {}
    for k in BASES:
        sc = score_pieces(xy, main[k])
        best[k] = (sc, main[k], suggested, f1_at12(sc, len(xy)))
    for c in (c for c in table if c.lines >= 3 and [c.key] != suggested):
        res = run([c.key])
        for k in BASES:
            sc = score_pieces(xy, res[k])
            f = f1_at12(sc, len(xy))
            cur = best[k]
            if (f, -abs(sc["pieces"] - len(xy))) > (cur[3], -abs(cur[0]["pieces"] - len(xy))):
                best[k] = (sc, res[k], [c.key], f)
    rec: dict = {
        "box": list(box),
        "symbols": xy,
        "suggested_classes": suggested,
        "labels_counted": len(labels),
        "bases": {},
    }
    for mode in MODES:
        rec["bases"][mode] = {}
        for k in BASES:
            if mode == "suggested":
                pieces = main[k]
                classes = suggested
                g6b = score_pieces(xy, pieces)
            else:
                g6b, pieces, classes, _ = best[k]
            rec["bases"][mode][k] = {
                "classes": classes,
                "pieces": [piece_json(p, k) for p in pieces],
                "greedy6b": {str(r): g6b[f"matched_{r}"] for r in (6, 12, 24)},
            }
    keys_linked = {p.key for p in main["label_first"]}
    rec["label_only"] = [
        {"pt": centre(lb.bbox), "colour": colours.get(bbox_key(lb.bbox))}
        for lb in labels
        if lb.key not in keys_linked
    ]
    return rec


def cmd_build() -> None:
    plan = page_plan(False)
    runs = json.loads(RUNS.read_text())
    conn = connect()
    cache: dict[str, dict] = {}
    pages: list[dict] = []
    docs: dict[str, pymupdf.Document] = {}
    for n, item in enumerate(plan):
        job = item["job"]
        if job not in cache:
            pid = runs[job]["project_id"]
            cache[job] = project_data(pid)
            cache[job]["pdf"] = stored_pdf(conn, pid)
            docs[job] = pymupdf.open(cache[job]["pdf"])
        data = cache[job]
        with pymupdf.open(TAKEOFFS / item["file"]) as tdoc:
            syms = their_symbols(tdoc[item["tp"]])
        sheet = data["sheets"].get(item["mapped_dp"])
        rec = {
            "job": job,
            "tp": item["tp"],
            "dp": item["mapped_dp"],
            "n_theirs": len(syms),
            "raster": bool(sheet is None or is_raster(sheet)),
        }
        if rec["raster"]:
            rec.update(
                {
                    "box": None,
                    "symbols": [(s["x"], s["y"]) for s in syms],
                    "bases": {},
                    "label_only": [],
                }
            )
        else:
            mem = [m for m in data["members"] if m["sheet_id"] == sheet["id"]]
            rec.update(page_record(docs[job][item["mapped_dp"]], sheet, mem, data["marks"], syms))
        pages.append(rec)
        print(n + 1, len(plan), job, item["mapped_dp"], flush=True)
    PIECES.write_text(json.dumps({"pages": pages}, default=list))


# ---- scoring --------------------------------------------------------------------------------------
def geoms_of(pieces: list[dict], how: str) -> list[dict]:
    if how == "geometry":
        return [{"k": "poly", "pts": [p["line"][:2], p["line"][2:]]} for p in pieces]
    return [{"k": "point", "p": p["pt"]} for p in pieces]


def counts_at(d: np.ndarray, n_syms: int, n_pieces: int, how: str) -> dict:
    out = {}
    for r in L.RADII:
        pairs = L.hungarian_pairs(d, r) if how == "hungarian" else L.greedy_pairs(d, r)
        out[int(r)] = len(pairs)
    return out


def tally(rows: list[dict]) -> dict:
    """Pool pages: matched per radius, pieces, symbols; page agreement."""
    res: dict = {"pages": len(rows), "theirs": sum(r["theirs"] for r in rows)}
    res["pieces"] = sum(r["pieces"] for r in rows)
    for r in L.RADII:
        m = sum(x["matched"][int(r)] for x in rows)
        p, rc, f = L.prf(m, res["pieces"], res["theirs"])
        res[f"m{int(r)}"], res[f"P{int(r)}"], res[f"R{int(r)}"], res[f"F{int(r)}"] = m, p, rc, f
    eq = sum(x["pieces"] == x["theirs"] for x in rows)
    w1 = sum(abs(x["pieces"] - x["theirs"]) <= 1 for x in rows)
    w20 = sum(
        x["theirs"] >= 1 and abs(x["pieces"] - x["theirs"]) <= 0.2 * x["theirs"] for x in rows
    )
    n = len(rows) or 1
    res["equal"], res["within1"], res["within20"] = eq / n, w1 / n, w20 / n
    res["verdict"] = verdict(res["within1"], res["P12"], res["R12"])
    return res


def cmd_score() -> None:
    pages = json.loads(PIECES.read_text())["pages"]
    methods = {
        "greedy_geometry": ("greedy", "geometry"),
        "hungarian_geometry": ("hungarian", "geometry"),
        "hungarian_point": ("hungarian", "point"),
    }
    # rows[(mode, basis, method)] -> list of per-page dicts
    rows: dict[tuple, list[dict]] = collections.defaultdict(list)
    ctl: dict[tuple, list[dict]] = collections.defaultdict(list)
    lab_only: list[dict] = []
    for idx, pg in enumerate(pages):
        syms = [tuple(s) for s in pg["symbols"]]
        n = len(syms)
        for mode in MODES:
            for basis in BASES:
                rec = pg["bases"].get(mode, {}).get(basis)
                pieces = rec["pieces"] if rec else []
                for name, (algo, how) in methods.items():
                    d = (
                        L.distance_matrix(syms, geoms_of(pieces, how))
                        if pieces
                        else np.zeros((n, 0))
                    )
                    rows[(mode, basis, name)].append(
                        {
                            "job": pg["job"],
                            "theirs": n,
                            "pieces": len(pieces),
                            "matched": counts_at(d, n, len(pieces), algo),
                            "g6b": {int(a): b for a, b in rec["greedy6b"].items()}
                            if rec
                            else {6: 0, 12: 0, 24: 0},
                        }
                    )
                # chance controls, geometry distance, exact matching
                if pg["box"] is None or not pieces:
                    for kind in ("uniform", "displaced"):
                        ctl[(mode, basis, kind)].append(
                            {
                                "job": pg["job"],
                                "theirs": n,
                                "pieces": len(pieces),
                                "matched": [{int(r): 0 for r in L.RADII}] * L.CONTROL_REPLICATES,
                            }
                        )
                    continue
                geoms = geoms_of(pieces, "geometry")
                segs = np.array([[*g["pts"][0], *g["pts"][1]] for g in geoms], dtype=float)
                box = tuple(pg["box"])
                for kind in ("uniform", "displaced"):
                    reps = []
                    for k in range(L.CONTROL_REPLICATES):
                        seed = (
                            L.CONTROL_SEED_UNIFORM
                            if kind == "uniform"
                            else L.CONTROL_SEED_DISPLACED
                        )
                        rng = random.Random(seed * 100000 + k * 1000 + idx)
                        pts = (
                            L.uniform_points(box, n, rng)
                            if kind == "uniform"
                            else L.displaced_points(syms, box, rng)
                        )
                        d = L.segment_matrix(np.asarray(pts, dtype=float), segs)
                        reps.append(counts_at(d, n, len(pieces), "hungarian"))
                    ctl[(mode, basis, kind)].append(
                        {"job": pg["job"], "theirs": n, "pieces": len(pieces), "matched": reps}
                    )
        # label-only pieces: added by their label point (label-first and line-with-label)
        lo = [{"k": "point", "p": q["pt"]} for q in pg["label_only"]]
        lab_only.append({"job": pg["job"], "theirs": n, "label_only": len(lo)})
        for basis in ("label_first", "line_with_label"):
            rec = pg["bases"].get("suggested", {}).get(basis)
            pieces = rec["pieces"] if rec else []
            geoms = geoms_of(pieces, "geometry") + lo
            d = L.distance_matrix(syms, geoms) if geoms else np.zeros((n, 0))
            rows[("suggested", basis, "hungarian_geometry_plus_label_only")].append(
                {
                    "job": pg["job"],
                    "theirs": n,
                    "pieces": len(geoms),
                    "matched": counts_at(d, n, len(geoms), "hungarian"),
                    "g6b": {6: 0, 12: 0, 24: 0},
                }
            )

    def split(rs: list[dict], without: bool) -> list[dict]:
        return [r for r in rs if not (without and r["job"] in LARGEST_TWO)]

    out: dict = {"tables": {}, "controls": {}, "per_job": {}, "label_only": {}}
    for key, rs in rows.items():
        for scope, without in (("all", False), ("without_largest_two", True)):
            out["tables"][f"{key[0]}|{key[1]}|{key[2]}|{scope}"] = tally(split(rs, without))
    for key, rs in ctl.items():
        for scope, without in (("all", False), ("without_largest_two", True)):
            sel = split(rs, without)
            per_rep = []
            for k in range(L.CONTROL_REPLICATES):
                t = tally([{**r, "matched": r["matched"][k]} for r in sel])
                per_rep.append(t)
            agg = {}
            for r in L.RADII:
                for m in ("P", "R", "F"):
                    vals = [t[f"{m}{int(r)}"] for t in per_rep if t[f"{m}{int(r)}"] is not None]
                    agg[f"{m}{int(r)}"] = (
                        [float(np.mean(vals)), float(np.std(vals))] if vals else [None, None]
                    )
            out["controls"][f"{key[0]}|{key[1]}|{key[2]}|{scope}"] = agg
    jobs = sorted({r["job"] for r in rows[("suggested", "label_first", "hungarian_geometry")]})
    for basis in BASES:
        for job in jobs:
            sel = [r for r in rows[("suggested", basis, "hungarian_geometry")] if r["job"] == job]
            out["per_job"][f"{basis}|{job}"] = tally(sel)
    out["label_only"] = {
        "pieces": sum(r["label_only"] for r in lab_only),
        "pages_with": sum(r["label_only"] > 0 for r in lab_only),
        "by_job": dict(
            collections.Counter(
                {j: sum(r["label_only"] for r in lab_only if r["job"] == j) for j in jobs}
            )
        ),
    }
    # reconciliation with the stored Phase 6b greedy counts (pooled, suggested class)
    rec6b = {}
    for basis in BASES:
        rs = rows[("suggested", basis, "greedy_geometry")]
        rec6b[basis] = {
            "recomputed": {str(r): sum(x["matched"][r] for x in rs) for r in (12, 24)},
            "published_6b": {str(r): sum(x["g6b"][r] for x in rs) for r in (12, 24)},
        }
    out["reconcile_6b"] = rec6b
    RESULT.write_text(json.dumps(out, indent=1))
    print("written", RESULT)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        cmd_build()
    elif cmd == "score":
        cmd_score()
    else:
        print(__doc__)
