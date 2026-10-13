"""Phase 6b: position-level scoring of three count bases against the estimators' count symbols.

Pre-registered in docs/PHASE6B_PREREGISTRATION.md (committed before any measurement on real drawings).
Counts and positions only; no job names, drawing text or tag text is printed or stored in git.
Subcommands (API on PHASE6B_API, default http://127.0.0.1:3100, and the worker running; from worker/):
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6b_study run      # upload the 16 clean drawings
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6b_study score    # Parts B, C, D (writes the json)
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6b_study shots    # Part E pictures
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6b_study report   # print the tables
"""

from __future__ import annotations

import collections
import json
import os
import sys
import time

import numpy as np
import pymupdf

from src.linking.candidates import candidates_for
from src.linking.labels import page_labels
from src.linking.lines import page_lines
from src.linking.rules import propose
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff import stage1_measure as s1
from tools.takeoff.colour_study import colour_key
from tools.takeoff.common import TAKEOFFS, drawing_documents
from tools.takeoff.phase6b_lib import (
    MIN_LINE_PT,
    RADII,
    Piece,
    distinct_lines,
    greedy_match,
    line_key,
    line_segment_class,
    lines_near_point,
    merge_lines,
    piece_miss_reason,
    prf,
    symbol_miss_reason,
)

API = os.environ.get("PHASE6B_API", "http://127.0.0.1:3100")
s1.API = API
OUT = TAKEOFFS / "phase6b_study.json"
RUNS = TAKEOFFS / "phase6b_projects.json"
BASES = ("label_first", "line_with_label", "line_first")
SMALL_SHAPE_PT = 40.0


# ---- reading ------------------------------------------------------------------------------------
def their_symbols(page: pymupdf.Page) -> list[dict]:
    m = page.rotation_matrix
    out = []
    for a in page.annots() or []:
        if a.type[1] != "Polygon":
            continue
        v = a.vertices or []
        if len(v) not in (3, 8):
            continue
        pts = [pymupdf.Point(p) * m for p in v]
        x = sum(p.x for p in pts) / len(pts)
        y = sum(p.y for p in pts) / len(pts)
        out.append(
            {"x": x, "y": y, "group": f"{colour_key((a.colors or {}).get('stroke'))}|{len(v)}v"}
        )
    return out


def bbox_key(b) -> tuple[float, float]:
    if isinstance(b, dict):
        return (round(b["x0"], 1), round(b["y0"], 1))
    return (round(b[0], 1), round(b[1], 1))


def small_shapes(page: pymupdf.Page) -> list[tuple[float, float, float, float]]:
    """Closed or rectangular shapes whose box is at most 40 pt on a side, aspect 0.5 to 2."""
    m = page.rotation_matrix
    out = []
    for d in page.get_cdrawings():
        r = pymupdf.Rect(d["rect"]) * m
        r.normalize()
        w, h = r.width, r.height
        if w <= 0 or h <= 0 or max(w, h) > SMALL_SHAPE_PT:
            continue
        closed = bool(d.get("closePath")) or any(it[0] == "re" for it in d["items"])
        if closed and 0.5 <= w / h <= 2.0:
            out.append((r.x0, r.y0, r.x1, r.y1))
    return out


# ---- bases on one page for one class set --------------------------------------------------------
def bases_for(
    labels: list, structural: list, colours: dict[tuple[float, float], str | None]
) -> dict:
    segs = (
        np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in structural])
        if structural
        else np.zeros((0, 4))
    )
    label_first: list[Piece] = []
    reach: set = set()
    for lb in labels:
        prop = propose(candidates_for(lb.bbox, lb.angle_deg, structural))
        for r in prop.ranked:
            ln = r.candidate.line
            reach.add(line_key((ln.x0, ln.y0, ln.x1, ln.y1)))
        best = prop.best
        if best is None:
            continue
        ln = best.candidate.line
        label_first.append(
            Piece(
                line=(ln.x0, ln.y0, ln.x1, ln.y1),
                box=lb.bbox,
                colour=colours.get(bbox_key(lb.bbox)),
                key=lb.key,
            )
        )
    raw = [(ln.x0, ln.y0, ln.x1, ln.y1) for ln in structural if ln.length >= MIN_LINE_PT]
    merged = merge_lines(raw)
    line_first = [Piece(line=s, n_src=n) for s, n in merged]
    return {
        "label_first": label_first,
        "line_with_label": distinct_lines(label_first),
        "line_first": line_first,
        "reach": reach,
        "linked": {line_key(p.line) for p in label_first if p.line},
        "segs": segs,
        "merged": merged,
    }


def score_pieces(syms: list[tuple[float, float]], pieces: list[Piece]) -> dict:
    out: dict = {"pieces": len(pieces)}
    for r in RADII:
        m = greedy_match(syms, pieces, r)
        out[f"matched_{int(r)}"] = len(m)
        if r == 12.0:
            out["pairs12"] = [(si, pi) for si, pi, _ in m]
            by = collections.Counter(p.colour for p in pieces)
            mby = collections.Counter(pieces[pi].colour for _, pi, _ in m)
            out["colour_pieces"] = {str(k): v for k, v in by.items()}
            out["colour_matched"] = {str(k): v for k, v in mby.items()}
    return out


def f1_at12(score: dict, n_syms: int) -> float:
    return prf(score["matched_12"], score["pieces"], n_syms)[2] or 0.0


# ---- one page -----------------------------------------------------------------------------------
def study_page(*, job, dp, syms, sheet, ddoc, members, legend_marks, raster) -> dict:
    rec: dict = {
        "job": job,
        "page": dp,
        "theirs": len(syms),
        "raster": raster,
        "bases": {},
        "symbols": [],
    }
    xy = [(s["x"], s["y"]) for s in syms]
    rec["groups"] = collections.Counter(s["group"] for s in syms)
    rec["groups"] = dict(rec["groups"])
    if raster or sheet is None:
        for b in BASES:
            rec["bases"][b] = {
                "suggested": {"pieces": 0, **{f"matched_{int(r)}": 0 for r in RADII}}
            }
        rec["symbols"] = [
            {"reason": "raster page", "matched": False, "group": s["group"]} for s in syms
        ]
        return rec
    page = ddoc[dp]
    size = (page.rect.width, page.rect.height)
    box_d = whole_sheet_box(*size)
    box = (box_d["x0"], box_d["y0"], box_d["x1"], box_d["y1"])
    lines = page_lines(page)
    in_view = lines_in_box(lines, box, size)
    table = class_table(in_view)
    suggested = suggest_classes(table)
    labels_all = [
        lb
        for lb in page_labels(page, sheet["id"], legend_marks)
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
    api_drawn = sum(1 for m in counted.values() if m["status"]["color"] != "unlinked")

    def run(classes: list[str]) -> dict:
        structural = [ln for ln in in_view if ln.klass in classes]
        return bases_for(labels, structural, colours)

    main = run(suggested)
    rec["suggested_classes"] = suggested
    rec["n_structural"] = len(main["segs"])
    rec["api_drawn"] = api_drawn
    rec["inproc_label_first"] = len(main["label_first"])
    for b in BASES:
        rec["bases"][b] = {"suggested": score_pieces(xy, main[b])}
    # oracle: the class (>= 3 lines) with the best F1 at 12 pt, per basis
    cands = [c for c in table if c.lines >= 3]
    best = {
        b: (rec["bases"][b]["suggested"], suggested, f1_at12(rec["bases"][b]["suggested"], len(xy)))
        for b in BASES
    }
    for c in cands:
        if [c.key] == suggested:
            continue
        res = run([c.key])
        for b in BASES:
            sc = score_pieces(xy, res[b])
            f = f1_at12(sc, len(xy))
            cur = best[b]
            if (f, -abs(sc["pieces"] - len(xy))) > (cur[2], -abs(cur[0]["pieces"] - len(xy))):
                best[b] = (sc, [c.key], f)
    for b in BASES:
        rec["bases"][b]["oracle"] = {**best[b][0], "classes": best[b][1]}
    # symbol-level reasons for the label-first basis (suggested class), coverage limits
    matched = {si for si, _ in rec["bases"]["label_first"]["suggested"]["pairs12"]}
    piece_by_sym = {si: pi for si, pi in rec["bases"]["label_first"]["suggested"]["pairs12"]}
    pieces = main["label_first"]
    used_pieces = set(piece_by_sym.values())
    shapes = small_shapes(page)
    for i, s in enumerate(syms):
        x, y = s["x"], s["y"]
        near = lines_near_point(x, y, main["segs"], 24.0)
        near12 = lines_near_point(x, y, main["segs"], 12.0)
        outside = not (box[0] <= x <= box[2] and box[1] <= y <= box[3])
        in_shape = any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in shapes)
        row = {
            "group": s["group"],
            "matched": i in matched,
            "no_class_lines": len(main["segs"]) == 0,
            "outside_box": outside,
            "in_small_shape_no_line": bool(in_shape and not near12),
            "line_class": line_segment_class((x, y), main["merged"]),
            "on_line_12": bool(near12),
            "any_line_24": bool(near),
        }
        if not row["matched"]:
            keys = {line_key(s2) for s2 in near}
            used_near = any(
                pi in used_pieces and pieces[pi].line and line_key(pieces[pi].line) in keys
                for pi in range(len(pieces))
            )
            far_near = any(
                pieces[pi].line and line_key(pieces[pi].line) in keys and pi not in used_pieces
                for pi in range(len(pieces))
            )
            row["reason"] = symbol_miss_reason(
                raster=False,
                lines_near=near,
                reach=main["reach"],
                linked=main["linked"],
                pieces_near_used=used_near,
                pieces_near_far=far_near,
            )
        rec["symbols"].append(row)
    # unmatched pieces of ours (label-first)
    count_on_line = collections.Counter(line_key(p.line) for p in pieces if p.line)
    rec["piece_reasons"] = []
    for pi, p in enumerate(pieces):
        if pi in used_pieces:
            continue
        d_any = min((point_dist(p, x, y) for x, y in xy), default=1e9)
        rec["piece_reasons"].append(
            piece_miss_reason(
                page_has_symbols=bool(syms),
                shared=bool(p.line) and count_on_line[line_key(p.line)] >= 2,
                symbol_within_24=d_any <= 24.0,
            )
        )
    # line-first: how many lines carry a size (a label whose best candidate is the line)
    rec["line_first_lines"] = len(main["merged"])
    rec["line_first_with_label"] = len(
        {line_key(p.line) for p in pieces if p.line} & {line_key(s) for s, _ in main["merged"]}
    )
    return rec


def point_dist(p: Piece, x: float, y: float) -> float:
    return p.distance(x, y)


# ---- API ----------------------------------------------------------------------------------------
def get(path: str):
    return s1.call("GET", path)


def project_data(pid: str) -> dict:
    sheets = get(f"/api/projects/{pid}/sheets")["sheets"]
    members = get(f"/api/projects/{pid}/members")["members"]
    legend = get(f"/api/projects/{pid}/legend")["rows"]
    return {
        "sheets": {s["page_index"]: s for s in sheets},
        "members": members,
        "marks": {r["mark"] for r in legend},
    }


def is_raster(sheet: dict) -> bool:
    cov = sheet["page"].get("image_coverage")
    return sheet["page"]["kind"] != "vector" or (cov is not None and cov >= 0.5)


# ---- pre-Part-A scoring of the Stage 1 projects (positions are stored, nothing is recomputed) ----
def pre_a_page(syms, sheet, members) -> dict:
    pieces = [
        Piece(
            line=tuple(m["link"]["line"]["p"] + m["link"]["line"]["q"])
            if m["link"]["line"]
            else None,
            box=(m["bbox"]["x0"], m["bbox"]["y0"], m["bbox"]["x1"], m["bbox"]["y1"])
            if m["bbox"]
            else None,
            colour=m["status"]["color"],
        )
        for m in members
        if m["sheet_id"] == sheet["id"]
        and m["counting"] == "counted"
        and not m["deleted"]
        and m["merged_into"] is None
        and m["not_member"] is None
        and not m["existing"]
        and m["status"]["color"] != "unlinked"
    ]
    xy = [(s["x"], s["y"]) for s in syms]
    return score_pieces(xy, pieces)


# ---- commands -----------------------------------------------------------------------------------
def cmd_run() -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    runs = {}
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job:
            continue
        t0 = time.time()
        pid = s1.upload(draws[job], f"phase6b-{job}")
        s1.wait_done(pid)
        runs[job] = {"project_id": pid, "minutes": round((time.time() - t0) / 60, 2)}
        print(job, runs[job], flush=True)
        RUNS.write_text(json.dumps(runs, indent=1))


def cmd_score() -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    runs = json.loads(RUNS.read_text())
    stage1 = {
        j["job"]: j["project_id"]
        for j in json.loads((TAKEOFFS / "stage1_measure.json").read_text())["jobs"]
    }
    pages: list[dict] = []
    extra: list[dict] = []
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job or job not in runs:
            continue
        data = project_data(runs[job]["project_id"])
        old = project_data(stage1[job]) if job in stage1 else None
        legend_marks = data["marks"]
        with pymupdf.open(TAKEOFFS / name) as tdoc, pymupdf.open(draws[job]) as ddoc:
            for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
                syms = their_symbols(tdoc[tp])
                sheet = data["sheets"].get(dp)
                mem = [m for m in data["members"] if sheet and m["sheet_id"] == sheet["id"]]
                if not syms:
                    drawn = [
                        m
                        for m in mem
                        if m["counting"] == "counted"
                        and not m["deleted"]
                        and m["status"]["color"] != "unlinked"
                        and m["merged_into"] is None
                        and m["not_member"] is None
                        and not m["existing"]
                    ]
                    extra.append({"job": job, "page": dp, "ours": len(drawn)})
                    continue
                rec = study_page(
                    job=job,
                    dp=dp,
                    syms=syms,
                    sheet=sheet,
                    ddoc=ddoc,
                    members=mem,
                    legend_marks=legend_marks,
                    raster=bool(sheet is None or is_raster(sheet)),
                )
                rec["pre_a"] = None
                if old is not None and dp in old["sheets"]:
                    osheet = old["sheets"][dp]
                    rec["pre_a"] = pre_a_page(syms, osheet, old["members"])
                    rec["pre_a_sheet_excluded"] = not osheet["takeoff"]["included"] or not any(
                        m["sheet_id"] == osheet["id"] for m in old["members"]
                    )
                pages.append(rec)
        print(job, len(pages), flush=True)
        OUT.write_text(json.dumps({"pages": pages, "extra": extra}, default=list, indent=0))
    OUT.write_text(json.dumps({"pages": pages, "extra": extra}, default=list, indent=0))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "run":
        cmd_run()
    elif cmd == "score":
        cmd_score()
    elif cmd in ("shots", "report"):
        from tools.takeoff import phase6b_report

        getattr(phase6b_report, cmd)()
    else:
        print(__doc__)
