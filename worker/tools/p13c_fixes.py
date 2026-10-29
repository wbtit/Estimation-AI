"""Phase 13c: the fixes for the top miss causes (docs/PHASE13C_PREREGISTRATION.md; DEV jobs only,
read-only).

  PYTHONPATH=. .venv/bin/python -m tools.p13c_fixes            # the run
  PYTHONPATH=. .venv/bin/python -m tools.p13c_fixes report     # the doc again from the JSON

The pre-registration's hash (worker/prereg/PHASE13C.sha256) is verified first; the run stops when
it differs. Every 12c-A page is rebuilt IN MEMORY with the engine's `build_page` under each
configuration (A, F1-auto, F1-D, F2, F3, F4, ALL, ALL-D, and the F4 / ALL end-gap sensitivity):
F1 changes the beam pen (structural score, or D = a simulated click ON a beam line), F3 the crop
(main-grid box united with the person's crop), F2 and F4 are build flags. Configuration A must
reproduce the stored 12c-A counts (else the run stops). Scored with the 12c-A measures plus 36 pt
one-to-one precision and recall; the 13b census re-run on ALL and ALL-D. Writes the private
fixtures/private/eval/p13c/fixes.json and gallery/, and the local docs/PHASE13C_RESULTS.md; prints
counts only. Nothing is written to the database.
"""

from __future__ import annotations

import collections
import html
import json
import math
import random
import sys
from typing import Any

import pymupdf
from PIL import Image, ImageDraw

from src.build.page import ColumnPlanRef, Setup, build_page
from src.build.propose import displayed_size, propose_crop_main_grid, propose_pen_structural
from src.build.segments import page_text_lines
from src.config import load_config
from src.db import connect
from src.linking.lines import page_lines
from src.linking.structural import lines_in_box
from tools.p12c_eval import PEN_MIN_IN, ROWS, _font, _render, one_to_one, seg_dist
from tools.p12c_lib import BEAM, COLUMN, JOBS, group, project_name, their_pages
from tools.p13a_pen import VERDICT_GROUPS, Page, counts, med, pieces_of, score
from tools.p13b_miss import (
    BEAM_CATS,
    COL_CATS,
    Census,
    classify_beam,
    dists,
    pens_needed,
    stratified,
)
from tools.p13b_miss import summarise as census_summary
from tools.prereg import verify
from tools.takeoff.common import PRIVATE, ROOT

PREREG = ROOT / "docs" / "PHASE13C_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE13C.sha256"
OUT = PRIVATE / "eval" / "p13c" / "fixes.json"
GALLERY = PRIVATE / "eval" / "p13c" / "gallery"
DOC = ROOT / "docs" / "PHASE13C_RESULTS.md"

MATCH_PT = 36.0
CLICK_PT = 36.0  # D: a pen's lines within this of a mark
GUARD_PAGES = 3
SEED = 13
ALL_FLAGS = ("wall_same_pen", "column_strokes", "column_off_grid")
F4_FLAGS = ("column_strokes", "column_off_grid")

# name -> (pen rule, F3 crop, build flags, end gap, verdict configuration)
CONFIGS: dict[str, tuple[str, bool, tuple[str, ...], float, bool]] = {
    "A": ("auto", False, (), 1.0, True),
    "F1-auto": ("f1", False, (), 1.0, True),
    "F1-D": ("D", False, (), 1.0, True),
    "F2": ("auto", False, ("wall_same_pen",), 1.0, True),
    "F3": ("auto", True, (), 1.0, True),
    "F4": ("auto", False, F4_FLAGS, 1.0, True),
    "ALL": ("f1", True, ALL_FLAGS, 1.0, True),
    "ALL-D": ("D", True, ALL_FLAGS, 1.0, True),
    "F4 gap 2": ("auto", False, F4_FLAGS, 2.0, False),
    "F4 gap 3": ("auto", False, F4_FLAGS, 3.0, False),
    "ALL gap 2": ("f1", True, ALL_FLAGS, 2.0, False),
    "ALL gap 3": ("f1", True, ALL_FLAGS, 3.0, False),
}
CENSUS_CONFIGS = ("ALL", "ALL-D")
SIMULATED = {"F1-D", "ALL-D"}


# --- pure rules (synthetic tests in tests/test_p13c_fixes.py) ------------------------------------


def intended_pen(
    marks: list[tuple[float, float]],
    cands: list[tuple[tuple[float, float, float, float], str]],
    auto: str | None,
    radius: float = CLICK_PT,
) -> str | None:
    """D: the pen with lines within `radius` of the most marks; ties: the auto pen, then name."""
    near: collections.Counter[str] = collections.Counter()
    for m in marks:
        for pen in {pen for seg, pen in cands if seg_dist(m, seg) <= radius}:
            near[pen] += 1
    if not near:
        return None
    return min(near, key=lambda p: (-near[p], p != auto, p))


def lowered(base: dict[str, int], other: dict[str, int]) -> list[str]:
    """Pages whose matched marks are lower than in the baseline."""
    return sorted(k for k, v in other.items() if v < base.get(k, 0))


def prf(matched: int, ours: int, theirs: int) -> tuple[float | None, float | None]:
    return (matched / ours if ours else None, matched / theirs if theirs else None)


def outside(pt: tuple[float, float], box) -> bool:
    return not (box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3])


# --- one page under one configuration ------------------------------------------------------------


class Ctx:
    """A built 12c-A page with the per-page caches of the configurations."""

    def __init__(self, pg: Page, sheet_id: str, theirs, job: str, dp: int):
        self.pg, self.sheet_id, self.theirs, self.job, self.dp = pg, sheet_id, theirs, job, dp
        self.text_all = pg.text if pg.text is not None else page_text_lines(pg.page)
        self.bmarks = [(s.x, s.y) for s in theirs.symbols if s.prefix == BEAM]
        self.cmarks = [(s.x, s.y) for s in theirs.symbols if s.prefix == COLUMN]
        self._f3 = None
        self._pen: dict[tuple[str, tuple], str | None] = {}
        self.f1_scores: dict[tuple, dict] = {}

    @property
    def key(self) -> str:
        return f"{self.job} p{self.dp + 1}"

    def f3(self):
        if self._f3 is None:
            self._f3 = propose_crop_main_grid(self.pg.page, self.text_all, self.pg.box)
        return self._f3

    def box(self, use_f3: bool):
        return self.f3().box if use_f3 else self.pg.box

    def pen(self, rule: str, box) -> tuple[str | None, bool]:
        """(pen, as stored) for the configuration's pen rule."""
        pg = self.pg
        if pg.role != "framing" or rule == "auto":
            return pg.auto, True
        k = (rule, tuple(box))
        if k not in self._pen:
            if rule == "f1":
                p, sc = propose_pen_structural(pg.page, box, pg.ratio, self.text_all)
                self.f1_scores[tuple(box)] = sc
            else:
                min_pt = PEN_MIN_IN * 72.0 / pg.ratio
                lines = lines_in_box(page_lines(pg.page), box, displayed_size(pg.page))
                cands = [
                    ((ln.x0, ln.y0, ln.x1, ln.y1), ln.klass) for ln in lines if ln.length >= min_pt
                ]
                p = intended_pen(self.bmarks, cands, pg.auto)
            self._pen[k] = p
        p = self._pen[k]
        return (p, False) if p is not None else (pg.auto, True)


def plan_ref(pb, ratio: float) -> ColumnPlanRef:
    """A column plan rebuilt in memory, as the store step would record it."""
    cols = [
        (g.centre, {"grid": [g.grid.n_label, g.grid.a_label] if g.grid else None})
        for g in sorted(pb.columns, key=lambda g: (g.centre[1], g.centre[0]))
    ]
    return ColumnPlanRef([g for g in pb.grid_lines if g.label], ratio, cols)


def build(ctx: Ctx, cfg: str, plans: dict) -> dict[str, Any]:
    rule, use_f3, flags, gap, _ = CONFIGS[cfg]
    pg = ctx.pg
    box = ctx.box(use_f3)
    pen, as_stored = ctx.pen(rule, box)
    plan = pg.plan
    plan_note = None
    if pg.role == "framing" and (use_f3 or set(flags) & set(F4_FLAGS)) and pg.plan is not None:
        sid = str(pg.inputs.get("column_plan_sheet_id") or "")
        if (cfg, ctx.job, sid) in plans:
            plan = plans[(cfg, ctx.job, sid)]
        else:
            plan_note = "stored plan (plan page not rebuilt)"
    setup = Setup(
        box,
        pg.ratio,
        pg.tos,
        pen,
        pg.role,
        str(pg.inputs.get("crossing_rule") or "family"),
        pens=pg.view_pens if as_stored else ((pen,) if pen else ()),
        flags=frozenset(flags),
        stroke_gap_pt=gap,
    )
    pb = build_page(pg.page, setup, pg.text, pg.legend, plan)
    pieces = pieces_of(pb, pg.ratio)
    if pg.role == "column_plan":
        plans[(cfg, ctx.job, ctx.sheet_id)] = plan_ref(pb, pg.ratio)
    ev = score(pg, pieces, pen, ctx.theirs)
    beams = [p for p in pieces if p["kind"] == "Beams" and p["type"] != "column"]
    cols = [p for p in pieces if p["type"] == "column"]
    rec: dict[str, Any] = {
        "pen": pen,
        "box": [round(v, 1) for v in box],
        "ours_beams": len(beams),
        "ours_columns": len(cols),
        "beams_err": ev.get("beams_err"),
        "columns_err": ev.get("columns_err"),
        "beams_within": ev.get("beams_within"),
        "columns_within": ev.get("columns_within"),
        "rows36": ev["rows"]["36"],
        "wall_removed": pb.removed.get("wall_lines", 0),
        "plan_note": plan_note,
    }
    orig = pg.box
    if pg.role == "framing":
        segs = [tuple(p["page"]) for p in beams]
        m = one_to_one(ctx.bmarks, segs, seg_dist, MATCH_PT)
        rec["theirs"] = len(ctx.bmarks)
        rec["mark_matched"] = [k in m for k in range(len(ctx.bmarks))]
        mids = [((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) for s in segs]
    else:
        pts = [(p["page"][0], p["page"][1]) for p in cols]
        m = one_to_one(ctx.cmarks, pts, math.dist, MATCH_PT)
        rec["theirs"] = len(ctx.cmarks)
        rec["mark_matched"] = [k in m for k in range(len(ctx.cmarks))]
        mids = pts
    rec["matched"] = len(m)
    out_ids = [j for j, q in enumerate(mids) if outside(q, orig)]
    got = set(m.values())
    rec["outside_orig"] = len(out_ids)
    rec["outside_orig_matched"] = sum(j in got for j in out_ids)
    rec["_pieces"] = pieces
    return rec


def census_page(ctx: Ctx, cfg: str, plans: dict, rec: dict) -> dict[str, Any]:
    """The 13b categories on one page under a configuration (its pen, crop, flags, plan)."""
    rule, use_f3, flags, gap, _ = CONFIGS[cfg]
    pg = ctx.pg
    box = ctx.box(use_f3)
    pen, as_stored = ctx.pen(rule, box)
    plan = pg.plan
    if pg.role == "framing" and pg.plan is not None:
        sid = str(pg.inputs.get("column_plan_sheet_id") or "")
        plan = plans.get((cfg, ctx.job, sid), pg.plan)
    cs = Census(pg, pen, as_stored, box, frozenset(flags), gap, plan)
    out: dict[str, Any] = {"job": ctx.job, "page": ctx.dp + 1, "role": pg.role}
    out["group"] = group(ctx.job)
    if pg.role == "framing":
        bseg = [tuple(s) for s in cs.beam_seg.tolist()]
        if len(bseg) != rec["ours_beams"]:
            raise SystemExit(f"census build differs from the {cfg} build on {ctx.key}")
        matched = one_to_one(ctx.bmarks, bseg, seg_dist, MATCH_PT)
        rows = []
        for k, m in enumerate(ctx.bmarks):
            f = cs.beam_facts(m, 36.0, matched, k)
            cat, det = classify_beam(f)
            rows.append({"x": round(m[0], 1), "y": round(m[1], 1), "category": cat,
                         "detail": det, "facts": f})  # fmt: skip
            for r in (48.0, 72.0):
                rows[-1][f"r{int(r)}"] = list(classify_beam(cs.beam_facts(m, r, matched, k)))
        cover: dict[str, set[int]] = collections.defaultdict(set)
        for k, m in enumerate(ctx.bmarks):
            for i in (dists(m, cs.raw_seg) <= 36.0).nonzero()[0]:
                cover[cs.raw_pen[i]].add(k)
        out.update(marks=rows, pens_needed=pens_needed(dict(cover), len(ctx.bmarks)))
    else:
        if len(cs.col_pts) != rec["ours_columns"]:
            raise SystemExit(f"census build differs from the {cfg} build on {ctx.key}")
        matched = one_to_one(ctx.cmarks, cs.col_pts, math.dist, MATCH_PT)
        out["marks"] = [
            {"x": round(m[0], 1), "y": round(m[1], 1), **cs.column_facts(m, 36.0, matched, k)}
            for k, m in enumerate(ctx.cmarks)
        ]
    return out


# --- summary --------------------------------------------------------------------------------------


def _row_key(kv: tuple[str, int]) -> tuple[int, int]:
    return (-kv[1], ROWS.index(kv[0]))


def summarise(pages: list[dict], cfg: str, groups: tuple[str, ...]) -> dict[str, Any]:
    ps = [p for p in pages if p["group"] in groups]
    fr = [p for p in ps if p["role"] == "framing"]
    cp = [p for p in ps if p["role"] != "framing"]
    r = {p["key"]: p["configs"][cfg] for p in ps}
    bw = sum(bool(r[p["key"]]["beams_within"]) for p in fr)
    cw = sum(bool(r[p["key"]]["columns_within"]) for p in cp)
    bm = sum(r[p["key"]]["matched"] for p in fr)
    bo = sum(r[p["key"]]["ours_beams"] for p in fr)
    bt = sum(r[p["key"]]["theirs"] for p in fr)
    cm = sum(r[p["key"]]["matched"] for p in cp)
    co = sum(r[p["key"]]["ours_columns"] for p in cp)
    ct = sum(r[p["key"]]["theirs"] for p in cp)
    rows = collections.Counter()
    for p in ps:
        rows.update(r[p["key"]]["rows36"])
    s = {
        "framing_pages": len(fr),
        "column_pages": len(cp),
        "beams_within": bw,
        "columns_within": cw,
        "beams_median": med([e for p in fr if (e := r[p["key"]]["beams_err"]) is not None]),
        "columns_median": med([e for p in cp if (e := r[p["key"]]["columns_err"]) is not None]),
        "beam_matched": bm,
        "beam_ours": bo,
        "beam_theirs": bt,
        "beam_pr": prf(bm, bo, bt),
        "col_matched": cm,
        "col_ours": co,
        "col_theirs": ct,
        "col_pr": prf(cm, co, ct),
        "rows": dict(rows),
        "top3": [k for k, n in sorted(rows.items(), key=_row_key) if n][:3],
    }  # fmt: skip
    s["bar_met"] = bool(fr) and bool(cp) and bw * 2 >= len(fr) and cw * 2 >= len(cp)
    return s


# --- gallery --------------------------------------------------------------------------------------

WIN_PT = 240.0
ZOOM = 3.0


def _panel(page, box, pieces, mark, crop) -> Image.Image:
    size = (int(WIN_PT * ZOOM), int(WIN_PT * ZOOM))
    img = Image.new("RGB", size, (235, 235, 235))
    img.paste(_render(page, box, ZOOM), (0, 0))
    img = Image.blend(img, Image.new("RGB", size, (255, 255, 255)), 0.4)
    d = ImageDraw.Draw(img)
    P = lambda x, y: ((x - box[0]) * ZOOM, (y - box[1]) * ZOOM)  # noqa: E731
    for p in pieces:
        a = P(p["page"][0], p["page"][1])
        if p["type"] == "column":
            d.rectangle(
                [a[0] - 10, a[1] - 10, a[0] + 10, a[1] + 10], outline=(0, 160, 140), width=4
            )
            continue
        col = (120, 120, 120) if p["kind"] == "Joist" else (255, 0, 200)
        d.line([a, P(p["page"][2], p["page"][3])], fill=col, width=6)
    x0, y0 = P(crop[0], crop[1])
    x1, y1 = P(crop[2], crop[3])
    d.rectangle([x0, y0, x1, y1], outline=(230, 25, 75), width=2)
    c = P(*mark)
    rr = MATCH_PT * ZOOM
    d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=(0, 90, 255), width=4)
    d.ellipse([c[0] - 6, c[1] - 6, c[0] + 6, c[1] + 6], fill=(0, 90, 255))
    return img


def gallery_image(path, ctx: Ctx, mark, before: dict, after: dict, caption: str) -> None:
    page = ctx.pg.page
    w, h = displayed_size(page)
    half = WIN_PT / 2
    x0 = min(max(mark[0] - half, 0.0), max(w - WIN_PT, 0.0))
    y0 = min(max(mark[1] - half, 0.0), max(h - WIN_PT, 0.0))
    box = (x0, y0, min(x0 + WIN_PT, w), min(y0 + WIN_PT, h))
    p1 = _panel(page, box, before["_pieces"], mark, before["box"])
    p2 = _panel(page, box, after["_pieces"], mark, after["box"])
    gap = 16
    W, H = p1.width * 2 + gap * 3, p1.height + 110
    out = Image.new("RGB", (W, H), (255, 255, 255))
    o = ImageDraw.Draw(out)
    for i, (im, t) in enumerate(((p1, "before: A"), (p2, "after: ALL"))):
        x = gap + i * (p1.width + gap)
        o.text((x, 6), t, fill=(40, 40, 40), font=_font(22))
        out.paste(im, (x, 36))
    o.text((gap, H - 66), caption, fill=(20, 20, 20), font=_font(18))
    o.text(
        (gap, H - 38),
        "magenta: our beams, grey: joists, teal: our columns, red: crop,"
        " blue: estimator mark (36 pt)",
        fill=(90, 90, 90),
        font=_font(16),
    )
    out.save(path, optimize=True)


# --- report ---------------------------------------------------------------------------------------


def _pct(x: float | None) -> str:
    return "-" if x is None else f"{100 * x:+.0f}%"


def _r(x: float | None) -> str:
    return "-" if x is None else f"{x:.2f}"


def report(d: dict) -> str:
    S = d["summary"]
    V = "verdict (dev + strict)"
    L = [
        "# Phase 13c results: fixes for the top miss causes (DEV jobs only)",
        "",
        f"Pre-registration `docs/PHASE13C_PREREGISTRATION.md`, sha256 `{d['prereg_sha256'][:12]}`"
        " (verified at the start of the run). Not blind on dev. All pages rebuilt in memory; no"
        " database write. The four changes are flags, off by default. F1-D and ALL-D use the"
        " estimator's marks to pick the pen: they SIMULATE A PERSON CLICKING ON A BEAM LINE and are"
        " not automatic results. Guard: configuration A reproduced the stored 12c-A counts on all"
        f" {d['n_pages']} pages.",
        "",
        "## Results (verdict set: Phase 7 dev + strict held-out)",
        "",
        "| Configuration | Beam pages within 20% | Column pages within 20% | Median error beams |"
        " Median error columns | Beam precision / recall | Column precision / recall | Bar |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for c, (_, _, _, _, main) in CONFIGS.items():
        if not main:
            continue
        s = S[c][V]
        label = c + (" (simulated click)" if c in SIMULATED else "")
        L.append(
            f"| {label} | {s['beams_within']} of {s['framing_pages']} | {s['columns_within']} of"
            f" {s['column_pages']} | {_pct(s['beams_median'])} | {_pct(s['columns_median'])} |"
            f" {_r(s['beam_pr'][0])} / {_r(s['beam_pr'][1])} ({s['beam_matched']} of"
            f" {s['beam_theirs']} marks, {s['beam_ours']} ours) | {_r(s['col_pr'][0])} /"
            f" {_r(s['col_pr'][1])} ({s['col_matched']} of {s['col_theirs']}, {s['col_ours']}"
            f" ours) | {'met' if s['bar_met'] else 'not met'} |"
        )
    L += ["", "Bar separately (information): strict held-out only and seen jobs.", "",
          "| Configuration | Strict: beams | Strict: columns | Seen: beams | Seen: columns |",
          "|---|---:|---:|---:|---:|"]  # fmt: skip
    for c, (_, _, _, _, main) in CONFIGS.items():
        if not main:
            continue
        st, se = S[c]["strict"], S[c]["seen"]
        L.append(
            f"| {c} | {st['beams_within']} of {st['framing_pages']} | {st['columns_within']} of"
            f" {st['column_pages']} | {se['beams_within']} of {se['framing_pages']} |"
            f" {se['columns_within']} of {se['column_pages']} |"
        )
    L += ["", "### End-gap sensitivity (F4a; not used for the verdict)", "",
          "| Configuration | Beam pages | Column pages | Column precision / recall |",
          "|---|---:|---:|---:|"]  # fmt: skip
    for c in ("F4", "F4 gap 2", "F4 gap 3", "ALL", "ALL gap 2", "ALL gap 3"):
        s = S[c][V]
        L.append(
            f"| {c} | {s['beams_within']} of {s['framing_pages']} | {s['columns_within']} of"
            f" {s['column_pages']} | {_r(s['col_pr'][0])} / {_r(s['col_pr'][1])} |"
        )
    # guard
    L += ["", "## Matched-marks guard (pages with fewer matched marks than A)", ""]
    for c, lst in d["guard"].items():
        flag = " **more than 3 pages**" if len(lst) > GUARD_PAGES else ""
        L.append(f"- {c}: {len(lst)} page(s){flag}" + (": " + "; ".join(lst) if lst else ""))
    # F1
    f1 = d["f1"]
    L += ["", "## F1 pen choice", "",
          f"Framing pages (verdict set): {f1['pages']}. F1-auto picks the same pen as D on"
          f" {f1['f1_eq_D']}; the stored auto pen equals D on {f1['A_eq_D']}; F1-auto differs from"
          f" the auto pen on {f1['f1_ne_A']}. F1-auto found no candidate pen on {f1['f1_none']}"
          " (auto pen used)."]  # fmt: skip
    # F2
    f2 = d["f2"]
    L += ["", "## F2 wall band", "",
          f"Wall-band removals in A on the verdict framing pages: {f2['removed_A']} lines; in F2:"
          f" {f2['removed_F2']}. The two pages with most removals in A: {', '.join(f2['top2'])}"
          f" ({f2['top2_removed']} lines).", "",
          "| Configuration | Beam pages within 20% (33) | Without the two pages (31) |"
          " Beam marks matched (33) | Without the two pages |",
          "|---|---:|---:|---:|---:|"]  # fmt: skip
    for c, v in f2["table"].items():
        L.append(f"| {c} | {v[0]} | {v[1]} | {v[2]} | {v[3]} |")
    # F3
    f3 = d["f3"]
    L += ["", "## F3 crop", "",
          f"Pages where the person's crop cuts the main grid (the later UI warning):"
          f" {f3['cuts']} of {f3['pages']} ({', '.join(f3['cuts_pages']) or 'none'}). Pages with"
          f" no main grid: {f3['no_grid']}. Pages whose crop grew: {f3['grew']}.", "",
          "| Configuration | Beam pieces outside the original crop | of them matched | precision |"
          " Columns outside | matched | precision |",
          "|---|---:|---:|---:|---:|---:|---:|"]  # fmt: skip
    for c, v in f3["outside"].items():
        L.append(
            f"| {c} | {v['beams']} | {v['beams_matched']} | {_r(v['beams_prec'])} |"
            f" {v['columns']} | {v['columns_matched']} | {_r(v['columns_prec'])} |"
        )
    if d.get("plan_notes"):
        L += ["", "Framing pages on the stored column plan (plan page not rebuilt): "
              + ", ".join(d["plan_notes"])]  # fmt: skip
    L += ["", f"Sanity (information): framing pages whose A counts change with the column plan"
          f" rebuilt in memory (flags off) instead of the stored one:"
          f" {d['plan_rebuilt_differs']}."]  # fmt: skip
    # census
    for c in CENSUS_CONFIGS:
        cs = d["census"][c]
        nb, nc = cs["beam_marks"], cs["column_marks"]
        mb = nb - cs["beam_cats"].get("matched", 0)
        mc = nc - cs["col_cats"].get("matched", 0)
        tag = " (simulated click)" if c in SIMULATED else ""
        L += ["", f"## Census on {c}{tag} (13b categories, R = 36 pt)", "",
              "| Beam category | Marks | % of B marks |", "|---|---:|---:|"]  # fmt: skip
        for k in BEAM_CATS:
            n = cs["beam_cats"].get(k, 0)
            L.append(f"| {k} | {n} | {100 * n / nb:.0f}% |")
        L += ["", "| Column category | Marks | % of C marks |", "|---|---:|---:|"]
        for k in COL_CATS:
            n = cs["col_cats"].get(k, 0)
            L.append(f"| {k} | {n} | {100 * n / nc:.0f}% |")
        L += ["", f"Beam causes ({mb} missed): "
              + "; ".join(f"{k} {n}" for k, n in cs["beam_causes"][:6]),
              f"Column causes ({mc} missed): "
              + "; ".join(f"{k} {n}" for k, n in cs["column_causes"][:4])]  # fmt: skip
    # per page
    L += ["", "## Per page (verdict set; ours / theirs, matched in brackets)", "",
          "| Page | Role | Theirs | " + " | ".join(c for c, v in CONFIGS.items() if v[4]) + " |",
          "|---|---|---:|" + "---:|" * sum(v[4] for v in CONFIGS.values())]  # fmt: skip
    for p in d["pages"]:
        if p["group"] not in VERDICT_GROUPS:
            continue
        cells = []
        for c, v in CONFIGS.items():
            if not v[4]:
                continue
            r = p["configs"][c]
            ours = r["ours_beams"] if p["role"] == "framing" else r["ours_columns"]
            cells.append(f"{ours} ({r['matched']})")
        L.append(
            f"| {p['key']} | {p['role']} | {p['configs']['A']['theirs']} | "
            + " | ".join(cells)
            + " |"
        )
    # verdict
    a, al, ad = S["A"][V], S["ALL"][V], S["ALL-D"][V]
    cb = d["census"]["ALL"]
    L += ["", "## Verdict (plain words)", "",
          f"- **ALL (automatic): {'copilot viable' if al['bar_met'] else 'detection needs work'}.**"
          f" Beams within 20% on {al['beams_within']} of {al['framing_pages']} framing pages (A:"
          f" {a['beams_within']}), columns on {al['columns_within']} of {al['column_pages']} (A:"
          f" {a['columns_within']}). Beam marks matched {al['beam_matched']} of {al['beam_theirs']}"
          f" (A: {a['beam_matched']}); precision {_r(al['beam_pr'][0])}"
          f" (A: {_r(a['beam_pr'][0])}). Column marks matched {al['col_matched']} of"
          f" {al['col_theirs']} (A: {a['col_matched']})."
          + ("" if al["bar_met"]
             else f" Top 3 causes from the failure table: {', '.join(al['top3'])}."),
          f"- ALL-D (simulated click on a beam line, not automatic): beams {ad['beams_within']} of"
          f" {ad['framing_pages']}, columns {ad['columns_within']} of {ad['column_pages']}, beam"
          f" marks matched {ad['beam_matched']}, bar {'met' if ad['bar_met'] else 'not met'}.",
          "- Top 2 remaining beam causes on ALL (census): "
          + "; ".join(f"**{k}** {n}" for k, n in cb["beam_causes"][:2])
          + f". Top column cause: **{cb['column_causes'][0][0]}** {cb['column_causes'][0][1]}.",
          ]  # fmt: skip
    for c, lst in d["guard"].items():
        if len(lst) > GUARD_PAGES and CONFIGS[c][4]:
            L.append(f"- Guard: {c} lowers matched marks on {len(lst)} pages (listed above).")
    L += ["", "## Gallery", "", f"`fixtures/private/eval/p13c/gallery/index.html` (private):"
          f" {d['gallery']['gained']} newly matched and {d['gallery']['lost']} newly lost marks,"
          f" A vs ALL, seed {SEED}.", ""]  # fmt: skip
    return "\n".join(L)


# --- run ------------------------------------------------------------------------------------------


def main(argv: list[str]) -> None:
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:
        DOC.write_text(report(json.loads(OUT.read_text())))
        return
    print("pre-registration verified:", digest[:12])
    cfg = load_config()
    ctxs: list[Ctx] = []
    docs = []
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        for job in JOBS:  # the 15 DEV jobs of 12c-A (none is locked)
            pid = str(
                conn.execute(
                    "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                    (project_name(job),),
                ).fetchone()["id"]
            )
            theirs = their_pages(job)
            stored = conn.execute(
                "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
            ).fetchone()["stored_path"]
            snaps = conn.execute(
                "SELECT s.id AS sheet_id, s.page_index, b.setup, b.pieces FROM build_snapshots b"
                " JOIN sheets s ON s.id = b.sheet_id WHERE b.project_id = %s ORDER BY s.page_index",
                (pid,),
            ).fetchall()
            doc = pymupdf.open(cfg.upload_dir / stored)
            docs.append(doc)
            for sn in snaps:
                tag = sn["setup"]["evidence"].get("p12c_person_setup") or {}
                if not tag.get("built") or not sn["setup"]["built"]:
                    continue
                dp = sn["page_index"]
                pg = Page(conn, pid, str(sn["sheet_id"]), sn, doc[dp])
                ctxs.append(Ctx(pg, str(sn["sheet_id"]), theirs[dp], job, dp))
    # column plans first (framing pages under F3 / F4 use them)
    order = sorted(ctxs, key=lambda c: (c.job, c.pg.role != "column_plan", c.dp))
    plans: dict = {}
    pages: dict[str, dict] = {}
    for ctx in order:
        pages[ctx.key] = {"key": ctx.key, "job": ctx.job, "page": ctx.dp + 1,
                          "group": group(ctx.job), "role": ctx.pg.role, "configs": {}}  # fmt: skip
    plan_notes: set[str] = set()
    for c in CONFIGS:
        for ctx in order:
            rec = build(ctx, c, plans)
            if c == "A":
                want = counts([p for p in ctx.pg.snap["pieces"] if p.get("page")])
                if (rec["ours_beams"], rec["ours_columns"]) != want:
                    raise SystemExit(f"guard: A differs from the stored 12c-A counts on {ctx.key}")
            if rec["plan_note"]:
                plan_notes.add(ctx.key)
            pages[ctx.key]["configs"][c] = rec
        print(f"{c}: built {len(order)} pages", flush=True)
    # sanity: the rebuilt (flags off) column plan against the stored one
    differs = 0
    for ctx in order:
        if ctx.pg.role != "framing" or ctx.pg.plan is None:
            continue
        sid = str(ctx.pg.inputs.get("column_plan_sheet_id") or "")
        if ("A", ctx.job, sid) not in plans:
            continue
        pg = ctx.pg
        rule = str(pg.inputs.get("crossing_rule") or "family")
        setup = Setup(pg.box, pg.ratio, pg.tos, pg.auto, pg.role, rule, pens=pg.view_pens)
        pb = build_page(pg.page, setup, pg.text, pg.legend, plans[("A", ctx.job, sid)])
        if counts(pieces_of(pb, pg.ratio)) != counts(pages[ctx.key]["configs"]["A"]["_pieces"]):
            differs += 1
    # census on ALL and ALL-D (verdict pages)
    census: dict[str, Any] = {}
    for c in CENSUS_CONFIGS:
        cps = [
            census_page(ctx, c, plans, pages[ctx.key]["configs"][c])
            for ctx in order
            if group(ctx.job) in VERDICT_GROUPS
        ]
        census[c] = census_summary(cps)
        census[c]["pages"] = cps
        print(f"census {c}: done", flush=True)
    plist = sorted(pages.values(), key=lambda p: (p["job"], p["page"]))
    groups = {"verdict (dev + strict)": VERDICT_GROUPS, "strict": ("strict",), "seen": ("seen",),
              "dev": ("dev",)}  # fmt: skip
    summary = {c: {g: summarise(plist, c, gs) for g, gs in groups.items()} for c in CONFIGS}
    vpages = [p for p in plist if p["group"] in VERDICT_GROUPS]
    base = {p["key"]: p["configs"]["A"]["matched"] for p in vpages}
    guard = {
        c: [
            f"{k} ({base[k]} -> {v})"
            for k in lowered(base, {p["key"]: p["configs"][c]["matched"] for p in vpages})
            for v in [next(p["configs"][c]["matched"] for p in vpages if p["key"] == k)]
        ]
        for c in CONFIGS
        if c != "A"
    }
    # F1
    vfr = [p for p in vpages if p["role"] == "framing"]
    f1 = {
        "pages": len(vfr),
        "f1_eq_D": sum(p["configs"]["F1-auto"]["pen"] == p["configs"]["F1-D"]["pen"] for p in vfr),
        "A_eq_D": sum(p["configs"]["A"]["pen"] == p["configs"]["F1-D"]["pen"] for p in vfr),
        "f1_ne_A": sum(p["configs"]["F1-auto"]["pen"] != p["configs"]["A"]["pen"] for p in vfr),
        "f1_none": sum(
            1
            for ctx in order
            if group(ctx.job) in VERDICT_GROUPS
            and ctx.pg.role == "framing"
            and ctx._pen.get(("f1", tuple(ctx.pg.box)), "x") is None
        ),
    }
    # F2
    top2 = sorted(vfr, key=lambda p: (-p["configs"]["A"]["wall_removed"], p["key"]))[:2]
    t2 = {p["key"] for p in top2}

    def f2row(c: str) -> list[int]:
        rs = [(p["key"], p["configs"][c]) for p in vfr]
        return [
            sum(bool(r["beams_within"]) for _, r in rs),
            sum(bool(r["beams_within"]) for k, r in rs if k not in t2),
            sum(r["matched"] for _, r in rs),
            sum(r["matched"] for k, r in rs if k not in t2),
        ]

    f2 = {
        "removed_A": sum(p["configs"]["A"]["wall_removed"] for p in vfr),
        "removed_F2": sum(p["configs"]["F2"]["wall_removed"] for p in vfr),
        "top2": [p["key"] for p in top2],
        "top2_removed": sum(p["configs"]["A"]["wall_removed"] for p in top2),
        "table": {c: f2row(c) for c in ("A", "F2", "ALL", "ALL-D")},
    }
    # F3
    vctx = [ctx for ctx in order if group(ctx.job) in VERDICT_GROUPS]
    f3 = {
        "pages": len(vctx),
        "cuts": sum(ctx.f3().cuts_grid for ctx in vctx),
        "cuts_pages": [ctx.key for ctx in vctx if ctx.f3().cuts_grid],
        "no_grid": sum(ctx.f3().proposed is None for ctx in vctx),
        "grew": sum(tuple(ctx.f3().box) != tuple(ctx.pg.box) for ctx in vctx),
        "outside": {},
    }
    for c in ("F3", "ALL", "ALL-D"):
        b = [p["configs"][c] for p in vfr]
        k = [p["configs"][c] for p in vpages if p["role"] != "framing"]
        bo, bm = sum(r["outside_orig"] for r in b), sum(r["outside_orig_matched"] for r in b)
        co, cm = sum(r["outside_orig"] for r in k), sum(r["outside_orig_matched"] for r in k)
        f3["outside"][c] = {
            "beams": bo,
            "beams_matched": bm,
            "beams_prec": bm / bo if bo else None,
            "columns": co,
            "columns_matched": cm,
            "columns_prec": cm / co if co else None,
        }
    # gallery: A vs ALL, marks whose match status changed
    rng = random.Random(SEED)
    GALLERY.mkdir(parents=True, exist_ok=True)
    for f in GALLERY.glob("*.png"):
        f.unlink()
    changed: dict[str, list] = {"gained": [], "lost": []}
    byk = {ctx.key: ctx for ctx in order}
    for p in vpages:
        ctx = byk[p["key"]]
        a, b = p["configs"]["A"]["mark_matched"], p["configs"]["ALL"]["mark_matched"]
        marks = ctx.bmarks if p["role"] == "framing" else ctx.cmarks
        for k, m in enumerate(marks):
            if a[k] != b[k]:
                changed["gained" if b[k] else "lost"].append(
                    {
                        "key": (p["job"], p["page"], round(m[0], 1), round(m[1], 1)),
                        "m": m,
                        "page": p["key"],
                    }  # fmt: skip
                )
    sample = stratified({k: v for k, v in changed.items() if v}, 10, ("gained", "lost"), rng)
    entries = []
    for n, (status, it) in enumerate(sample, start=1):
        p = pages[it["page"]]
        ctx = byk[it["page"]]
        kind = "beam" if p["role"] == "framing" else "column"
        cap = (f"{it['page']} | {kind} mark {status} | pen A {p['configs']['A']['pen'] or '-'}"
               f" -> ALL {p['configs']['ALL']['pen'] or '-'}")  # fmt: skip
        name = f"{n:02d}-{status}-{kind}.png"
        gallery_image(GALLERY / name, ctx, it["m"], p["configs"]["A"], p["configs"]["ALL"], cap)
        entries.append((name, cap))
    (GALLERY / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>Phase 13c gallery</title>"
        "<style>body{font-family:sans-serif;margin:16px}img{max-width:100%;border:1px solid #ccc}"
        "figure{margin:0 0 28px}</style><h1>Phase 13c: before (A) and after (ALL), private</h1>"
        f"<p>Seed {SEED}. Marks whose 36 pt match changed between A and ALL.</p>"
        + "\n".join(
            f"<figure><img src='{html.escape(n)}' loading='lazy'>"
            f"<figcaption>{html.escape(c)}</figcaption></figure>"
            for n, c in entries
        )
    )
    for doc in docs:
        doc.close()
    for p in plist:
        for r in p["configs"].values():
            r.pop("_pieces", None)
    out = {
        "prereg_sha256": digest,
        "n_pages": len(plist),
        "pages": plist,
        "summary": summary,
        "guard": guard,
        "f1": f1,
        "f2": f2,
        "f3": f3,
        "plan_notes": sorted(plan_notes),
        "plan_rebuilt_differs": differs,
        "census": census,
        "gallery": {
            "gained": sum(s == "gained" for s, _ in sample),
            "lost": sum(s == "lost" for s, _ in sample),
        },  # fmt: skip
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, default=str))
    DOC.write_text(report(json.loads(OUT.read_text())))
    for c in CONFIGS:
        s = summary[c]["verdict (dev + strict)"]
        bar = "met" if s["bar_met"] else "not met"
        print(f"{c}: beams {s['beams_within']}/{s['framing_pages']}, columns"
              f" {s['columns_within']}/{s['column_pages']}, bar {bar}")  # fmt: skip
    print("wrote", OUT.relative_to(ROOT), DOC.relative_to(ROOT), GALLERY.relative_to(ROOT))


if __name__ == "__main__":
    main(sys.argv[1:])
