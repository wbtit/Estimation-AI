"""Phase 13b: the miss census (docs/PHASE13B_PREREGISTRATION.md; DEV jobs only, read-only).

  PYTHONPATH=. .venv/bin/python -m tools.p13b_miss

The pre-registration's hash (worker/prereg/PHASE13B.sha256) is verified first; the run stops when
it differs. Every verdict page of 12c-A / 13a is rebuilt IN MEMORY with the engine's `build_page`
and mode C's pen of 13a (recomputed with the 13a rule; the run stops when it differs from the saved
13a pen, when the rebuilt counts differ from 13a's, or when the misses are not 555 beam and 192
column marks). Each estimator B mark gets the first beam category that applies (matched,
removed_by_cleaning with the engine step, other_pen, not_single_line, split_or_merged,
no_line_near), each C mark a column category; the engine steps are re-run here from the engine's
own functions to see where a line or glyph was lost (no engine code is changed). Writes the private
fixtures/private/eval/p13b/miss.json and gallery/, and the local docs/PHASE13B_RESULTS.md; prints
counts only.
"""

from __future__ import annotations

import collections
import html
import itertools
import json
import math
import random
import sys
from typing import Any

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

from src.build.base_plates import in_plate
from src.build.beam_lines import beam_lines, dash_ids, parse_pen_class, pen_segments
from src.build.clean import arrow_points, text_mask
from src.build.columns import (
    GLYPH_ASPECT,
    GLYPH_LONG_MAX,
    GLYPH_LONG_MIN,
    GLYPH_MAX_VERTS,
    GLYPH_SHORT_MIN,
    STROKE_GAP_PT,
    Glyph,
    _TextIndex,
    column_like,
    column_plan_columns,
    find_glyphs,
    stroke_glyphs,
)
from src.build.geom import clip_segment, in_box
from src.build.not_beams import not_beams
from src.build.page import MIN_CROSSINGS, Setup, build_page
from src.build.propose import displayed_size
from src.build.register import project_columns
from src.build.segments import MIN_SEG_PT, crop, page_text_lines, parse_page
from src.config import load_config
from src.db import connect
from src.linking.lines import page_lines
from src.linking.structural import lines_in_box
from src.review.line_roles import HATCH, assign_roles, dimension_lines
from tools.p12c_eval import PEN_MIN_IN, _font, _render, one_to_one, seg_dist
from tools.p12c_lib import BEAM, COLUMN, JOBS, group, project_name, their_pages
from tools.p13a_pen import VERDICT_GROUPS, Page, best_pen, pieces_of
from tools.prereg import verify
from tools.takeoff.common import PRIVATE, ROOT

PREREG = ROOT / "docs" / "PHASE13B_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE13B.sha256"
P13A = PRIVATE / "eval" / "p13a" / "pen.json"
OUT = PRIVATE / "eval" / "p13b" / "miss.json"
GALLERY = PRIVATE / "eval" / "p13b" / "gallery"
DOC = ROOT / "docs" / "PHASE13B_RESULTS.md"

R_PRIMARY = 36.0
R_SENS = (48.0, 72.0)
MATCH_PT = 36.0  # the 12c-A one-to-one matching, also in the sensitivity runs
ON_LINE_PT = 1.0  # a tracked segment: both ends this close to the raw line, inside its extent
PAR_DEG, PAR_MIN_PT, PAR_MAX_PT, PAR_OVERLAP = 2.0, 0.75, 12.0, 0.5
COL_DEG, COL_OFF_PT, COL_GAP_PT = 1.0, 1.0, 36.0
COVER_SHARE, PENS_MAX = 0.8, 5
SHAPE_LONG_MAX_PT = 72.0
SQUARE_ASPECT = 1.2
SEED = 13
EXPECT_BEAM_MISSES, EXPECT_COLUMN_MISSES = 555, 192

BEAM_CATS = (
    "matched",
    "removed_by_cleaning",
    "other_pen",
    "not_single_line",
    "split_or_merged",
    "no_line_near",
)
CLEAN_STEPS = (
    "crop",
    "hatch",
    "dimension",
    "text_strokes",
    "dashed",
    "grid",
    "length_filter",
    "wall_band",
    "base_plate",
    "column_shape",
    "other",
)
COL_CATS = (
    "matched",
    "outside_crop",
    "column_shared",
    "removed_by_step",
    "shape_not_recognised",
    "no_geometry_near",
)
COL_STEPS = (
    "grid_marker",
    "not_at_grid",
    "other_glyph_at_crossing",
    "not_column_like",
    "not_repeated_symbol",
    "replaced_by_base_plate",
)

Seg = tuple[float, float, float, float]
SAME_PLAN = object()  # Census: the page's own column plan
Pt = tuple[float, float]


# --- pure rules (synthetic tests in tests/test_p13b_miss.py) -------------------------------------


def classify_beam(f: dict[str, Any]) -> tuple[str, str | None]:
    """(category, step or subtype) from the facts of one mark, first category that applies."""
    if f["matched"]:
        return "matched", None
    if f["c_raw_near"] and not f["ours_near"]:
        return "removed_by_cleaning", f["step"]
    if not f["c_raw_near"] and not f["ours_near"] and f["other_raw_near"]:
        return "other_pen", f["other_pen_diff"]
    if not f["any_raw_near"] and not f["ours_near"] and f["geometry"]:
        return "not_single_line", f["geometry"]
    if f["ours_near"]:
        if f["merged"]:
            return "split_or_merged", "merged"
        if f["joist_near"]:
            return "split_or_merged", "joist_label"
        return "split_or_merged", "no_piece"
    return "no_line_near", "strokes_near" if f["strokes_near"] else "nothing_near"


def first_lost(stages: list[tuple[str, bool, dict[str, float]]]) -> str:
    """The first stage after which nothing near survives: (name, survives, lost length per reason);
    a stage with reasons gives the reason with the most length (ties: the order given)."""
    for name, survives, reasons in stages:
        if survives:
            continue
        if reasons:
            return max(reasons, key=lambda k: (reasons[k], -list(reasons).index(k)))
        return name
    return "other"


def pens_needed(cover: dict[str, set[int]], n_marks: int, share: float = COVER_SHARE) -> int | str:
    """Smallest number of pens whose marks reach `share` of all marks (exact, up to PENS_MAX)."""
    need = math.ceil(share * n_marks - 1e-9)
    if n_marks == 0:
        return "no marks"
    if len(set().union(*cover.values()) if cover else set()) < need:
        return "not reachable"
    pens = sorted(cover)
    for k in range(1, PENS_MAX + 1):
        for combo in itertools.combinations(pens, k):
            if len(set().union(*(cover[p] for p in combo))) >= need:
                return k
    return f"more than {PENS_MAX}"


def pen_diff(a: str, b: str) -> str:
    """How pen class b differs from a: width, colour, style (any combination)."""
    pa, pb = parse_pen_class(a), parse_pen_class(b)
    out = [n for n, x, y in zip(("width", "colour", "style"), pa, pb, strict=True) if x != y]
    return "+".join(out) or "same"


def corners(pts: list[Pt]) -> list[Pt]:
    """Distinct corners of an outline (repeated points and the closing point dropped)."""
    out: list[Pt] = []
    for p in pts:
        q = (round(p[0], 1), round(p[1], 1))
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def shape_type(pts: list[Pt], curved: bool) -> str:
    if curved:
        return "circle"
    c = corners(pts)
    if len(c) == 4:
        xs, ys = [p[0] for p in c], [p[1] for p in c]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        lo, hi = min(w, h), max(w, h)
        return "square" if lo > 0 and hi / lo <= SQUARE_ASPECT else "rect"
    if len(c) == 12:
        return "I"
    return "other"


def stratified(
    groups: dict[str, list[Any]], n: int, order: tuple[str, ...], rng: random.Random
) -> list[tuple[str, Any]]:
    """n items: an equal share per category; slots a category cannot fill go one at a time to the
    categories with the most items left (ties: the order). Items are sorted before sampling."""
    cats = [c for c in order if c in groups]
    if not cats:
        return []
    want = {c: min(n // len(cats), len(groups[c])) for c in cats}
    left = n - sum(want.values())
    while left > 0:
        avail = [c for c in cats if len(groups[c]) > want[c]]
        if not avail:
            break
        c = max(avail, key=lambda c: (len(groups[c]) - want[c], -cats.index(c)))
        want[c] += 1
        left -= 1
    out = []
    for c in cats:
        items = sorted(groups[c], key=lambda it: it["key"])
        out += [(c, it) for it in rng.sample(items, want[c])]
    return out


def dists(p: Pt, segs: np.ndarray) -> np.ndarray:
    """Point to segment distances (segments as rows x0 y0 x1 y1)."""
    if len(segs) == 0:
        return np.zeros(0)
    a, b = segs[:, :2], segs[:, 2:4]
    ab = b - a
    ll = (ab**2).sum(1)
    t = np.where(ll > 0, ((np.asarray(p) - a) * ab).sum(1) / np.where(ll > 0, ll, 1), 0.0)
    t = np.clip(t, 0.0, 1.0)
    q = a + ab * t[:, None]
    return np.hypot(q[:, 0] - p[0], q[:, 1] - p[1])


def on_line(segs: np.ndarray, line: Seg, tol: float = ON_LINE_PT) -> np.ndarray:
    """Segments with both ends within tol of the line (perpendicular) and inside its extent."""
    x0, y0, x1, y1 = line
    L = math.hypot(x1 - x0, y1 - y0)
    if L == 0 or len(segs) == 0:
        return np.zeros(len(segs), dtype=bool)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    ok = np.ones(len(segs), dtype=bool)
    for cx, cy in ((0, 1), (2, 3)):
        dx, dy = segs[:, cx] - x0, segs[:, cy] - y0
        t = dx * ux + dy * uy
        off = np.abs(-dx * uy + dy * ux)
        ok &= (off <= tol) & (t >= -tol) & (t <= L + tol)
    return ok


def _angle(s) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def _adiff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def parallel_partner(segs: np.ndarray, i: int) -> bool:
    s = segs[i]
    L = math.hypot(s[2] - s[0], s[3] - s[1])
    if L == 0:
        return False
    ux, uy = (s[2] - s[0]) / L, (s[3] - s[1]) / L
    a = _angle(s)
    for j in range(len(segs)):
        if j == i:
            continue
        o = segs[j]
        Lo = math.hypot(o[2] - o[0], o[3] - o[1])
        if Lo == 0 or _adiff(_angle(o), a) > PAR_DEG:
            continue
        mx, my = (o[0] + o[2]) / 2 - s[0], (o[1] + o[3]) / 2 - s[1]
        off = abs(-mx * uy + my * ux)
        if not PAR_MIN_PT <= off <= PAR_MAX_PT:
            continue
        t0 = (o[0] - s[0]) * ux + (o[1] - s[1]) * uy
        t1 = (o[2] - s[0]) * ux + (o[3] - s[1]) * uy
        cover = max(0.0, min(max(t0, t1), L) - max(min(t0, t1), 0.0))
        if cover >= PAR_OVERLAP * min(L, Lo):
            return True
    return False


def collinear_span(segs: np.ndarray, i: int) -> float:
    """Span of the collinear run through segment i (gaps up to COL_GAP_PT)."""
    s = segs[i]
    L = math.hypot(s[2] - s[0], s[3] - s[1])
    if L == 0:
        return 0.0
    ux, uy = (s[2] - s[0]) / L, (s[3] - s[1]) / L
    a = _angle(s)
    iv = []
    for o in segs:
        if math.hypot(o[2] - o[0], o[3] - o[1]) == 0 or _adiff(_angle(o), a) > COL_DEG:
            continue
        offs = [abs(-(o[k] - s[0]) * uy + (o[k + 1] - s[1]) * ux) for k in (0, 2)]
        if max(offs) > COL_OFF_PT:
            continue
        t0 = (o[0] - s[0]) * ux + (o[1] - s[1]) * uy
        t1 = (o[2] - s[0]) * ux + (o[3] - s[1]) * uy
        iv.append((min(t0, t1), max(t0, t1)))
    iv.sort()
    lo, hi = 0.0, L
    changed = True
    while changed:
        changed = False
        for a0, a1 in iv:
            if a1 >= lo - COL_GAP_PT and a0 <= hi + COL_GAP_PT and (a0 < lo or a1 > hi):
                lo, hi = min(lo, a0), max(hi, a1)
                changed = True
    return hi - lo


# --- one page -------------------------------------------------------------------------------------


class Census:
    """The engine's steps of one page re-run with C's pen, keeping what each step took away."""

    def __init__(
        self,
        pg: Page,
        pen: str | None,
        as_stored: bool,
        box=None,
        flags: frozenset[str] = frozenset(),
        gap: float = STROKE_GAP_PT,
        plan: Any = SAME_PLAN,
    ):
        """Phase 13c: `box`, `flags`, `gap` and `plan` give a configuration's crop, build flags,
        stroke end gap and column plan (defaults: the page's own, as in 13b)."""
        self.pg, self.pen = pg, pen
        self.box = box = pg.box if box is None else box
        self.plan = pg.plan if plan is SAME_PLAN else plan
        self.flags, self.gap = frozenset(flags), gap
        page = pg.page
        setup = Setup(
            box,
            pg.ratio,
            pg.tos,
            pen,
            pg.role,
            str(pg.inputs.get("crossing_rule") or "family"),
            pens=pg.view_pens if as_stored else ((pen,) if pen else ()),
            flags=self.flags,
            stroke_gap_pt=gap,
        )
        self.setup = setup
        self.pb = build_page(page, setup, pg.text, pg.legend, self.plan)
        self.pieces = pieces_of(self.pb, pg.ratio)
        text_all = pg.text if pg.text is not None else page_text_lines(page)
        self.text = [t for t in text_all if in_box(t.centre, box)]
        self.full = parse_page(page)
        self.ps = crop(self.full, box)
        # full -> cropped segment index (the crop step's own rule)
        self.to_crop = np.full(len(self.full), -1, dtype=int)
        k = 0
        for i, (x0, y0, x1, y1) in enumerate(self.full.seg):
            c = clip_segment((x0, y0), (x1, y1), box)
            if c is None or math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < MIN_SEG_PT:
                continue
            self.to_crop[i] = k
            k += 1
        if k != len(self.ps):
            raise SystemExit("crop index differs from the engine's crop")
        min_pt = PEN_MIN_IN * 72.0 / pg.ratio
        w, h = displayed_size(page)
        self.all_lines = lines_in_box(page_lines(page), (0.0, 0.0, w, h), (w, h))
        self.raw = [ln for ln in self.all_lines if ln.length >= min_pt]
        self.raw_seg = np.asarray([(ln.x0, ln.y0, ln.x1, ln.y1) for ln in self.raw]).reshape(-1, 4)
        self.raw_pen = [ln.klass for ln in self.raw]
        self.min_pt = min_pt
        # non-text segments of the whole page
        all_text = [t.box for t in text_all]
        self.full_text = text_mask(self.full, all_text) if len(self.full) else np.zeros(0, bool)
        self.full_nontext = np.flatnonzero(~self.full_text)
        self._dash_cache: dict[tuple[str, str], set[int]] = {}
        self.full_pens = [self.full.pen(i) for i in range(len(self.full))]
        self._ids_cache: dict[tuple[str, str], np.ndarray] = {}
        self.shape_by_id = {s.id: s for s in self.full.shapes}
        if pg.role == "framing":
            self._framing_steps()
        else:
            self._column_steps()

    # ---- beams ----
    def _framing_steps(self) -> None:
        ps, pb = self.ps, self.pb
        n = len(ps)
        roles = assign_roles(ps.seg, ps.width) if n else np.zeros(0, int)
        hatch = roles == HATCH
        numbers = [t.centre for t in self.text if any(ch.isdigit() for ch in t.text)]
        dim = (
            dimension_lines(ps.seg, roles, arrow_points(ps), numbers) & ~hatch
            if n
            else np.zeros(0, bool)
        )
        txt = text_mask(ps, [t.box for t in self.text]) & ~hatch & ~dim if n else dim
        self.keep = ~(hatch | dim | txt)
        if not np.array_equal(self.keep, pb.cleaned.keep):
            raise SystemExit("clean step differs from the engine's")
        self.reason = {"hatch": hatch, "dimension": dim, "text_strokes": txt}
        if self.pen:
            ids = pen_segments(ps, self.keep, self.pen)
            dashes, _ = dash_ids(ps, ids)
            style = parse_pen_class(self.pen)[2]
            self.use = {i for i in ids if (i in dashes) == (style == "dash")}
            self.pre = beam_lines(ps, self.keep, self.pen, {})
        else:
            self.use, self.pre = set(), []
        # the not-beams step with the build's own column points
        projected = []
        reg = pb.registration
        if self.plan is not None and reg is not None and reg.ok:
            pts = project_columns(
                [p for p, _ in self.plan.columns], self.plan.ratio, reg, self.pg.ratio
            )
            projected = [p for p in pts if in_box(p, self.box)]
        nb = not_beams(
            self.pre,
            ps,
            pb.cleaned,
            self.pg.ratio,
            [g.centre for g in pb.glyphs] + projected + [p.centre for p in pb.plates],
            pb.plates,
            wall_same_pen="wall_same_pen" in self.flags,
        )
        if len(nb.lines) != len(pb.lines):
            raise SystemExit("not-beams step differs from the engine's")
        self.nb_rule = {i: "wall_band" for i in nb.wall}
        self.nb_rule.update({i: "base_plate" for i in nb.base_plate})
        self.nb_rule.update({i: "column_shape" for i in nb.column_shape})
        self.pre_seg = np.asarray([(*ln.p0, *ln.p1) for ln in self.pre]).reshape(-1, 4)
        self.final_seg = np.asarray([(*ln.p0, *ln.p1) for ln in pb.lines]).reshape(-1, 4)
        self.beam_idx = [
            j for j, p in enumerate(self.pieces) if p["kind"] == "Beams" and p["type"] != "column"
        ]
        self.joist_idx = [j for j, p in enumerate(self.pieces) if p["kind"] == "Joist"]
        self.beam_seg = np.asarray([self.pieces[j]["page"] for j in self.beam_idx]).reshape(-1, 4)
        self.joist_seg = np.asarray([self.pieces[j]["page"] for j in self.joist_idx]).reshape(-1, 4)

    def full_ids_of(self, key: tuple[str, str]) -> np.ndarray:
        if key not in self._ids_cache:
            self._ids_cache[key] = np.asarray(
                [i for i, k in enumerate(self.full_pens) if k == key], dtype=int
            )
        return self._ids_cache[key]

    def _dashes_of(self, i: int) -> set[int]:
        key = self.full_pens[i]
        if key not in self._dash_cache:
            self._dash_cache[key] = dash_ids(self.full, self.full_ids_of(key).tolist())[0]
        return self._dash_cache[key]

    def beam_facts(self, m: Pt, r: float, matched: dict[int, int], k: int) -> dict[str, Any]:
        d_raw = dists(m, self.raw_seg)
        near_raw = np.flatnonzero(d_raw <= r)
        c_near = [i for i in near_raw if self.raw_pen[i] == self.pen]
        other_near = sorted(
            (d_raw[i], self.raw_pen[i]) for i in near_raw if self.raw_pen[i] != self.pen
        )
        ours_near = bool((dists(m, self.final_seg) <= r).any())
        f: dict[str, Any] = {
            "matched": k in matched,
            "c_raw_near": bool(c_near),
            "ours_near": ours_near,
            "other_raw_near": bool(other_near),
            "any_raw_near": bool(len(near_raw)),
            "nearest_raw_pt": round(float(d_raw.min()), 1) if len(d_raw) else None,
            "step": None,
            "other_pen": None,
            "other_pen_diff": None,
            "geometry": None,
            "merged": False,
            "joist_near": False,
            "strokes_near": False,
        }
        if f["matched"]:
            return f
        if c_near and not ours_near:
            f["step"] = self._step(m, r, [self.raw[i] for i in c_near])
        if other_near:
            f["other_pen"] = other_near[0][1]
            f["other_pen_diff"] = pen_diff(self.pen, other_near[0][1]) if self.pen else "no_pen"
        if ours_near:
            bd = dists(m, self.beam_seg)
            mine = {v: s for s, v in matched.items()}
            f["merged"] = any(bd[j] <= r and mine.get(j, k) != k for j in range(len(self.beam_idx)))
            f["joist_near"] = bool((dists(m, self.joist_seg) <= r).any())
        if not len(near_raw) and not ours_near:
            nt = self.full_nontext
            dn = dists(m, self.full.seg[nt])
            if len(dn) and dn.min() <= r:
                f["strokes_near"] = True
                f["geometry"] = self._geometry(int(nt[int(dn.argmin())]))
        return f

    def _step(self, m: Pt, r: float, lines) -> str:
        full = self.full
        width, colour, _ = parse_pen_class(self.pen)
        pen_ids = self.full_ids_of((width, colour))
        tracked: set[int] = set()
        for ln in lines:
            ok = on_line(full.seg[pen_ids], (ln.x0, ln.y0, ln.x1, ln.y1))
            tracked |= set(pen_ids[ok].tolist())
        if not tracked:
            return "other"
        crop_ids = [int(self.to_crop[i]) for i in sorted(tracked) if self.to_crop[i] >= 0]
        cd = dists(m, self.ps.seg[crop_ids]) if crop_ids else np.zeros(0)
        near = [c for c, d in zip(crop_ids, cd, strict=True) if d <= r]
        L = self.ps.length()
        kept = [c for c in near if self.keep[c]]
        lost = {
            name: float(sum(L[c] for c in near if mask[c])) for name, mask in self.reason.items()
        }
        used = [c for c in kept if c in self.use]
        pre_near = np.flatnonzero(dists(m, self.pre_seg) <= r)
        nb = collections.Counter()
        for i in pre_near:
            if i in self.nb_rule:
                ln = self.pre[i]
                nb[self.nb_rule[i]] += ln.length
        return first_lost(
            [
                ("crop", bool(near), {}),
                ("clean", bool(kept), {k: v for k, v in lost.items() if v > 0}),
                ("dashed", bool(used), {}),
                ("length_filter", bool(len(pre_near)), {}),
                (
                    "not_beams",
                    any(i not in self.nb_rule for i in pre_near),
                    {k: nb[k] for k in ("wall_band", "base_plate", "column_shape") if nb[k]},
                ),
            ]
        )

    def _geometry(self, i: int) -> str | None:
        full = self.full
        if full.pdf_dashed[i] or i in self._dashes_of(i):
            return "dashed_hidden"
        sh = self.shape_by_id.get(int(full.shape_id[i]))
        if sh is not None and sh.closed and len(corners(sh.pts)) == 4:
            return "double_or_rect"
        segs = full.seg
        s = segs[i]
        box = (
            min(s[0], s[2]) - 60,
            min(s[1], s[3]) - 60,
            max(s[0], s[2]) + 60,
            max(s[1], s[3]) + 60,
        )
        local = np.flatnonzero(
            (np.minimum(segs[:, 0], segs[:, 2]) <= box[2])
            & (np.maximum(segs[:, 0], segs[:, 2]) >= box[0])
            & (np.minimum(segs[:, 1], segs[:, 3]) <= box[3])
            & (np.maximum(segs[:, 1], segs[:, 3]) >= box[1])
        )
        li = int(np.flatnonzero(local == i)[0])
        if parallel_partner(segs[local], li):
            return "double_or_rect"
        wide = np.flatnonzero(
            (np.minimum(segs[:, 0], segs[:, 2]) <= max(s[0], s[2]) + self.min_pt + COL_GAP_PT)
            & (np.maximum(segs[:, 0], segs[:, 2]) >= min(s[0], s[2]) - self.min_pt - COL_GAP_PT)
            & (np.minimum(segs[:, 1], segs[:, 3]) <= max(s[1], s[3]) + self.min_pt + COL_GAP_PT)
            & (np.maximum(segs[:, 1], segs[:, 3]) >= min(s[1], s[3]) - self.min_pt - COL_GAP_PT)
        )
        wi = int(np.flatnonzero(wide == i)[0])
        if collinear_span(segs[wide], wi) >= self.min_pt:
            return "broken"
        return None

    # ---- columns ----
    def _column_steps(self) -> None:
        pb = self.pb
        self.glyphs_all = find_glyphs(self.ps, self.box, pb.bubbles, self.text, pb.crossings)
        if "column_strokes" in self.flags:
            self.glyphs_all += stroke_glyphs(
                self.ps,
                pb.cleaned.keep,
                self.box,
                pb.bubbles,
                self.text,
                pb.crossings,
                list(self.glyphs_all),
                self.gap,
            )
        kept = {tuple(g.shape_ids) for g in pb.glyphs}
        self.markers = {tuple(g.shape_ids) for g in self.glyphs_all} - kept
        self.col_keys = {tuple(g.shape_ids) for g in pb.columns if g.shape_ids}
        has_grid = len(pb.crossings) >= MIN_CROSSINGS
        chosen, _ = column_plan_columns(
            pb.glyphs,
            has_grid,
            self.pg.ratio,
            {sh.id: sh for sh in self.ps.shapes} if "column_off_grid" in self.flags else None,
        )
        self.chosen = {tuple(g.shape_ids) for g in chosen}
        self.grid_rule = (pb.column_rule or "").startswith("glyph_at_grid")
        self.col_pts = [(p["page"][0], p["page"][1]) for p in self.pieces if p["type"] == "column"]
        self.bubble_shapes = {b.shape for b in pb.bubbles}
        self.text_index = _TextIndex([t.box for t in self.text])
        crop_text = (
            text_mask(self.ps, [t.box for t in self.text]) if len(self.ps) else np.zeros(0, bool)
        )
        self.crop_nontext = np.flatnonzero(~crop_text)

    def glyph_step(self, g: Glyph) -> str:
        key = tuple(g.shape_ids)
        if key in self.markers:
            return "grid_marker"
        if key in self.chosen and in_plate(self.pb.plates, g.centre):
            return "replaced_by_base_plate"
        if self.grid_rule:
            return "other_glyph_at_crossing" if g.at_grid else "not_at_grid"
        if not column_like(g, self.pg.ratio):
            return "not_column_like"
        return "not_repeated_symbol"

    def reject_rule(self, sh) -> str:
        if sh.id in self.bubble_shapes:
            return "grid_bubble"
        if not (sh.closed or "f" in sh.paint):
            return "not_closed"
        if not 3 <= len(sh.pts) <= GLYPH_MAX_VERTS:
            return "vertex_count"
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        lo, hi = min(w, h), max(w, h)
        if not GLYPH_LONG_MIN <= hi <= GLYPH_LONG_MAX or lo < GLYPH_SHORT_MIN:
            return "size"
        if hi / lo > GLYPH_ASPECT:
            return "aspect"
        if self.text_index.contains(sh.bbox):
            return "inside_text"
        return "merged_into_other_glyph"

    def column_facts(self, m: Pt, r: float, matched: dict[int, int], k: int) -> dict[str, Any]:
        f: dict[str, Any] = {"matched": k in matched}
        if f["matched"]:
            return {**f, "category": "matched"}
        if not in_box(m, self.box):
            return {**f, "category": "outside_crop"}
        mine = {v: s for s, v in matched.items()}
        if any(math.dist(m, p) <= r and mine.get(j, k) != k for j, p in enumerate(self.col_pts)):
            return {**f, "category": "column_shared"}
        near = sorted(
            (math.dist(m, g.centre), i)
            for i, g in enumerate(self.glyphs_all)
            if math.dist(m, g.centre) <= r and tuple(g.shape_ids) not in self.col_keys
        )
        if near:
            g = self.glyphs_all[near[0][1]]
            sh = self.shape_by_id.get(g.shape_ids[0])
            return {
                **f,
                "category": "removed_by_step",
                "step": self.glyph_step(g),
                "shape": shape_type(sh.pts, g.curved) if sh else "other",
            }
        shapes = []
        for sh in self.ps.shapes:
            c = ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
            w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
            if math.dist(m, c) <= r and max(w, h) <= SHAPE_LONG_MAX_PT:
                shapes.append((-(w * h), sh.id, sh))
        if shapes:
            sh = min(shapes, key=lambda t: (t[0], t[1]))[2]
            return {
                **f,
                "category": "shape_not_recognised",
                "shape": shape_type(sh.pts, sh.curved),
                "rule": self.reject_rule(sh),
                "shape_id": sh.id,
            }
        nt = self.crop_nontext
        if len(nt) and dists(m, self.ps.seg[nt]).min() <= r:
            return {
                **f,
                "category": "shape_not_recognised",
                "shape": "open_strokes",
                "rule": "not_closed",
            }
        return {**f, "category": "no_geometry_near"}


# --- run ------------------------------------------------------------------------------------------


def c_pen_counts(pg: Page) -> dict[str, int]:
    """Beam count per candidate pen (the 13a mode C rule picks from these)."""
    pens = sorted({pen for _, pen in pg.candidates()})
    counts = {}
    for p in pens:
        b = pg.build(p)
        counts[p] = sum(1 for x in b if x["kind"] == "Beams" and x["type"] != "column")
    return counts


def run_page(pg: Page, theirs, saved: dict) -> dict[str, Any]:
    rec: dict[str, Any] = {}
    if pg.role == "framing":
        marks = [(s.x, s.y) for s in theirs.symbols if s.prefix == BEAM]
        pen = best_pen(c_pen_counts(pg), len(marks), pg.auto)
        used = pen if pen is not None else pg.auto
        if used != saved["pen"]:
            raise SystemExit(f"C pen differs from 13a on a page: {used} != {saved['pen']}")
        cs = Census(pg, used, as_stored=pen is None)
        bseg = cs.beam_seg.tolist()
        if len(bseg) != saved["ours_beams"]:
            raise SystemExit("C beam count differs from 13a")
        matched = one_to_one(marks, [tuple(s) for s in bseg], seg_dist, MATCH_PT)
        rows = []
        for k, m in enumerate(marks):
            row: dict[str, Any] = {"x": round(m[0], 1), "y": round(m[1], 1)}
            for r in (R_PRIMARY, *R_SENS):
                f = cs.beam_facts(m, r, matched, k)
                cat, det = classify_beam(f)
                if r == R_PRIMARY:
                    row.update(category=cat, detail=det, facts=f)
                else:
                    row[f"r{int(r)}"] = [cat, det]
            rows.append(row)
        cover: dict[str, set[int]] = collections.defaultdict(set)
        for k, m in enumerate(marks):
            d = dists(m, cs.raw_seg)
            for i in np.flatnonzero(d <= R_PRIMARY):
                cover[cs.raw_pen[i]].add(k)
        rec.update(pen=used, marks=rows, pens_needed=pens_needed(dict(cover), len(marks)))
        rec["n_unmatched"] = len(marks) - len(matched)
        return rec, cs
    marks = [(s.x, s.y) for s in theirs.symbols if s.prefix == COLUMN]
    cs = Census(pg, pg.auto, as_stored=True)
    if len(cs.col_pts) != saved["ours_columns"]:
        raise SystemExit("column count differs from 13a")
    matched = one_to_one(marks, cs.col_pts, math.dist, MATCH_PT)
    rows = []
    for k, m in enumerate(marks):
        f = cs.column_facts(m, R_PRIMARY, matched, k)
        rows.append({"x": round(m[0], 1), "y": round(m[1], 1), **f})
    rec.update(marks=rows, n_unmatched=len(marks) - len(matched))
    return rec, cs


# --- gallery --------------------------------------------------------------------------------------

WIN_PT = 240.0
ZOOM = 3.0
PALETTE = [
    (230, 25, 75), (60, 180, 75), (0, 130, 200), (245, 130, 48), (145, 30, 180), (70, 240, 240),
    (240, 50, 230), (128, 128, 0), (0, 128, 128), (170, 110, 40), (128, 0, 0), (0, 0, 128),
]  # fmt: skip


def _window(page, m: Pt) -> tuple[float, float, float, float]:
    w, h = displayed_size(page)
    half = WIN_PT / 2
    x0 = min(max(m[0] - half, 0.0), max(w - WIN_PT, 0.0))
    y0 = min(max(m[1] - half, 0.0), max(h - WIN_PT, 0.0))
    return (x0, y0, min(x0 + WIN_PT, w), min(y0 + WIN_PT, h))


def gallery_image(path, cs: Census, m: Pt, caption: str, column: bool, extra=None) -> None:
    page = cs.pg.page
    box = _window(page, m)
    size = (int(WIN_PT * ZOOM), int(WIN_PT * ZOOM))
    p1 = Image.new("RGB", size, (235, 235, 235))
    p1.paste(_render(page, box, ZOOM), (0, 0))
    p2 = Image.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(p2)
    P = lambda x, y: ((x - box[0]) * ZOOM, (y - box[1]) * ZOOM)  # noqa: E731
    inside = lambda s: not (  # noqa: E731
        max(s[0], s[2]) < box[0] or min(s[0], s[2]) > box[2]
        or max(s[1], s[3]) < box[1] or min(s[1], s[3]) > box[3]
    )  # fmt: skip
    legend: list[tuple[str, tuple[int, int, int]]] = []
    if column:
        for s in cs.ps.seg:
            if inside(s):
                d.line([P(s[0], s[1]), P(s[2], s[3])], fill=(150, 150, 150), width=1)
        for g in cs.glyphs_all:
            a, b = P(g.box[0], g.box[1]), P(g.box[2], g.box[3])
            d.rectangle([a, b], outline=(245, 130, 48), width=3)
        for p in cs.col_pts:
            a = P(*p)
            d.rectangle(
                [a[0] - 10, a[1] - 10, a[0] + 10, a[1] + 10], outline=(0, 160, 140), width=4
            )
        if extra is not None:
            sh = cs.shape_by_id.get(extra)
            if sh is not None:
                d.rectangle(
                    [P(sh.bbox[0], sh.bbox[1]), P(sh.bbox[2], sh.bbox[3])],
                    outline=(230, 25, 75),
                    width=3,
                )
        legend = [
            ("raw geometry", (150, 150, 150)),
            ("found glyphs", (245, 130, 48)),
            ("our columns", (0, 160, 140)),
            ("shape looked at", (230, 25, 75)),
        ]
    else:
        lines = [ln for ln in cs.all_lines if inside((ln.x0, ln.y0, ln.x1, ln.y1))]
        pens = sorted({ln.klass for ln in lines}, key=lambda k: (k != cs.pen, k))
        colour = {
            p: (0, 0, 0) if p == cs.pen else PALETTE[i % len(PALETTE)] for i, p in enumerate(pens)
        }
        for ln in lines:
            wdt = 2 if ln.length >= cs.min_pt else 1
            d.line([P(ln.x0, ln.y0), P(ln.x1, ln.y1)], fill=colour[ln.klass], width=wdt)
        for s in cs.beam_seg:
            d.line([P(s[0], s[1]), P(s[2], s[3])], fill=(255, 0, 200), width=7)
        for s in cs.joist_seg:
            d.line([P(s[0], s[1]), P(s[2], s[3])], fill=(120, 120, 120), width=7)
        legend = [("our beam pieces", (255, 0, 200)), ("joist pieces", (120, 120, 120))] + [
            (("C pen " if p == cs.pen else "") + p, colour[p]) for p in pens[:10]
        ]
    c = P(*m)
    rr = R_PRIMARY * ZOOM
    for im in (p1, p2):
        dd = ImageDraw.Draw(im)
        dd.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=(0, 90, 255), width=4)
        dd.ellipse([c[0] - 6, c[1] - 6, c[0] + 6, c[1] + 6], fill=(0, 90, 255))
    gap = 16
    W, H = size[0] * 2 + gap * 3 + 360, size[1] + 100
    out = Image.new("RGB", (W, H), (255, 255, 255))
    o = ImageDraw.Draw(out)
    for i, (im, t) in enumerate(((p1, "drawing"), (p2, "overlay"))):
        x = gap + i * (size[0] + gap)
        o.text((x, 6), t, fill=(40, 40, 40), font=_font(22))
        out.paste(im, (x, 36))
    lx = gap * 3 + size[0] * 2
    o.text((lx, 36), "estimator mark (36 pt ring)", fill=(0, 90, 255), font=_font(16))
    for i, (t, col) in enumerate(legend):
        o.text((lx, 62 + 24 * i), t, fill=col, font=_font(16))
    o.text((gap, H - 52), caption, fill=(20, 20, 20), font=_font(20))
    out.save(path, optimize=True)


# --- summary and report ---------------------------------------------------------------------------


def summarise(pages: list[dict]) -> dict[str, Any]:
    v = [p for p in pages if p["group"] in VERDICT_GROUPS]
    fr = [p for p in v if p["role"] == "framing"]
    cp = [p for p in v if p["role"] != "framing"]
    bm = [(p["job"], m) for p in fr for m in p["marks"]]
    cm = [(p["job"], m) for p in cp for m in p["marks"]]
    s: dict[str, Any] = {"framing_pages": len(fr), "column_pages": len(cp)}
    s["beam_marks"] = len(bm)
    s["beam_cats"] = dict(collections.Counter(m["category"] for _, m in bm))
    s["beam_per_job"] = {
        j: dict(collections.Counter(m["category"] for jj, m in bm if jj == j))
        for j in sorted({j for j, _ in bm})
    }
    s["beam_detail"] = {
        c: dict(collections.Counter(str(m["detail"]) for _, m in bm if m["category"] == c))
        for c in BEAM_CATS[1:]
    }
    s["sens"] = {
        str(int(r)): dict(collections.Counter(m[f"r{int(r)}"][0] for _, m in bm)) for r in R_SENS
    }
    s["sens_steps"] = {
        str(int(r)): dict(
            collections.Counter(
                str(m[f"r{int(r)}"][1])
                for _, m in bm
                if m[f"r{int(r)}"][0] == "removed_by_cleaning"
            )
        )
        for r in R_SENS
    }
    nl = [m["facts"]["nearest_raw_pt"] for _, m in bm if m["category"] == "no_line_near"]
    bins = [(36, 48), (48, 72), (72, 144), (144, None)]
    s["no_line_dist"] = {
        f"{a}-{b}" if b else f">{a}": sum(
            1 for x in nl if x is not None and x > a and (b is None or x <= b)
        )
        for a, b in bins
    }
    s["no_line_dist"]["no raw line"] = sum(1 for x in nl if x is None)
    s["pens_needed"] = dict(collections.Counter(str(p["pens_needed"]) for p in fr))
    s["other_pen_pages"] = sum(
        1 for p in fr if any(m["category"] == "other_pen" for m in p["marks"])
    )
    op = [p for p in fr]
    s["other_pen_by_need"] = dict(
        collections.Counter(
            _need_class(p["pens_needed"])
            for p in op
            for m in p["marks"]
            if m["category"] == "other_pen"
        )
    )
    s["column_marks"] = len(cm)
    s["col_cats"] = dict(collections.Counter(m["category"] for _, m in cm))
    s["col_per_job"] = {
        j: dict(collections.Counter(m["category"] for jj, m in cm if jj == j))
        for j in sorted({j for j, _ in cm})
    }
    s["col_steps"] = dict(
        collections.Counter(m["step"] for _, m in cm if m["category"] == "removed_by_step")
    )
    s["col_shapes"] = dict(
        collections.Counter(
            (m["category"], m.get("shape"), m.get("rule") or m.get("step"))
            for _, m in cm
            if m["category"] in ("removed_by_step", "shape_not_recognised")
        ).items()
    )
    s["col_shapes"] = [
        [*k, n] for k, n in sorted(s["col_shapes"].items(), key=lambda kv: (-kv[1], str(kv[0])))
    ]
    # causes
    causes = collections.Counter()
    for p in fr:
        for m in p["marks"]:
            c = beam_cause(m, p["pens_needed"])
            if c:
                causes[c] += 1
    s["beam_causes"] = _ranked(causes, BEAM_CAUSE_ORDER)
    cc = collections.Counter()
    for _, m in cm:
        if m["category"] == "matched":
            continue
        cc[m["category"] + (f": {m['step']}" if m["category"] == "removed_by_step" else "")] += 1
    s["column_causes"] = _ranked(cc, COL_CAUSE_ORDER)
    return s


def _need_class(n) -> str:
    return "1 pen" if n == 1 else "2 or more" if isinstance(n, int) else str(n)


def beam_cause(m: dict, need) -> str | None:
    c = m["category"]
    if c == "matched":
        return None
    if c == "removed_by_cleaning":
        return f"removed: {m['detail']}"
    if c == "other_pen":
        return f"other_pen: {_need_class(need)}"
    if c in ("not_single_line", "split_or_merged"):
        return f"{c}: {m['detail']}"
    return "no_line_near"


BEAM_CAUSE_ORDER = (
    [f"removed: {s}" for s in CLEAN_STEPS]
    + ["other_pen: 1 pen", "other_pen: 2 or more", f"other_pen: more than {PENS_MAX}",
       "other_pen: not reachable"]
    + [f"not_single_line: {s}" for s in ("dashed_hidden", "double_or_rect", "broken")]
    + [f"split_or_merged: {s}" for s in ("merged", "joist_label", "no_piece")]
    + ["no_line_near"]
)  # fmt: skip
COL_CAUSE_ORDER = (
    ["outside_crop", "column_shared"]
    + [f"removed_by_step: {s}" for s in COL_STEPS]
    + ["shape_not_recognised", "no_geometry_near"]
)
POINTS_TO = {
    "removed: crop": "crop and view setup",
    "removed: hatch": "the clean rules (clean.py)",
    "removed: dimension": "the clean rules (clean.py)",
    "removed: text_strokes": "the clean rules (clean.py)",
    "removed: dashed": "the dash rules (beam_lines.py)",
    "removed: length_filter": "chaining gap and minimum length (beam_lines.py)",
    "removed: wall_band": "the not-beams rules (not_beams.py)",
    "removed: base_plate": "the not-beams rules (not_beams.py)",
    "removed: column_shape": "the not-beams rules (not_beams.py)",
    "removed: other": "look at the gallery (no single step)",
    "other_pen: 1 pen": "better pen choice (auto pen or click)",
    "other_pen: 2 or more": "several beam pens per view",
    f"other_pen: more than {PENS_MAX}": "several beam pens per view",
    "other_pen: not reachable": "several beam pens per view",
    "split_or_merged: merged": "how supports split pieces (supports.py)",
    "split_or_merged: no_piece": "how supports split pieces (supports.py)",
    "split_or_merged: joist_label": "the joist labelling",
    "no_line_near": "mark placement or the matching radius, not the engine",
}


def points_to(cause: str) -> str:
    if cause.startswith("not_single_line"):
        return "rebuilding beams from dashed, double or broken lines"
    return POINTS_TO.get(cause, "-")


def _ranked(c: collections.Counter, order: list[str]) -> list[list]:
    rank = {k: i for i, k in enumerate(order)}
    return [
        [k, n] for k, n in sorted(c.items(), key=lambda kv: (-kv[1], rank.get(kv[0], 99), kv[0]))
    ]


def _p(n: int, t: int) -> str:
    return f"{100 * n / t:.0f}%" if t else "-"


def report(d: dict) -> str:
    s = d["summary"]
    nb, nc = s["beam_marks"], s["column_marks"]
    miss_b = nb - s["beam_cats"].get("matched", 0)
    miss_c = nc - s["col_cats"].get("matched", 0)
    L = [
        "# Phase 13b results: the miss census (DEV jobs only)",
        "",
        f"Pre-registration `docs/PHASE13B_PREREGISTRATION.md`, sha256 `{d['prereg_sha256'][:12]}`"
        " (verified at the start of the run). Measurement only, no engine change, no database"
        " write."
        " Pen: mode C of 13a (an upper-bound pen). Verdict set (Phase 7 dev + strict held-out):"
        f" {s['framing_pages']} framing pages with {nb} estimator B marks ({miss_b} not matched),"
        f" {s['column_pages']} column-plan pages with {nc} C marks ({miss_c} missed). R = 36 pt.",
        "",
        "## Beam marks by category",
        "",
        "| Category | Marks | % of B marks | % of missed |",
        "|---|---:|---:|---:|",
    ]
    for c in BEAM_CATS:
        n = s["beam_cats"].get(c, 0)
        L.append(f"| {c} | {n} | {_p(n, nb)} | {'-' if c == 'matched' else _p(n, miss_b)} |")
    L += ["", "### Per job", "", "| Job | " + " | ".join(BEAM_CATS) + " | B marks |",
          "|---|" + "---:|" * (len(BEAM_CATS) + 1)]  # fmt: skip
    for j, c in s["beam_per_job"].items():
        t = sum(c.values())
        L.append(
            f"| {j} | "
            + " | ".join(f"{c.get(k, 0)} ({_p(c.get(k, 0), t)})" for k in BEAM_CATS)
            + f" | {t} |"
        )
    L += ["", "### removed_by_cleaning: the step", "", "| Step | Marks |", "|---|---:|"]
    det = s["beam_detail"]["removed_by_cleaning"]
    for st in CLEAN_STEPS:
        L.append(f"| {st} | {det.get(st, 0)} |")
    L += ["", "### other_pen", "", "How the nearest other pen differs from C's pen:", "",
          "| Differs in | Marks |", "|---|---:|"]  # fmt: skip
    for k, n in sorted(s["beam_detail"]["other_pen"].items(), key=lambda kv: -kv[1]):
        L.append(f"| {k} | {n} |")
    L += ["", "Pens needed to cover 80% of a page's B marks (raw lines within 36 pt), per"
          " framing page:", "", "| Pens needed | Pages |", "|---|---:|"]  # fmt: skip
    for k, n in sorted(s["pens_needed"].items(), key=lambda kv: (len(kv[0]), kv[0])):
        L.append(f"| {k} | {n} |")
    L += ["", "other_pen marks by their page's pens needed: "
          + ", ".join(f"{k} {n}" for k, n in sorted(s['other_pen_by_need'].items()))]  # fmt: skip
    for c, title in (
        ("not_single_line", "not_single_line: subtype"),
        ("split_or_merged", "split_or_merged: subtype"),
        ("no_line_near", "no_line_near"),
    ):
        L += ["", f"### {title}", "", "| Subtype | Marks |", "|---|---:|"]
        for k, n in sorted(s["beam_detail"][c].items(), key=lambda kv: -kv[1]):
            L.append(f"| {k} | {n} |")
    L += [
        "",
        "no_line_near: distance to the nearest raw line (pt):",
        "",
        "| Distance | Marks |",
        "|---|---:|",
    ]
    for k, n in s["no_line_dist"].items():
        L.append(f"| {k} | {n} |")
    L += ["", "### Sensitivity (categories 2 to 6 with R = 48 and 72 pt; matched at 36 pt)", "",
          "| Category | 36 pt | 48 pt | 72 pt |", "|---|---:|---:|---:|"]  # fmt: skip
    for c in BEAM_CATS:
        n36, n48, n72 = (
            s["beam_cats"].get(c, 0),
            s["sens"]["48"].get(c, 0),
            s["sens"]["72"].get(c, 0),
        )
        L.append(f"| {c} | {n36} | {n48} | {n72} |")
    steps = [
        f"{r} pt: " + ", ".join(f"{k} {n}" for k, n in sorted(v.items(), key=lambda kv: -kv[1]))
        for r, v in s["sens_steps"].items()
    ]
    L += ["", "removed_by_cleaning steps at 48 / 72 pt: " + "; ".join(steps)]
    L += [
        "",
        "## Column marks by category",
        "",
        "| Category | Marks | % of C marks | % of missed |",
        "|---|---:|---:|---:|",
    ]
    for c in COL_CATS:
        n = s["col_cats"].get(c, 0)
        L.append(f"| {c} | {n} | {_p(n, nc)} | {'-' if c == 'matched' else _p(n, miss_c)} |")
    L += [
        "",
        "### Per job",
        "",
        "| Job | " + " | ".join(COL_CATS) + " | C marks |",
        "|---|" + "---:|" * (len(COL_CATS) + 1),
    ]
    for j, c in s["col_per_job"].items():
        t = sum(c.values())
        L.append(f"| {j} | " + " | ".join(str(c.get(k, 0)) for k in COL_CATS) + f" | {t} |")
    L += ["", "### removed_by_step: the step", "", "| Step | Marks |", "|---|---:|"]
    for st in COL_STEPS:
        L.append(f"| {st} | {s['col_steps'].get(st, 0)} |")
    L += ["", "### Shape type and rule (removed_by_step: the step; shape_not_recognised: the"
          " rejecting rule)", "",
          "| Category | Shape | Step or rule | Marks |", "|---|---|---|---:|"]  # fmt: skip
    for cat, shp, rule, n in s["col_shapes"]:
        L.append(f"| {cat} | {shp} | {rule} | {n} |")
    L += [
        "",
        "## Causes ranked",
        "",
        "| Beam cause | Marks | % of missed | Points to |",
        "|---|---:|---:|---|",
    ]
    for k, n in s["beam_causes"]:
        L.append(f"| {k} | {n} | {_p(n, miss_b)} | {points_to(k)} |")
    L += ["", "| Column cause | Marks | % of missed |", "|---|---:|---:|"]
    for k, n in s["column_causes"]:
        L.append(f"| {k} | {n} | {_p(n, miss_c)} |")
    t = s["beam_causes"]
    L += ["", "## Verdict (plain words)", ""]
    for i, (k, n) in enumerate(t[:2], start=1):
        L.append(
            f"{i}. **{k}**: {n} of {miss_b} missed beam marks ({_p(n, miss_b)})."
            f" Points to: {points_to(k)}."
        )
    if s["column_causes"]:
        k, n = s["column_causes"][0]
        L.append(
            f"\nColumns: the top cause is **{k}**, {n} of {miss_c} missed column marks"
            f" ({_p(n, miss_c)})."
        )
    L += ["", "## Gallery", "", "`fixtures/private/eval/p13b/gallery/index.html` (private): "
          f"{d['gallery']['beam_missed']} missed beam marks,"
          f" {d['gallery']['beam_matched']} matched,"
          f" {d['gallery']['column_missed']} missed column marks; seed {SEED}.", ""]  # fmt: skip
    return "\n".join(L)


def main(argv: list[str]) -> None:
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:
        DOC.write_text(report(json.loads(OUT.read_text())))
        return
    print("pre-registration verified:", digest[:12])
    saved = {(p["job"], p["page"]): p for p in json.loads(P13A.read_text())["pages"]}
    cfg = load_config()
    pages: list[dict] = []
    census: dict[tuple[str, int], Census] = {}
    docs = []
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        for job in JOBS:
            if group(job) not in VERDICT_GROUPS:
                continue
            row = conn.execute(
                "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                (project_name(job),),
            ).fetchone()
            pid = str(row["id"])
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
                rec, cs = run_page(pg, theirs[dp], saved[(job, dp + 1)]["modes"]["C"])
                rec.update(job=job, group=group(job), page=dp + 1, role=pg.role)
                pages.append(rec)
                census[(job, dp + 1)] = cs
                print(
                    f"{job} p{dp + 1} {pg.role}: {len(rec['marks'])} marks,"
                    f" {rec['n_unmatched']} missed",
                    flush=True,
                )
    nb = sum(p["n_unmatched"] for p in pages if p["role"] == "framing")
    nc = sum(p["n_unmatched"] for p in pages if p["role"] != "framing")
    if (nb, nc) != (EXPECT_BEAM_MISSES, EXPECT_COLUMN_MISSES):
        raise SystemExit(f"misses differ from 13a: beams {nb}, columns {nc}")
    summary = summarise(pages)
    # gallery
    rng = random.Random(SEED)
    GALLERY.mkdir(parents=True, exist_ok=True)
    for f in GALLERY.glob("*.png"):
        f.unlink()

    def items(role, keep):
        g = collections.defaultdict(list)
        for p in pages:
            if (p["role"] == "framing") != (role == "beam"):
                continue
            for m in p["marks"]:
                if keep(m):
                    g[m["category"]].append({"key": (p["job"], p["page"], m["x"], m["y"]), "m": m})
        return g

    beam_miss = stratified(
        items("beam", lambda m: m["category"] != "matched"), 20, BEAM_CATS[1:], rng
    )
    beam_ok = stratified(items("beam", lambda m: m["category"] == "matched"), 4, ("matched",), rng)
    col_miss = stratified(
        items("column", lambda m: m["category"] != "matched"), 10, COL_CATS[1:], rng
    )
    entries = []
    for kind, sample in (("beam", beam_miss), ("matched", beam_ok), ("column", col_miss)):
        for n, (cat, it) in enumerate(sample, start=1):
            job, page, x, y = it["key"]
            m = it["m"]
            cs = census[(job, page)]
            if kind == "column":
                det = m.get("step") or m.get("rule") or ""
                what = "step" if m.get("step") else "rule"
                cap = f"{job} p{page} | {cat} | shape {m.get('shape', '-')} | {what} {det or '-'}"
                extra = m.get("shape_id")
            else:
                f = m["facts"]
                cap = (f"{job} p{page} | {cat} | {m['detail'] or '-'} | nearest raw line "
                       f"{f['nearest_raw_pt']} pt | other pen {f['other_pen'] or '-'}")  # fmt: skip
                extra = None
            name = f"{kind}-{n:02d}-{cat}.png"
            gallery_image(GALLERY / name, cs, (x, y), cap, kind == "column", extra)
            entries.append((kind, name, cap))
    rows = "\n".join(
        f"<figure><img src='{html.escape(n)}' loading='lazy'>"
        f"<figcaption>{html.escape(k)}: {html.escape(c)}</figcaption></figure>"
        for k, n, c in entries
    )
    (GALLERY / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>Phase 13b gallery</title>"
        "<style>body{font-family:sans-serif;margin:16px}img{max-width:100%;border:1px solid #ccc}"
        "figure{margin:0 0 28px}</style><h1>Phase 13b miss census: gallery (private)</h1>"
        f"<p>Seed {SEED}. Blue ring: the estimator mark with the 36 pt radius.</p>{rows}"
    )
    for doc in docs:
        doc.close()
    out = {
        "prereg_sha256": digest,
        "pages": pages,
        "summary": summary,
        "gallery": {
            "beam_missed": len(beam_miss),
            "beam_matched": len(beam_ok),
            "column_missed": len(col_miss),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, default=str))
    DOC.write_text(report(json.loads(OUT.read_text())))
    print("beam categories:", summary["beam_cats"])
    print("column categories:", summary["col_cats"])
    print("wrote", OUT.relative_to(ROOT), DOC.relative_to(ROOT), GALLERY.relative_to(ROOT))


if __name__ == "__main__":
    main(sys.argv[1:])
