"""Phase 14b: columns from labels, find similar, symbol families (docs/PHASE14B_PREREGISTRATION.md).

Flags (src/build/page.py, all off by default, column-plan pages only):
  col_real_size  symbols are small element groups 4 to 36 real inches long (2c);
  col_labels     a column / stud callout's leader ends at a symbol: a confirmed example (2a);
  col_similar    symbols of an example's family and real size become members of its kind (2b).
A family (2d) only names a symbol; a symbol becomes a column or stud only by matching an example.
Pure functions over the page's segments and text; deterministic.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from src.build.geom import Box, Pt, in_box
from src.build.grids import Bubble
from src.build.segments import PageSegments, TextLine
from src.text_layer.parsers.profile import find_profiles

# 2c
MAX_ELEMENT_IN = 36.0
REAL_LONG_MIN_IN, REAL_LONG_MAX_IN = 4.0, 36.0
REAL_SHORT_MIN_IN = 1.5
REAL_ASPECT_MAX = 6.0
PT_LONG_MIN, PT_LONG_MAX, PT_SHORT_MIN, PT_ASPECT_MAX = 3.0, 24.0, 3.0, 3.0
JOIN_PT = 1.0
TEXT_PAD_PT = 1.0
ARROW_MAX_IN = 6.0
# 2d
COLLINEAR_DEG = 2.0
ROUND_TOL = 0.15
SQUARE_ASPECT = 1.15
LACE_MIN_DEG, LACE_MAX_DEG = 20.0, 70.0
BACK_TO_BACK_IN = 1.0
# 2a
BLOCK_GAP = 1.5
BLOCK_MAX_LINES = 6
LEADER_LABEL_PT = 6.0
LEADER_JOIN_PT = 1.0
LEADER_MAX_SEGS = 3
LEADER_MIN_PT = 6.0
ARROW_SYMBOL_PT = 6.0
# 2b
SIZE_TOL_IN, SIZE_TOL_SHARE = 1.0, 0.15
# 3 (simulated click)
CLICK_PT = 12.0

STUD_RE = re.compile(r"\b(?:STUDS?|POSTS?)\b", re.IGNORECASE)
TYP_RE = re.compile(r"\bTYP(?:ICAL)?\b", re.IGNORECASE)
TWO_C_RE = re.compile(r"\b2\s*M?C\s*\d", re.IGNORECASE)
PL_RE = re.compile(r"\bPL\s*\d", re.IGNORECASE)
CALLOUT_FAMILIES = {"W", "HP", "S", "M", "HSS", "PIPE", "PL"}

STUD_KIND = "Stud/Post"
COLUMN_KIND = "Column"

FAMILIES = (
    "hss_filled",
    "hss_round",
    "hss_square",
    "hss_rect",
    "cruciform",
    "w_shape",
    "w_cover_plates",
    "built_up_3w",
    "built_up_3plates",
    "welded_box",
    "box_with_web",
    "2c_back_to_back",
    "2c_toe_laced",
    "double_laced",
)
GROUP = {
    **dict.fromkeys(("hss_filled", "hss_round", "hss_square", "hss_rect"), "hss"),
    **dict.fromkeys(("cruciform", "w_shape", "w_cover_plates", "built_up_3w"), "w"),
    **dict.fromkeys(
        (
            "built_up_3plates",
            "welded_box",
            "box_with_web",
            "2c_back_to_back",
            "2c_toe_laced",
            "double_laced",
        ),
        "built_up",
    ),
}


def real_in(pt: float, ratio: float) -> float:
    return pt * ratio / 72.0


# ---- outlines and families (2d) ----------
@dataclass
class Outline:
    sides: int  # straight sides after merging collinear edges; 0 = round
    box: Box
    filled: bool
    edges: list[tuple[Pt, Pt]]

    @property
    def round(self) -> bool:
        return self.sides == 0


def _ang(a: Pt, b: Pt) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def merge_edges(pts: list[Pt], closed: bool = True) -> list[tuple[Pt, Pt]]:
    """Polygon edges with collinear neighbours (within COLLINEAR_DEG) merged."""
    p = [q for k, q in enumerate(pts) if k == 0 or math.dist(q, pts[k - 1]) > 1e-6]
    if closed and len(p) > 1 and math.dist(p[0], p[-1]) <= 1e-6:
        p = p[:-1]
    if len(p) < 2:
        return []
    edges = [(p[k], p[(k + 1) % len(p)]) for k in range(len(p) if closed else len(p) - 1)]
    merged: list[tuple[Pt, Pt]] = []
    for e in edges:
        if merged and _angle_diff(_ang(*merged[-1]), _ang(*e)) <= COLLINEAR_DEG:
            merged[-1] = (merged[-1][0], e[1])
        else:
            merged.append(e)
    if (
        closed
        and len(merged) > 1
        and _angle_diff(_ang(*merged[-1]), _ang(*merged[0])) <= (COLLINEAR_DEG)
    ):
        merged[0] = (merged[-1][0], merged[0][1])
        merged.pop()
    return merged


def _is_round(pts: list[Pt]) -> bool:
    if len(pts) <= 12:
        return False
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    ds = [math.dist(p, (cx, cy)) for p in pts]
    m = sum(ds) / len(ds)
    return m > 0 and all(abs(d - m) <= ROUND_TOL * m for d in ds)


def _box_of(pts: Iterable[Pt]) -> Box:
    pts = list(pts)
    return (
        min(p[0] for p in pts),
        min(p[1] for p in pts),
        max(p[0] for p in pts),
        max(p[1] for p in pts),
    )


def outline_of(pts: list[Pt], curved: bool, filled: bool) -> Outline:
    box = _box_of(pts)
    if curved or _is_round(pts):
        return Outline(0, box, filled, [])
    edges = merge_edges(pts)
    return Outline(len(edges), box, filled, edges)


def _inside(a: Box, b: Box, pad: float = 0.5) -> bool:
    return a[0] >= b[0] - pad and a[1] >= b[1] - pad and a[2] <= b[2] + pad and a[3] <= b[3] + pad


def _gap(a: Box, b: Box) -> float:
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def _aspect(b: Box) -> float:
    w, h = b[2] - b[0], b[3] - b[1]
    s = min(w, h)
    return max(w, h) / s if s > 0 else math.inf


def _web_side(o: Outline) -> str | None:
    """The box side a C outline's back (web) lies on: the side with an edge spanning 90% of it
    whose opposite side has none (a C's flanges span both other sides)."""
    x0, y0, x1, y1 = o.box
    full = set()
    for a, b in o.edges:
        if abs(a[0] - b[0]) < 0.5 and abs(a[1] - b[1]) >= 0.9 * (y1 - y0):
            if abs(a[0] - x0) < 0.5:
                full.add("left")
            elif abs(a[0] - x1) < 0.5:
                full.add("right")
        if abs(a[1] - b[1]) < 0.5 and abs(a[0] - b[0]) >= 0.9 * (x1 - x0):
            if abs(a[1] - y0) < 0.5:
                full.add("top")
            elif abs(a[1] - y1) < 0.5:
                full.add("bottom")
    opposite = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
    webs = sorted(side for side in full if opposite[side] not in full)
    return webs[0] if len(webs) == 1 else None


def _facing(a: Outline, b: Outline) -> str | None:
    """'each_other' when the open sides (opposite the webs) point at the other outline, 'away'
    when the webs face each other's side, else None."""
    wa, wb = _web_side(a), _web_side(b)
    if wa is None or wb is None:
        return None
    ca = ((a.box[0] + a.box[2]) / 2, (a.box[1] + a.box[3]) / 2)
    cb = ((b.box[0] + b.box[2]) / 2, (b.box[1] + b.box[3]) / 2)
    toward_b = (
        ("right" if cb[0] > ca[0] else "left")
        if abs(cb[0] - ca[0]) >= abs(cb[1] - ca[1])
        else ("bottom" if cb[1] > ca[1] else "top")
    )
    opposite = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
    toward_a = opposite[toward_b]
    if wa == opposite[toward_b] and wb == opposite[toward_a]:
        return "each_other"
    if wa == toward_b and wb == toward_a:
        return "away"
    return None


def _cruciform(o: Outline) -> bool:
    x0, y0, x1, y1 = o.box
    w, h = x1 - x0, y1 - y0
    pts = [p for e in o.edges for p in e]
    corner = any(
        math.dist(p, c) < 0.05 * max(w, h)
        for p in pts
        for c in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))
    )
    if corner:
        return False

    def mid_third(v: float, lo: float, size: float) -> bool:
        return lo + size / 3 <= v <= lo + 2 * size / 3

    sides = [
        any(abs(p[0] - x0) < 0.5 and mid_third(p[1], y0, h) for p in pts),
        any(abs(p[0] - x1) < 0.5 and mid_third(p[1], y0, h) for p in pts),
        any(abs(p[1] - y0) < 0.5 and mid_third(p[0], x0, w) for p in pts),
        any(abs(p[1] - y1) < 0.5 and mid_third(p[0], x0, w) for p in pts),
    ]
    return all(sides)


def _i_strokes(strokes: list[tuple[Pt, Pt]]) -> bool:
    """Three strokes: two parallel equal ones joined at their middles by a perpendicular one."""
    if len(strokes) != 3:
        return False
    for k in range(3):
        web = strokes[k]
        f1, f2 = (strokes[j] for j in range(3) if j != k)
        if _angle_diff(_ang(*f1), _ang(*f2)) > COLLINEAR_DEG:
            continue
        l1, l2 = math.dist(*f1), math.dist(*f2)
        if min(l1, l2) <= 0 or abs(l1 - l2) > 0.15 * max(l1, l2):
            continue
        if abs(_angle_diff(_ang(*web), _ang(*f1)) - 90.0) > COLLINEAR_DEG:
            continue
        m1 = ((f1[0][0] + f1[1][0]) / 2, (f1[0][1] + f1[1][1]) / 2)
        m2 = ((f2[0][0] + f2[1][0]) / 2, (f2[0][1] + f2[1][1]) / 2)
        tol = 0.1 * max(l1, l2) + 1.0
        ends = web
        if (math.dist(ends[0], m1) <= tol and math.dist(ends[1], m2) <= tol) or (
            math.dist(ends[0], m2) <= tol and math.dist(ends[1], m1) <= tol
        ):
            return True
    return False


def _ring(rects: list[Outline]) -> bool:
    """Four 4-sided outlines forming a closed ring: each touches exactly two others, and together
    they surround an empty middle."""
    if len(rects) != 4:
        return False
    touch = [[_gap(a.box, b.box) <= JOIN_PT for b in rects] for a in rects]
    if any(sum(row) - 1 != 2 for row in touch):  # minus itself
        return False
    u = _box_of([(r.box[0], r.box[1]) for r in rects] + [(r.box[2], r.box[3]) for r in rects])
    mid = ((u[0] + u[2]) / 2, (u[1] + u[3]) / 2)
    return not any(in_box(mid, r.box) for r in rects)


def _three_plates(rects: list[Outline]) -> bool:
    if len(rects) != 3:
        return False
    for k in range(3):
        web = rects[k]
        a, b = (rects[j] for j in range(3) if j != k)
        wa, ha = a.box[2] - a.box[0], a.box[3] - a.box[1]
        wb, hb = b.box[2] - b.box[0], b.box[3] - b.box[1]
        if abs(wa - wb) > 0.15 * max(wa, wb) + 0.5 or abs(ha - hb) > 0.15 * max(ha, hb) + 0.5:
            continue
        horizontal = wa > ha
        ww, wh = web.box[2] - web.box[0], web.box[3] - web.box[1]
        if horizontal == (ww > wh):
            continue
        if _gap(web.box, a.box) <= JOIN_PT and _gap(web.box, b.box) <= JOIN_PT:
            return True
    return False


def classify(
    outlines: list[Outline],
    strokes: list[tuple[Pt, Pt]],
    lacing: int,
    back_to_back_pt: float = 0.0,
) -> str:
    """The family of a symbol (prereg 2d), or 'unknown'."""
    # a nested outline of the same kind inside another is the wall of the outer one
    outs = sorted(outlines, key=lambda o: -(o.box[2] - o.box[0]) * (o.box[3] - o.box[1]))
    kept: list[Outline] = []
    for o in outs:
        if any(_inside(o.box, k.box) and (o.round == k.round) and o.sides in (0, 4) for k in kept):
            if o.filled:
                kept = [replace_filled(k) if _inside(o.box, k.box) else k for k in kept]
            continue
        kept.append(o)
    n = len(kept)
    if n == 1:
        o = kept[0]
        filled = o.filled or lacing >= 2
        if o.sides in (0, 4) and filled:
            return "hss_filled"
        if o.round:
            return "hss_round"
        if o.sides == 4:
            return "hss_square" if _aspect(o.box) <= SQUARE_ASPECT else "hss_rect"
        if o.sides == 12:
            return "cruciform" if _cruciform(o) else "w_shape"
    if n == 0 and _i_strokes(strokes):
        return "w_shape"
    sides = sorted(o.sides for o in kept)
    rects = [o for o in kept if o.sides == 4]
    if sides == [4, 4, 12]:
        i = next(o for o in kept if o.sides == 12)
        if all(_gap(r.box, i.box) <= JOIN_PT for r in rects):
            return "w_cover_plates"
    if sides == [12, 12, 12]:
        return "built_up_3w"
    if sides == [4, 4, 4] and _three_plates(rects):
        return "built_up_3plates"
    if sides == [4, 4, 4, 4] and _ring(rects):
        return "welded_box"
    if len(rects) == 5 or (sides == [4, 4, 4, 4] and strokes):
        for k in range(len(rects)):
            ring = [r for j, r in enumerate(rects) if j != k]
            if _ring(ring):
                return "box_with_web"
        if sides == [4, 4, 4, 4] and _ring(rects):
            return "box_with_web"
    pair = [o for o in kept if o.sides in (8, 12)]
    if len(pair) == 2 and len(kept) - 2 == len([o for o in kept if o.sides == 4]):
        a, b = pair
        if a.sides == 8 and b.sides == 8 and _gap(a.box, b.box) <= back_to_back_pt:
            return "2c_back_to_back"
        battens = len(kept) > 2 or lacing >= 2
        face = _facing(a, b)
        if battens and face == "each_other" and a.sides == 8 and b.sides == 8:
            return "2c_toe_laced"
        if battens and face == "away":
            return "double_laced"
    return "unknown"


def replace_filled(o: Outline) -> Outline:
    return Outline(o.sides, o.box, True, o.edges)


# ---- symbols (2c) ----------
@dataclass
class Symbol:
    shape_ids: list[int]
    seg_ids: list[int]
    box: Box
    family: str
    signature: tuple
    rotation_deg: float
    real_w_in: float
    real_h_in: float
    filled: bool
    curved: bool

    @property
    def centre(self) -> Pt:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)

    @property
    def real_sides(self) -> tuple[float, float]:
        return (min(self.real_w_in, self.real_h_in), max(self.real_w_in, self.real_h_in))


class _BoxIndex:
    CELL = 40.0

    def __init__(self, boxes: list[Box]):
        self.cells: dict[tuple[int, int], list[int]] = {}
        for k, b in enumerate(boxes):
            for gx in range(int(b[0] // self.CELL), int(b[2] // self.CELL) + 1):
                for gy in range(int(b[1] // self.CELL), int(b[3] // self.CELL) + 1):
                    self.cells.setdefault((gx, gy), []).append(k)

    def near(self, b: Box, pad: float) -> set[int]:
        out: set[int] = set()
        for gx in range(int((b[0] - pad) // self.CELL), int((b[2] + pad) // self.CELL) + 1):
            for gy in range(int((b[1] - pad) // self.CELL), int((b[3] + pad) // self.CELL) + 1):
                out.update(self.cells.get((gx, gy), ()))
        return out


def _in_text(box: Box, text_boxes: list[Box], idx: _BoxIndex) -> bool:
    return any(_inside(box, text_boxes[k], TEXT_PAD_PT) for k in idx.near(box, TEXT_PAD_PT))


def find_symbols(
    ps: PageSegments,
    keep,
    crop: Box,
    text: list[TextLine],
    bubbles: list[Bubble],
    ratio: float,
    real_size: bool,
    not_segments: frozenset[int] = frozenset(),
) -> list[Symbol]:
    """Symbols (prereg 2c): element groups that pass the size filter, in (y, x) order."""
    max_pt = MAX_ELEMENT_IN * 72.0 / ratio if ratio else PT_LONG_MAX
    arrow_pt = ARROW_MAX_IN * 72.0 / ratio if ratio else 0.0
    bubble_shapes = {b.shape for b in bubbles}
    shapes = {sh.id: sh for sh in ps.shapes}
    elems: list[tuple[str, int, Box]] = []  # ("shape", id, box) | ("seg", index, box)
    used_shapes: set[int] = set()
    for sh in ps.shapes:
        if sh.id in bubble_shapes or not (sh.closed or "f" in sh.paint):
            continue
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        if max(w, h) > max_pt or max(w, h) <= 0:
            continue
        if (
            "f" in sh.paint
            and len(sh.pts) in (3, 4)
            and _is_triangle(sh.pts)
            and (max(w, h) <= arrow_pt)
        ):
            continue  # an arrowhead
        elems.append(("shape", sh.id, sh.bbox))
        used_shapes.add(sh.id)
    length = ps.length() if len(ps) else []
    for i in range(len(ps)):
        if i in not_segments or not keep[i]:
            continue
        sid = int(ps.shape_id[i])
        sh = shapes.get(sid)
        if sh is None or sh.closed or "f" in sh.paint or sid in bubble_shapes:
            continue
        if not 0 < length[i] <= max_pt:
            continue
        x0, y0, x1, y1 = map(float, ps.seg[i])
        elems.append(("seg", i, (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))))
    if not elems:
        return []
    boxes = [e[2] for e in elems]
    idx = _BoxIndex(boxes)
    parent = list(range(len(elems)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for k, b in enumerate(boxes):
        for j in idx.near(b, JOIN_PT):
            if j > k and _gap(b, boxes[j]) <= JOIN_PT:
                parent[find(k)] = find(j)
    groups: dict[int, list[int]] = {}
    for k in range(len(elems)):
        groups.setdefault(find(k), []).append(k)
    text_boxes = [t.box for t in text]
    tidx = _BoxIndex(text_boxes)
    out: list[Symbol] = []
    for members in groups.values():
        box = _box_of(
            [(boxes[k][0], boxes[k][1]) for k in members]
            + [(boxes[k][2], boxes[k][3]) for k in members]
        )
        w, h = box[2] - box[0], box[3] - box[1]
        long_s, short_s = max(w, h), min(w, h)
        if real_size:
            rl, rs = real_in(long_s, ratio), real_in(short_s, ratio)
            if not (REAL_LONG_MIN_IN <= rl <= REAL_LONG_MAX_IN) or rs < REAL_SHORT_MIN_IN:
                continue
            if rs <= 0 or rl / rs > REAL_ASPECT_MAX:
                continue
        else:
            if not PT_LONG_MIN <= long_s <= PT_LONG_MAX or short_s < PT_SHORT_MIN:
                continue
            if long_s / short_s > PT_ASPECT_MAX:
                continue
        c = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        if not in_box(c, crop) or _in_text(box, text_boxes, tidx):
            continue
        if any(
            _gap(
                box,
                (
                    b.centre[0] - b.radius,
                    b.centre[1] - b.radius,
                    b.centre[0] + b.radius,
                    b.centre[1] + b.radius,
                ),
            )
            <= 0
            for b in bubbles
        ):
            continue  # fmt: skip
        sh_ids = sorted(elems[k][1] for k in members if elems[k][0] == "shape")
        seg_ids = sorted(elems[k][1] for k in members if elems[k][0] == "seg")
        out.append(_symbol(ps, shapes, sh_ids, seg_ids, box, ratio))
    out.sort(key=lambda s: (round(s.centre[1], 1), round(s.centre[0], 1)))
    return out


def _is_triangle(pts: list[Pt]) -> bool:
    p = [q for k, q in enumerate(pts) if k == 0 or math.dist(q, pts[k - 1]) > 1e-6]
    if len(p) > 1 and math.dist(p[0], p[-1]) <= 1e-6:
        p = p[:-1]
    return len(p) == 3


def stroke_outline(strokes: list[tuple[Pt, Pt]]) -> Outline | None:
    """Open strokes whose ends all meet another end within JOIN_PT form one closed outline."""
    if len(strokes) < 3:
        return None
    ends = [p for s in strokes for p in s]
    for k, p in enumerate(ends):
        if not any(j // 2 != k // 2 and math.dist(p, q) <= JOIN_PT for j, q in enumerate(ends)):
            return None
    # merge collinear strokes that meet: count distinct straight sides
    sides: list[tuple[Pt, Pt]] = []
    for s in sorted(strokes, key=lambda s: (_ang(*s), s)):
        for k, t in enumerate(sides):
            if (
                _angle_diff(_ang(*s), _ang(*t)) <= COLLINEAR_DEG
                and min(math.dist(a, b) for a in s for b in t) <= JOIN_PT
                and _point_line(s[0], t) <= JOIN_PT
            ):
                pts = [*s, *t]
                far = max(((a, b) for a in pts for b in pts), key=lambda ab: math.dist(*ab))
                sides[k] = far
                break
        else:
            sides.append(s)
    box = _box_of([p for s in strokes for p in s])
    return Outline(len(sides), box, False, sides)


def _point_line(p: Pt, s: tuple[Pt, Pt]) -> float:
    (x0, y0), (x1, y1) = s
    d = math.dist(s[0], s[1])
    if d == 0:
        return math.dist(p, s[0])
    return abs((x1 - x0) * (y0 - p[1]) - (x0 - p[0]) * (y1 - y0)) / d


def _symbol(ps, shapes, sh_ids, seg_ids, box, ratio) -> Symbol:
    outlines = [outline_of(shapes[i].pts, shapes[i].curved, "f" in shapes[i].paint) for i in sh_ids]
    strokes = [
        ((float(ps.seg[i][0]), float(ps.seg[i][1])), (float(ps.seg[i][2]), float(ps.seg[i][3])))
        for i in seg_ids
    ]
    so = stroke_outline(strokes)
    if so is not None:
        outlines.append(so)
        free: list[tuple[Pt, Pt]] = []
    else:
        free = strokes
    w, h = box[2] - box[0], box[3] - box[1]
    long_ang = 0.0 if w >= h else 90.0
    lacing = sum(
        1
        for e in [*strokes, *(e for o in outlines for e in o.edges)]
        if LACE_MIN_DEG <= _angle_diff(_ang(*e), long_ang) <= LACE_MAX_DEG
    )
    family = classify(outlines, free, lacing, BACK_TO_BACK_IN * 72.0 / ratio if ratio else 0.0)
    signature = (tuple(sorted(o.sides for o in outlines)), any(o.filled for o in outlines))
    edges = [e for o in outlines for e in o.edges] + strokes
    rot = 0.0
    if edges:
        e = max(edges, key=lambda e: (math.dist(*e), e))
        rot = round(_ang(*e) % 90.0, 1)
    return Symbol(
        sh_ids,
        seg_ids,
        box,
        family,
        signature,
        rot,
        round(real_in(w, ratio), 2),
        round(real_in(h, ratio), 2),
        any(o.filled for o in outlines),
        any(o.round for o in outlines),
    )


# ---- callouts and leaders (2a) ----------
@dataclass
class Callout:
    line: TextLine
    block: Box
    profile: str  # canonical when known, else as written
    profile_family: str  # W, HSS-square, HSS-rect, HSS-round, PIPE, PL, 2C
    kind: str
    typical: bool


def _profile_of(text: str) -> tuple[str, str] | None:
    for p in find_profiles(text):
        if p.family not in CALLOUT_FAMILIES:
            continue
        fam = p.family
        if fam == "HSS":
            fam = {"square": "HSS-square", "rectangular": "HSS-rect"}.get(
                p.variant or "", "HSS-round"
            )
        if fam in ("HP", "S", "M"):
            fam = "W"
        return (p.canonical or p.raw, fam)
    m = TWO_C_RE.search(text)
    if m:
        return (re.sub(r"\s+", "", text[m.start() :].split()[0]).upper(), "2C")
    m = PL_RE.search(text)
    if m:
        return (re.sub(r"\s+", "", text[m.start() :].split()[0]).upper(), "PL")
    return None


def find_callouts(text: list[TextLine]) -> list[Callout]:
    out: list[Callout] = []
    for t in text:
        got = _profile_of(t.text)
        if got is None:
            continue
        block = [t]
        bbox = t.box
        h = max(t.box[3] - t.box[1], 0.1)
        grown = True
        while grown and len(block) < BLOCK_MAX_LINES:
            grown = False
            for o in sorted(text, key=lambda o: (o.box[1], o.box[0])):
                if o in block or len(block) >= BLOCK_MAX_LINES:
                    continue
                overlap = min(o.box[2], bbox[2]) - max(o.box[0], bbox[0])
                gap = max(o.box[1] - bbox[3], bbox[1] - o.box[3])
                if overlap > 0 and gap <= BLOCK_GAP * h:
                    block.append(o)
                    bbox = (
                        min(bbox[0], o.box[0]),
                        min(bbox[1], o.box[1]),
                        max(bbox[2], o.box[2]),
                        max(bbox[3], o.box[3]),
                    )
                    grown = True
        words = " ".join(b.text for b in block)
        out.append(
            Callout(
                t,
                bbox,
                got[0],
                got[1],
                STUD_KIND if STUD_RE.search(words) else COLUMN_KIND,
                bool(TYP_RE.search(words)),
            )
        )
    return out


def _box_point_dist(p: Pt, b: Box) -> float:
    dx = max(b[0] - p[0], 0.0, p[0] - b[2])
    dy = max(b[1] - p[1], 0.0, p[1] - b[3])
    return math.hypot(dx, dy)


@dataclass
class Leader:
    segs: list[int]
    end: Pt


def leaders(ps: PageSegments, block: Box) -> list[Leader]:
    """Chains of up to LEADER_MAX_SEGS segments leaving the block (prereg 2a), in a fixed order."""
    n = len(ps)
    if n == 0:
        return []
    seg = [tuple(map(float, ps.seg[i])) for i in range(n)]
    cell = 8.0
    ends: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for i, (x0, y0, x1, y1) in enumerate(seg):
        for k, (x, y) in enumerate(((x0, y0), (x1, y1))):
            ends.setdefault((int(x // cell), int(y // cell)), []).append((i, k))

    def end_pt(i: int, k: int) -> Pt:
        s = seg[i]
        return (s[0], s[1]) if k == 0 else (s[2], s[3])

    def at(p: Pt, r: float) -> list[tuple[int, int]]:
        out = []
        for gx in range(int((p[0] - r) // cell), int((p[0] + r) // cell) + 1):
            for gy in range(int((p[1] - r) // cell), int((p[1] + r) // cell) + 1):
                for i, k in ends.get((gx, gy), ()):
                    if math.dist(end_pt(i, k), p) <= r:
                        out.append((i, k))
        return sorted(out)

    starts: set[tuple[int, int]] = set()
    for gx in range(
        int((block[0] - LEADER_LABEL_PT) // cell), int((block[2] + LEADER_LABEL_PT) // cell) + 1
    ):
        for gy in range(
            int((block[1] - LEADER_LABEL_PT) // cell), int((block[3] + LEADER_LABEL_PT) // cell) + 1
        ):
            for i, k in ends.get((gx, gy), ()):
                if _box_point_dist(end_pt(i, k), block) <= LEADER_LABEL_PT:
                    starts.add((i, k))  # fmt: skip
    out: list[Leader] = []

    def walk(chain: list[int], far: Pt, total: float) -> None:
        if total >= LEADER_MIN_PT and _box_point_dist(far, block) >= LEADER_MIN_PT:
            out.append(Leader(list(chain), far))
        if len(chain) >= LEADER_MAX_SEGS:
            return
        for i, k in at(far, LEADER_JOIN_PT):
            if i in chain:
                continue
            nxt = end_pt(i, 1 - k)
            walk([*chain, i], nxt, total + math.dist(end_pt(i, k), nxt))

    for i, k in sorted(starts):
        s = seg[i]
        if math.dist((s[0], s[1]), (s[2], s[3])) <= 0:
            continue
        far = end_pt(i, 1 - k)
        if _box_point_dist(far, block) <= _box_point_dist(end_pt(i, k), block):
            continue  # the segment must leave the block
        walk([i], far, math.dist(end_pt(i, k), far))
    return out


@dataclass
class Example:
    symbol: Symbol
    profile: str | None
    profile_family: str | None
    kind: str
    typical: bool
    source: str  # label | click
    callout_box: Box | None = None


def label_examples(
    callouts: list[Callout], chains: list[list[Leader]], symbols: list[Symbol]
) -> list[Example]:
    """One example per callout: the symbol nearest a leader's arrow end, within ARROW_SYMBOL_PT."""
    idx = _BoxIndex([s.box for s in symbols])
    out: list[Example] = []
    taken: set[int] = set()
    for co, ls in zip(callouts, chains, strict=True):
        best = None
        for li, ld in enumerate(ls):
            for k in idx.near((ld.end[0], ld.end[1], ld.end[0], ld.end[1]), ARROW_SYMBOL_PT):
                d = _box_point_dist(ld.end, symbols[k].box)
                if d <= ARROW_SYMBOL_PT and (best is None or (d, li, k) < best):
                    best = (d, li, k)
        if best is None or best[2] in taken:
            continue
        taken.add(best[2])
        out.append(
            Example(symbols[best[2]], co.profile, co.profile_family, co.kind, co.typical, "label",
                    co.block)
        )  # fmt: skip
    return out


# ---- find similar (2b) and cross-check (2e) ------------------------------------------------------
def same_size(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return all(
        abs(x - y) <= max(SIZE_TOL_IN, SIZE_TOL_SHARE * y) for x, y in zip(a, b, strict=True)
    )


def same_kind(s: Symbol, e: Symbol) -> bool:
    if s.family != e.family:
        return False
    if s.family == "unknown" and s.signature != e.signature:
        return False
    return same_size(s.real_sides, e.real_sides)


@dataclass
class ColumnHit:
    symbol: Symbol
    example: int  # index into the examples
    kind: str
    profile: str | None
    source: str  # label | similar | click
    flag: str | None = None
    profile_on_row: bool = False  # sensitivity: TYP on the example's row / column only


def find_similar(examples: list[Example], symbols: list[Symbol]) -> list[ColumnHit]:
    """Every example and every symbol matching one (prereg 2b), in (y, x) order."""
    by_sym = {id(e.symbol): k for k, e in enumerate(examples)}
    out: list[ColumnHit] = []
    for s in symbols:
        if id(s) in by_sym:
            k = by_sym[id(s)]
            e = examples[k]
            out.append(ColumnHit(s, k, e.kind, e.profile, e.source, profile_on_row=True))
            continue
        cands = [
            (math.dist(s.centre, e.symbol.centre), k)
            for k, e in enumerate(examples)
            if same_kind(s, e.symbol)
        ]
        if not cands:
            continue
        _, k = min(cands)
        e = examples[k]
        long_pt = max(e.symbol.box[2] - e.symbol.box[0], e.symbol.box[3] - e.symbol.box[1])
        on_row = (
            abs(s.centre[1] - e.symbol.centre[1]) <= long_pt
            or abs(s.centre[0] - e.symbol.centre[0]) <= long_pt
        )
        out.append(
            ColumnHit(s, k, e.kind, e.profile if e.typical else None, "similar",
                      profile_on_row=e.typical and on_row)
        )  # fmt: skip
    for h in out:
        h.flag = cross_check(examples[h.example].profile_family, h.symbol.family)
    return out


def cross_check(profile_family: str | None, family: str) -> str | None:
    """A red flag when the label's profile family and the drawn family disagree (prereg 2e)."""
    if profile_family is None or family == "unknown":
        return None
    ok = {
        "W": {"cruciform", "w_shape", "w_cover_plates", "built_up_3w"},
        "HSS-square": {"hss_square", "hss_filled"},
        "HSS-rect": {"hss_rect", "hss_filled"},
        "HSS-round": {"hss_round", "hss_filled"},
        "PIPE": {"hss_round", "hss_filled"},
        "PL": {"built_up_3plates", "welded_box", "box_with_web"},
        "2C": {"2c_back_to_back", "2c_toe_laced", "double_laced"},
    }.get(profile_family)
    if ok is None or family in ok:
        return None
    return f"label {profile_family}, drawn {family}"


def click_example(mark: Pt, symbols: list[Symbol]) -> Example | None:
    """A simulated (or real) user-drawn column at `mark`: the symbol whose centre is within
    CLICK_PT (nearest; ties: first in order)."""
    best = None
    for k, s in enumerate(symbols):
        d = math.dist(mark, s.centre)
        if d <= CLICK_PT and (best is None or (d, k) < best):
            best = (d, k)
    if best is None:
        return None
    return Example(symbols[best[1]], None, None, COLUMN_KIND, False, "click")


@dataclass
class ColumnResult:
    hits: list[ColumnHit] = field(default_factory=list)
    examples: list[Example] = field(default_factory=list)
    callouts: int = 0
    callouts_with_leader: int = 0
    symbols: list[Symbol] = field(default_factory=list)
    note: str | None = None


def label_columns(
    ps: PageSegments,
    keep,
    crop: Box,
    text: list[TextLine],
    bubbles: list[Bubble],
    ratio: float,
    flags: frozenset[str],
    clicks: list[Pt] | None = None,
) -> ColumnResult:
    """Prereg 2a-2e on one column-plan page (text and segments already cropped)."""
    callouts = find_callouts(text) if "col_labels" in flags else []
    chains = [leaders(ps, c.block) for c in callouts]
    used = frozenset(i for ls in chains for ld in ls for i in ld.segs)
    symbols = find_symbols(ps, keep, crop, text, bubbles, ratio, "col_real_size" in flags, used)
    examples = label_examples(callouts, chains, symbols)
    if not examples and clicks:
        for m in clicks:
            ex = click_example(m, symbols)
            if ex is not None:
                examples = [ex]
                break
    res = ColumnResult(
        examples=examples,
        callouts=len(callouts),
        callouts_with_leader=sum(1 for ls in chains if ls),
        symbols=symbols,
    )
    if not examples:
        res.note = "click one column to find similar"
        return res
    if "col_similar" in flags:
        res.hits = find_similar(examples, symbols)
    else:
        res.hits = [
            ColumnHit(e.symbol, k, e.kind, e.profile, e.source,
                      cross_check(e.profile_family, e.symbol.family))
            for k, e in enumerate(examples)
        ]  # fmt: skip
    return res
