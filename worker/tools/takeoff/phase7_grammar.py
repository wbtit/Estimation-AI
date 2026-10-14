"""Phase 7 Part C: structural grammar prototype, rules v1 (docs/PHASE7_PREREGISTRATION.md 4.2).

Input: a `PageParse` (phase7_parse), the page words, the view box and optional labels. Output: the
pieces of the page, every one with evidence. Deterministic; no LLM, no model, no learned weights.
All thresholds are the module constants below, fixed in the pre-registration. Revisions made on the
dev jobs only are listed in REVISIONS (and in the dev log of docs/PHASE7_RESULTS.md).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from tools.takeoff import phase6c_lib as L6
from tools.takeoff.phase7_parse import PageParse, Shape

GRAMMAR_VERSION = "v1"
REVISIONS: list[
    str
] = []  # numbered dev revisions (filled in only after a dev result, never before)

Pt = tuple[float, float]
Box = tuple[float, float, float, float]

# ---- constants (pre-registered) -------------------------------------------------------------------
MIN_SEG_PT = 6.0
ROLE_LEN_PT = 12.0
ROLE_Q_THIN, ROLE_Q_MEDIUM = 0.50, 0.85
WIDTH_ROUND = 0.05
HATCH_N, HATCH_ANGLE, HATCH_RATIO, HATCH_OFFSET, HATCH_OVERLAP = 4, 2.0, 0.30, 6.0, 0.5
HATCH, THIN, MEDIUM, HEAVY = 0, 1, 2, 3
ROLE_NAMES = ("hatch", "thin", "medium", "heavy")

BUBBLE_MIN, BUBBLE_MAX, BUBBLE_ASPECT = 10.0, 40.0, 1.2
GRID_MIN_LEN, GRID_GAP, GRID_AXIS_TOL, GRID_END_TOL, GRID_EXTEND = 150.0, 12.0, 6.0, 12.0, 24.0
GRID_SEG_MAX = 30.0
MIN_INTERSECTIONS = 4
AT_GRID_PT = 30.0

GLYPH_LONG_MIN, GLYPH_LONG_MAX, GLYPH_SHORT_MIN, GLYPH_ASPECT = 3.0, 24.0, 3.0, 3.0
GLYPH_MAX_VERTS, GLYPH_IOU = 20, 0.5

SIGN_LEN_MIN, SIGN_LEN_MAX, SIGN_RATIO = 30.0, 400.0, 0.25
X_MID, X_ANGLE_MIN, X_ANGLE_MAX, V_ANGLE_MAX, V_BASE_TOL, AXIS_DEG = (
    0.15,
    20.0,
    160.0,
    120.0,
    4.0,
    3.0,
)
DIM_MIN_LEN, TICK_MAX, TICK_END_TOL, DIM_TEXT_RADIUS = 30.0, 8.0, 3.0, 12.0
ARROW_MAX = 10.0

CHAIN_ANGLE_DEG, CHAIN_OFFSET, CHAIN_GAP, CHAIN_MIN = 1.0, 1.0, 8.0, 24.0
ANGLE_CUT_DEG = 22.5
SPAN_MIN, SPLIT_END, GLYPH_SPLIT_PAD, PROJ_PAD = 12.0, 4.0, 4.0, 6.0
SUPPORT_GLYPH_END, SUPPORT_CHAIN_END = 8.0, 4.0
LABEL_RADIUS = 30.0


@dataclass
class Word:
    text: str
    box: Box

    @property
    def centre(self) -> Pt:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)


@dataclass
class Chain:
    id: int
    segs: list[int]
    p0: Pt
    p1: Pt
    role: int
    dashed: bool

    @property
    def length(self) -> float:
        return math.hypot(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])


@dataclass
class PagePieces:
    box: Box
    roles: np.ndarray
    consumed: dict = field(default_factory=dict)  # kind -> count
    consumed_segs: dict = field(default_factory=dict)  # kind -> set of seg ids
    bubbles: list[dict] = field(default_factory=list)
    grid_lines: list[dict] = field(default_factory=list)
    intersections: list[Pt] = field(default_factory=list)
    has_grid: bool = False
    glyphs: list[dict] = field(default_factory=list)
    spans: list[dict] = field(default_factory=list)
    braces: list[dict] = field(default_factory=list)
    chains: list[Chain] = field(default_factory=list)

    def main_spans(self, min_supports: int = 1) -> list[dict]:
        return [s for s in self.spans if s["n_supports"] >= min_supports]

    def main_glyphs(self) -> list[dict]:
        return [g for g in self.glyphs if g["main"]]


# ---- small geometry -------------------------------------------------------------------------------
def seg_len(s) -> float:
    return math.hypot(s[2] - s[0], s[3] - s[1])


def seg_angle_deg(s) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def angle_diff_deg(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def point_seg_dist(px: float, py: float, s) -> float:
    return L6.seg_distance(px, py, (s[0], s[1]), (s[2], s[3]))


def seg_intersection(a, b, ext: float = 0.0) -> tuple[float, float] | None:
    """Intersection of two segments, each extended by `ext` pt at both ends; (t on a, u on b) in pt
    along the segments (0 = first end), or None when parallel or they miss."""
    ax, ay = a[2] - a[0], a[3] - a[1]
    bx, by = b[2] - b[0], b[3] - b[1]
    la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    if la < 1e-9 or lb < 1e-9:
        return None
    den = ax * by - ay * bx
    if abs(den) < 1e-9 * la * lb:
        return None
    t = ((b[0] - a[0]) * by - (b[1] - a[1]) * bx) / den
    u = ((b[0] - a[0]) * ay - (b[1] - a[1]) * ax) / den
    ta, ub = t * la, u * lb
    if -ext <= ta <= la + ext and -ext <= ub <= lb + ext:
        return ta, ub
    return None


def in_box(x: float, y: float, box: Box) -> bool:
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def _mid(seg: np.ndarray) -> np.ndarray:
    return np.stack([(seg[:, 0] + seg[:, 2]) / 2, (seg[:, 1] + seg[:, 3]) / 2], axis=1)


# ---- rule 2: line roles ---------------------------------------------------------------------------
def assign_roles(parse: PageParse, box: Box) -> tuple[np.ndarray, np.ndarray]:
    """(roles, hatch) per segment. Roles: 0 hatch, 1 thin, 2 medium, 3 heavy (by the page's own
    length-weighted width histogram); segments outside the view box get -1."""
    n = len(parse.seg)
    roles = np.full(n, -1, dtype=int)
    if n == 0:
        return roles, np.zeros(0, dtype=bool)
    mid = _mid(parse.seg)
    inside = (
        (mid[:, 0] >= box[0])
        & (mid[:, 0] <= box[2])
        & (mid[:, 1] >= box[1])
        & (mid[:, 1] <= box[3])
    )
    length = np.hypot(parse.seg[:, 2] - parse.seg[:, 0], parse.seg[:, 3] - parse.seg[:, 1])
    hatch = hatch_mask(parse.seg, length, inside)
    wr = np.round(parse.seg_w / WIDTH_ROUND) * WIDTH_ROUND
    basis = inside & (length >= ROLE_LEN_PT) & ~hatch
    widths = np.unique(wr[basis]) if basis.any() else np.array([])
    total = float(length[basis].sum()) if basis.any() else 0.0
    role_of: dict[float, int] = {}
    cum = 0.0
    for w in widths:
        before = cum / total if total else 0.0
        role_of[float(w)] = (
            THIN if before < ROLE_Q_THIN else MEDIUM if before < ROLE_Q_MEDIUM else HEAVY
        )
        cum += float(length[basis & (wr == w)].sum())
    for i in range(n):
        if not inside[i]:
            continue
        if hatch[i] or length[i] < ROLE_LEN_PT:
            roles[i] = HATCH
        else:
            w = float(wr[i])
            if w in role_of:
                roles[i] = role_of[w]
            else:  # a width only seen on short segments: the nearest known width, else thin
                if role_of:
                    near = min(role_of, key=lambda k: abs(k - w))
                    roles[i] = role_of[near]
                else:
                    roles[i] = THIN
    return roles, hatch


def hatch_mask(seg: np.ndarray, length: np.ndarray, inside: np.ndarray) -> np.ndarray:
    """A segment with at least HATCH_N other near-parallel segments of similar length at small
    perpendicular offsets that overlap it along its direction by at least half (core), plus one
    propagation pass: a segment with such a neighbour that is itself core hatch (the edge lines of
    a stack). Erratum 1 of the pre-registration (before any real drawing was parsed)."""
    n = len(seg)
    out = np.zeros(n, dtype=bool)
    if n < HATCH_N + 1:
        return out
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180.0
    mid = _mid(seg)
    cell = 24.0
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    cand = [i for i in range(n) if inside[i] and 0.5 < length[i] < 400.0]
    for i in cand:
        grid[(int(mid[i, 0] // cell), int(mid[i, 1] // cell))].append(i)
    ux = np.cos(np.radians(ang))
    uy = np.sin(np.radians(ang))
    neighbours: dict[int, list[int]] = {}
    for i in cand:
        cx, cy = int(mid[i, 0] // cell), int(mid[i, 1] // cell)
        found: list[int] = []
        reach = int(max(1, math.ceil((length[i] / 2 + HATCH_OFFSET) / cell)))
        for gx in range(cx - reach, cx + reach + 1):
            for gy in range(cy - reach, cy + reach + 1):
                for j in grid.get((gx, gy), ()):
                    if j == i:
                        continue
                    if angle_diff_deg(ang[i], ang[j]) > HATCH_ANGLE:
                        continue
                    if abs(length[j] - length[i]) > HATCH_RATIO * length[i]:
                        continue
                    dx, dy = mid[j, 0] - mid[i, 0], mid[j, 1] - mid[i, 1]
                    along = dx * ux[i] + dy * uy[i]
                    perp = -dx * uy[i] + dy * ux[i]
                    if abs(perp) > HATCH_OFFSET or abs(perp) < 0.2:
                        continue
                    if 1.0 - abs(along) / max(length[i], 1e-9) < HATCH_OVERLAP:
                        continue
                    found.append(j)
        neighbours[i] = found
        out[i] = len(found) >= HATCH_N
    core = out.copy()
    for i, found in neighbours.items():
        if not core[i] and any(core[j] for j in found):
            out[i] = True
    return out


# ---- chaining (collinear, across small gaps) ------------------------------------------------------
def chain_segments(
    seg: np.ndarray,
    idx: list[int],
    gap_max: float,
    angle_deg: float = CHAIN_ANGLE_DEG,
    offset: float = CHAIN_OFFSET,
) -> list[tuple[list[int], Pt, Pt]]:
    """Group the segments `idx` into collinear chains. Returns (segment ids, end 0, end 1) with the
    ends being the extreme points along the chain axis. Deterministic (sorted by angle, offset,
    position). Angles are cut at ANGLE_CUT_DEG so that horizontal lines do not wrap."""
    if not idx:
        return []
    s = seg[idx]
    dx, dy = s[:, 2] - s[:, 0], s[:, 3] - s[:, 1]
    theta = np.degrees(np.arctan2(dy, dx)) % 180.0
    theta = (theta - ANGLE_CUT_DEG) % 180.0 + ANGLE_CUT_DEG
    order = np.argsort(theta, kind="stable")
    clusters: list[list[int]] = []
    anchor = None
    for k in order:
        if anchor is None or theta[k] - anchor > angle_deg:
            clusters.append([])
            anchor = theta[k]
        clusters[-1].append(int(k))
    out: list[tuple[list[int], Pt, Pt]] = []
    for cl in clusters:
        th = math.radians(float(np.mean(theta[cl])))
        ux, uy = math.cos(th), math.sin(th)
        a = s[cl]
        # orient every segment along (ux, uy)
        flip = (a[:, 2] - a[:, 0]) * ux + (a[:, 3] - a[:, 1]) * uy < 0
        x0 = np.where(flip, a[:, 2], a[:, 0])
        y0 = np.where(flip, a[:, 3], a[:, 1])
        x1 = np.where(flip, a[:, 0], a[:, 2])
        y1 = np.where(flip, a[:, 1], a[:, 3])
        rho = -((x0 + x1) / 2) * uy + ((y0 + y1) / 2) * ux
        for sub in _runs(rho, np.arange(len(cl)), offset):
            sub_idx = np.array(sub)
            s0 = x0[sub_idx] * ux + y0[sub_idx] * uy
            s1 = x1[sub_idx] * ux + y1[sub_idx] * uy
            order2 = np.argsort(s0, kind="stable")
            cur: list[int] = []
            cur_end = -math.inf
            ref = None
            for o in order2:
                k = int(sub_idx[o])
                if ref is not None:
                    r0, r1 = ref
                    rl = math.hypot(r1[0] - r0[0], r1[1] - r0[1]) or 1.0
                    rux, ruy = (r1[0] - r0[0]) / rl, (r1[1] - r0[1]) / rl

                    def off(px, py, r0=r0, rux=rux, ruy=ruy):
                        return abs(-(px - r0[0]) * ruy + (py - r0[1]) * rux)

                    ok = (
                        s0[o] - cur_end <= gap_max
                        and off(x0[k], y0[k]) <= offset
                        and off(x1[k], y1[k]) <= offset
                    )
                else:
                    ok = False
                if not ok:
                    if cur:
                        out.append(_finish(cur, cl, idx, x0, y0, x1, y1, ux, uy))
                    cur, cur_end, ref = [], -math.inf, None
                cur.append(k)
                if ref is None:
                    ref = ((float(x0[k]), float(y0[k])), (float(x1[k]), float(y1[k])))
                cur_end = max(cur_end, float(s1[o]))
            if cur:
                out.append(_finish(cur, cl, idx, x0, y0, x1, y1, ux, uy))
    return out


def _runs(values: np.ndarray, ids: np.ndarray, tol: float) -> list[list[int]]:
    order = np.argsort(values, kind="stable")
    runs: list[list[int]] = []
    last = None
    for o in order:
        if last is None or values[o] - last > tol:
            runs.append([])
        runs[-1].append(int(ids[o]))
        last = values[o]
    return runs


def _finish(cur, cl, idx, x0, y0, x1, y1, ux, uy) -> tuple[list[int], Pt, Pt]:
    pts = []
    for k in cur:
        pts.append((float(x0[k]), float(y0[k])))
        pts.append((float(x1[k]), float(y1[k])))
    lo = min(pts, key=lambda p: p[0] * ux + p[1] * uy)
    hi = max(pts, key=lambda p: p[0] * ux + p[1] * uy)
    return ([idx[cl[k]] for k in cur], lo, hi)


# ---- rule 3: bubbles and grids --------------------------------------------------------------------
def find_bubbles(parse: PageParse, words: list[Word], box: Box) -> list[dict]:
    out = []
    for sh in parse.shapes:
        if not (sh.curved and sh.closed):
            continue
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        if not (BUBBLE_MIN <= w <= BUBBLE_MAX and BUBBLE_MIN <= h <= BUBBLE_MAX):
            continue
        if max(w, h) / max(min(w, h), 1e-9) > BUBBLE_ASPECT:
            continue
        cx, cy = (sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2
        if not in_box(cx, cy, box):
            continue
        r = max(w, h) / 2
        inside = [
            wd
            for wd in words
            if math.hypot(wd.centre[0] - cx, wd.centre[1] - cy) <= r and wd.text.strip()
        ]
        text = "".join(wd.text.strip() for wd in inside)
        if not 1 <= len(text) <= 2:
            continue
        out.append(
            {
                "shape": sh.id,
                "centre": (cx, cy),
                "radius": r,
                "label": text,
                "family": family_of(text),
            }
        )
    # a circle drawn twice (fill and outline) is one bubble
    out.sort(key=lambda b: (round(b["centre"][0], 1), round(b["centre"][1], 1), b["shape"]))
    keep: list[dict] = []
    for b in out:
        if any(
            math.hypot(b["centre"][0] - k["centre"][0], b["centre"][1] - k["centre"][1]) < 2.0
            for k in keep
        ):
            continue
        keep.append(b)
    return keep


def family_of(label: str) -> str:
    """Family from the label content (not the direction): all decimal digits -> N, else A."""
    return "N" if label and all(ch.isdecimal() for ch in label) else "A"


def find_grid(
    parse: PageParse, roles: np.ndarray, bubbles: list[dict], box: Box
) -> tuple[list[dict], list[Pt], set[int]]:
    """Grid lines anchored by bubbles; their intersections (family N with family A); segment ids."""
    if not bubbles:
        return [], [], set()
    seg = parse.seg
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]) if len(seg) else np.zeros(0)
    cand = [
        i
        for i in range(len(seg))
        if roles[i] >= 0 and (parse.seg_dashed[i] or length[i] <= GRID_SEG_MAX) and length[i] >= 1.0
    ]
    lines: list[dict] = []
    used: set[int] = set()
    for ids, p0, p1 in chain_segments(seg, cand, GRID_GAP):
        ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if ln < GRID_MIN_LEN:
            continue
        dashed_like = any(parse.seg_dashed[i] for i in ids) or len(ids) >= 3
        if not dashed_like:
            continue
        ux, uy = (p1[0] - p0[0]) / ln, (p1[1] - p0[1]) / ln
        best = None
        for b in bubbles:
            cx, cy = b["centre"]
            perp = abs(-(cx - p0[0]) * uy + (cy - p0[1]) * ux)
            if perp > GRID_AXIS_TOL:
                continue
            e = min(math.hypot(cx - p0[0], cy - p0[1]), math.hypot(cx - p1[0], cy - p1[1]))
            if e <= b["radius"] + GRID_END_TOL and (best is None or e < best[0]):
                best = (e, b)
        if best is None:
            continue
        b = best[1]
        lines.append(
            {
                "p0": p0,
                "p1": p1,
                "segs": ids,
                "label": b["label"],
                "family": b["family"],
                "bubble": b["shape"],
            }
        )
        used.update(ids)
    pts: list[Pt] = []
    for a in lines:
        if a["family"] != "N":
            continue
        for b in lines:
            if b["family"] != "A":
                continue
            hit = seg_intersection((*a["p0"], *a["p1"]), (*b["p0"], *b["p1"]), GRID_EXTEND)
            if hit is not None:
                la = math.hypot(a["p1"][0] - a["p0"][0], a["p1"][1] - a["p0"][1])
                t = hit[0] / la
                pts.append(
                    (
                        a["p0"][0] + t * (a["p1"][0] - a["p0"][0]),
                        a["p0"][1] + t * (a["p1"][1] - a["p0"][1]),
                    )
                )
    return lines, pts, used


# ---- rule 4: column and post glyphs ---------------------------------------------------------------
def width_profile(pts: list[Pt], box: Box, rows: int = 8, samples: int = 16) -> list[float]:
    """Share of the box width that is inside the polygon at each of `rows` rows (16 x 16 sampling)."""
    w, h = box[2] - box[0], box[3] - box[1]
    if w <= 0 or h <= 0:
        return [0.0] * rows
    if _is_box_polygon(pts, box):
        return [1.0] * rows
    per_row = samples // rows
    prof = []
    for r in range(rows):
        inside = 0
        total = 0
        for k in range(per_row):
            y = box[1] + (r * per_row + k + 0.5) / samples * h
            for c in range(samples):
                x = box[0] + (c + 0.5) / samples * w
                inside += L6.inside_polygon(x, y, pts)
                total += 1
        prof.append(round(inside / total, 3))
    return prof


def _is_box_polygon(pts: list[Pt], box: Box, tol: float = 0.05) -> bool:
    """True when the polygon is the axis-aligned rectangle of its own box (four corners)."""
    if len(pts) != 4:
        return False
    corners = {(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])}
    return all(
        any(abs(p[0] - c[0]) <= tol and abs(p[1] - c[1]) <= tol for c in corners) for p in pts
    )


def find_glyphs(
    parse: PageParse, bubble_shapes: set[int], box: Box, intersections: list[Pt], has_grid: bool
) -> list[dict]:
    cands: list[tuple[float, Shape]] = []
    for sh in parse.shapes:
        if sh.id in bubble_shapes or not (sh.closed or sh.paint == "f"):
            continue
        if len(sh.pts) > GLYPH_MAX_VERTS or len(sh.pts) < 3:
            continue
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        long_s, short_s = max(w, h), min(w, h)
        if not (GLYPH_LONG_MIN <= long_s <= GLYPH_LONG_MAX) or short_s < GLYPH_SHORT_MIN:
            continue
        if long_s / short_s > GLYPH_ASPECT:
            continue
        cx, cy = (sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2
        if not in_box(cx, cy, box):
            continue
        cands.append((w * h, sh))
    cands.sort(key=lambda t: (-t[0], t[1].id))
    kept: list[tuple[Shape, list[int]]] = []
    for _, sh in cands:
        for k, ids in kept:
            if _iou(sh.bbox, k.bbox) > GLYPH_IOU:
                ids.append(sh.id)
                break
        else:
            kept.append((sh, [sh.id]))
    inter = np.asarray(intersections, dtype=float) if intersections else np.zeros((0, 2))
    out = []
    for sh, ids in kept:
        cx, cy = (sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2
        d_grid = float(np.min(np.hypot(inter[:, 0] - cx, inter[:, 1] - cy))) if len(inter) else None
        at_grid = d_grid is not None and d_grid <= AT_GRID_PT
        out.append(
            {
                "shape_ids": sorted(ids),
                "box": sh.bbox,
                "centre": (cx, cy),
                "half_diag": math.hypot(sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]) / 2,
                "paint": sh.paint,
                "n_verts": len(sh.pts),
                "curved": sh.curved,
                "signature": width_profile(sh.pts, sh.bbox),
                "d_grid": d_grid,
                "at_grid": at_grid,
                "main": at_grid if has_grid else True,
            }
        )
    out.sort(key=lambda g: (round(g["centre"][1], 1), round(g["centre"][0], 1)))
    return out


def _iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


# ---- rule 5: consumed before chaining --------------------------------------------------------------
def find_signs(seg: np.ndarray, roles: np.ndarray) -> tuple[list[dict], set[int]]:
    """X and V brace signs among the diagonal segments of 30 to 400 pt (any role but hatch)."""
    n = len(seg)
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]) if n else np.zeros(0)
    ang = (
        np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180.0
        if n
        else length
    )
    diag = [
        i
        for i in range(n)
        if roles[i] > HATCH
        and SIGN_LEN_MIN <= length[i] <= SIGN_LEN_MAX
        and angle_diff_deg(ang[i], 0.0) > AXIS_DEG
        and angle_diff_deg(ang[i], 90.0) > AXIS_DEG
    ]
    cell = 100.0
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    mid = _mid(seg) if n else np.zeros((0, 2))
    for i in diag:
        grid[(int(mid[i, 0] // cell), int(mid[i, 1] // cell))].append(i)
    signs: list[dict] = []
    used: set[int] = set()
    for i in diag:
        if i in used:
            continue
        gx, gy = int(mid[i, 0] // cell), int(mid[i, 1] // cell)
        found = False
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j <= i or j in used:
                        continue
                    if abs(length[i] - length[j]) > SIGN_RATIO * max(length[i], length[j]):
                        continue
                    ad = angle_diff_deg(ang[i], ang[j])
                    sign = _x_sign(seg[i], seg[j], length[i], length[j], ad) or _v_sign(
                        seg[i], seg[j], ad
                    )
                    if sign:
                        signs.append({**sign, "segs": [i, j]})
                        used.update((i, j))
                        found = True
                        break
                if found:
                    break
            if found:
                break
    return signs, used


def _x_sign(a, b, la, lb, ad) -> dict | None:
    if not X_ANGLE_MIN <= ad <= 180.0 - X_ANGLE_MIN:
        return None
    hit = seg_intersection(a, b, 0.0)
    if hit is None:
        return None
    ta, ub = hit
    if abs(ta - la / 2) > X_MID * la or abs(ub - lb / 2) > X_MID * lb:
        return None
    x = a[0] + (a[2] - a[0]) * ta / la
    y = a[1] + (a[3] - a[1]) * ta / la
    return {"kind": "X", "pt": (x, y)}


def _v_sign(a, b, ad) -> dict | None:
    if not X_ANGLE_MIN <= ad <= V_ANGLE_MAX:
        return None
    for pa in ((a[0], a[1]), (a[2], a[3])):
        for pb in ((b[0], b[1]), (b[2], b[3])):
            if math.hypot(pa[0] - pb[0], pa[1] - pb[1]) <= 2.0:
                oa = (a[2], a[3]) if pa == (a[0], a[1]) else (a[0], a[1])
                ob = (b[2], b[3]) if pb == (b[0], b[1]) else (b[0], b[1])
                if abs(oa[1] - ob[1]) <= V_BASE_TOL or abs(oa[0] - ob[0]) <= V_BASE_TOL:
                    return {"kind": "V", "pt": pa}
    return None


def find_dimension_lines(
    parse: PageParse, roles: np.ndarray, words: list[Word], exclude: set[int]
) -> tuple[list[dict], set[int]]:
    seg = parse.seg
    n = len(seg)
    if n == 0:
        return [], set()
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    ticks = [i for i in range(n) if roles[i] >= 0 and length[i] <= TICK_MAX and i not in exclude]
    arrows = [
        sh
        for sh in parse.shapes
        if sh.paint in ("f", "fs")
        and len(sh.pts) in (3, 4)
        and max(sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]) <= ARROW_MAX
    ]
    cell = 40.0
    tgrid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in ticks:
        for px, py in ((seg[i, 0], seg[i, 1]), (seg[i, 2], seg[i, 3])):
            tgrid[(int(px // cell), int(py // cell))].append(i)
    agrid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for k, sh in enumerate(arrows):
        for px, py in sh.pts:
            agrid[(int(px // cell), int(py // cell))].append(k)
    digit_words = [w for w in words if any(ch.isdigit() for ch in w.text)]
    wgrid: dict[tuple[int, int], list[Word]] = defaultdict(list)
    for w in digit_words:
        wgrid[(int(w.centre[0] // cell), int(w.centre[1] // cell))].append(w)

    def has_terminator(end: Pt, direction_deg: float) -> list[int] | None:
        gx, gy = int(end[0] // cell), int(end[1] // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in tgrid.get((gx + dx, gy + dy), ()):
                    if point_seg_dist(end[0], end[1], seg[i]) <= TICK_END_TOL:
                        ad = angle_diff_deg(seg_angle_deg(seg[i]), direction_deg)
                        if 30.0 <= ad <= 60.0 or 30.0 <= 180.0 - ad <= 60.0:
                            return [i]
                for k in agrid.get((gx + dx, gy + dy), ()):
                    if any(
                        math.hypot(px - end[0], py - end[1]) <= TICK_END_TOL
                        for px, py in arrows[k].pts
                    ):
                        return []
        return None

    out: list[dict] = []
    used: set[int] = set()
    for i in range(n):
        if roles[i] != THIN or length[i] < DIM_MIN_LEN or i in exclude:
            continue
        ang = seg_angle_deg(seg[i])
        t0 = has_terminator((seg[i, 0], seg[i, 1]), ang)
        if t0 is None:
            continue
        t1 = has_terminator((seg[i, 2], seg[i, 3]), ang)
        if t1 is None:
            continue
        mx, my = (seg[i, 0] + seg[i, 2]) / 2, (seg[i, 1] + seg[i, 3]) / 2
        gx, gy = int(mx // cell), int(my // cell)
        ok = False
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for w in wgrid.get((gx + dx, gy + dy), ()):
                    if point_seg_dist(w.centre[0], w.centre[1], seg[i]) <= DIM_TEXT_RADIUS:
                        ok = True
        if not ok:
            continue
        out.append({"seg": i, "terminators": t0 + t1})
        used.add(i)
        used.update(t0 + t1)
    return out, used


# ---- rules 6 to 8: members, supports, pieces ------------------------------------------------------
def build_members(
    parse: PageParse,
    roles: np.ndarray,
    excluded: set[int],
    glyphs: list[dict],
) -> tuple[list[Chain], list[dict]]:
    seg = parse.seg
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]) if len(seg) else np.zeros(0)
    groups: dict[tuple[int, bool], list[int]] = defaultdict(list)
    for i in range(len(seg)):
        if i in excluded or roles[i] < THIN or length[i] < MIN_SEG_PT:
            continue
        groups[(int(roles[i]), bool(parse.seg_dashed[i]))].append(i)
    chains: list[Chain] = []
    for (role, dashed), idx in sorted(groups.items()):
        for ids, p0, p1 in chain_segments(seg, idx, CHAIN_GAP):
            if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < CHAIN_MIN:
                continue
            chains.append(Chain(len(chains), ids, p0, p1, role, dashed))
    spans = split_into_spans(chains, glyphs)
    return chains, spans


def _chain_grid(chains: list[Chain], cell: float = 100.0) -> dict[tuple[int, int], list[int]]:
    g: dict[tuple[int, int], list[int]] = defaultdict(list)
    for c in chains:
        x0, x1 = sorted((c.p0[0], c.p1[0]))
        y0, y1 = sorted((c.p0[1], c.p1[1]))
        for gx in range(int(x0 // cell), int(x1 // cell) + 1):
            for gy in range(int(y0 // cell), int(y1 // cell) + 1):
                g[(gx, gy)].append(c.id)
    return g


def _note_end(ends: list[dict | None], which: int, support: dict) -> None:
    """Record the support at a chain end; a column outranks a member."""
    cur = ends[which]
    if cur is None or (cur["type"] != "column" and support["type"] == "column"):
        ends[which] = support


def split_into_spans(chains: list[Chain], glyphs: list[dict]) -> list[dict]:
    gcell = 60.0
    ggrid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for k, g in enumerate(glyphs):
        ggrid[(int(g["centre"][0] // gcell), int(g["centre"][1] // gcell))].append(k)
    cgrid = _chain_grid(chains)
    spans: list[dict] = []
    for c in chains:
        L = c.length
        ux, uy = (c.p1[0] - c.p0[0]) / L, (c.p1[1] - c.p0[1]) / L
        seg_a = (*c.p0, *c.p1)
        cuts: list[tuple[float, dict]] = []  # (s along the chain, support)
        ends: list[dict | None] = [None, None]

        # column glyphs along the chain
        x0, x1 = sorted((c.p0[0], c.p1[0]))
        y0, y1 = sorted((c.p0[1], c.p1[1]))
        seen_g: set[int] = set()
        for gx in range(int((x0 - 40) // gcell), int((x1 + 40) // gcell) + 1):
            for gy in range(int((y0 - 40) // gcell), int((y1 + 40) // gcell) + 1):
                for k in ggrid.get((gx, gy), ()):
                    if k in seen_g:
                        continue
                    seen_g.add(k)
                    g = glyphs[k]
                    cx, cy = g["centre"]
                    perp = abs(-(cx - c.p0[0]) * uy + (cy - c.p0[1]) * ux)
                    s = (cx - c.p0[0]) * ux + (cy - c.p0[1]) * uy
                    sup = {"type": "column", "id": k}
                    if perp <= g["half_diag"] + GLYPH_SPLIT_PAD and -PROJ_PAD <= s <= L + PROJ_PAD:
                        if SPLIT_END < s < L - SPLIT_END:
                            cuts.append((s, sup))
                    for which, p in ((0, c.p0), (1, c.p1)):
                        bx = g["box"]
                        dx = max(bx[0] - p[0], 0.0, p[0] - bx[2])
                        dy = max(bx[1] - p[1], 0.0, p[1] - bx[3])
                        if math.hypot(dx, dy) <= SUPPORT_GLYPH_END:
                            _note_end(ends, which, sup)
        # other chains of the same or heavier role
        seen_c: set[int] = {c.id}
        for gx in range(int((x0 - 5) // 100), int((x1 + 5) // 100) + 1):
            for gy in range(int((y0 - 5) // 100), int((y1 + 5) // 100) + 1):
                for j in cgrid.get((gx, gy), ()):
                    if j in seen_c:
                        continue
                    seen_c.add(j)
                    o = chains[j]
                    if o.role < c.role:
                        continue
                    hit = seg_intersection(seg_a, (*o.p0, *o.p1), SUPPORT_CHAIN_END)
                    if hit is None:
                        continue
                    s = hit[0]
                    sup = {"type": "member", "id": j}
                    if s <= SPLIT_END:
                        _note_end(ends, 0, sup)
                    elif s >= L - SPLIT_END:
                        _note_end(ends, 1, sup)
                    else:
                        cuts.append((s, sup))
        cuts.sort(key=lambda t: (t[0], 0 if t[1]["type"] == "column" else 1))
        points: list[tuple[float, dict | None]] = [(0.0, ends[0])]
        last = -math.inf
        for s, sup in cuts:
            if s - last < 1e-6:
                continue
            points.append((s, sup))
            last = s
        points.append((L, ends[1]))
        for (s_a, sup_a), (s_b, sup_b) in zip(points, points[1:], strict=False):
            if s_b - s_a < SPAN_MIN:
                continue
            a = (c.p0[0] + ux * s_a, c.p0[1] + uy * s_a)
            b = (c.p0[0] + ux * s_b, c.p0[1] + uy * s_b)
            supports = [sup_a, sup_b]
            spans.append(
                {
                    "chain": c.id,
                    "p0": a,
                    "p1": b,
                    "length": s_b - s_a,
                    "role": c.role,
                    "dashed": c.dashed,
                    "supports": supports,
                    "n_supports": sum(s is not None for s in supports),
                    "segs": list(c.segs),
                    "label": None,
                }
            )
    return spans


def attach_labels(spans: list[dict], labels: list[tuple[str, Box]]) -> None:
    """Evidence only: the nearest profile label within LABEL_RADIUS pt of the span."""
    if not labels:
        return
    for s in spans:
        best = None
        for key, b in labels:
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            d = point_seg_dist(cx, cy, (*s["p0"], *s["p1"]))
            if d <= LABEL_RADIUS and (best is None or d < best[0]):
                best = (d, key)
        s["label"] = best[1] if best else None


# ---- the page -------------------------------------------------------------------------------------
def run_page(
    parse: PageParse,
    words: list[Word],
    box: Box,
    labels: list[tuple[str, Box]] | None = None,
) -> PagePieces:
    roles, hatch = assign_roles(parse, box)
    out = PagePieces(box=box, roles=roles)
    bubbles = find_bubbles(parse, words, box)
    out.bubbles = bubbles
    grid_lines, inter, grid_segs = find_grid(parse, roles, bubbles, box)
    out.grid_lines, out.intersections = grid_lines, inter
    out.has_grid = len(inter) >= MIN_INTERSECTIONS
    bubble_shapes = {b["shape"] for b in bubbles}
    glyphs = find_glyphs(parse, bubble_shapes, box, inter, out.has_grid)
    out.glyphs = glyphs
    glyph_shapes = {sid for g in glyphs for sid in g["shape_ids"]}
    shape_segs = {
        i
        for i in range(len(parse.seg))
        if parse.seg_shape[i] in bubble_shapes or parse.seg_shape[i] in glyph_shapes
    }
    signs, sign_segs = find_signs(parse.seg, roles)
    dims, dim_segs = find_dimension_lines(parse, roles, words, shape_segs | grid_segs | sign_segs)
    out.braces = [{"kind": s["kind"], "pt": s["pt"], "segs": s["segs"]} for s in signs]
    hatch_segs = {i for i in range(len(parse.seg)) if hatch[i] or roles[i] == HATCH}
    out.consumed_segs = {
        "grid": grid_segs,
        "bubble_or_glyph_edges": shape_segs,
        "brace_sign": sign_segs,
        "dimension": dim_segs,
        "hatch_or_short": hatch_segs,
    }
    out.consumed = {k: len(v) for k, v in out.consumed_segs.items()}
    excluded = set().union(*out.consumed_segs.values())
    chains, spans = build_members(parse, roles, excluded, glyphs)
    out.chains = chains
    out.spans = spans
    attach_labels(spans, labels or [])
    return out


def words_of(page) -> list[Word]:
    """Words of the text layer in the displayed orientation."""
    import pymupdf

    m = page.rotation_matrix
    out = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        r = pymupdf.Rect(x0, y0, x1, y1) * m
        r.normalize()
        out.append(Word(text, (r.x0, r.y0, r.x1, r.y1)))
    return out


def check_evidence(pp: PagePieces) -> None:
    """Every piece carries evidence; a piece without it is a bug."""
    for s in pp.spans:
        assert s["segs"], "span without segment ids"
        assert len(s["supports"]) == 2
    for g in pp.glyphs:
        assert g["shape_ids"], "glyph without shape ids"
        assert len(g["signature"]) == 8
