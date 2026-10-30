"""Auto mode proposals: the setup the system would use for a page (Phase 11b).

Every rule here is an existing one (docs/PHASE11_PREREGISTRATION.md section 3, docs/PHASE11B_PLAN.md
section 2); nothing is tuned on a job:
  - role: the page type guess (foundation plan -> column plan, framing plan -> framing, else skip);
  - crop: the box around the bubbles that anchor grid lines, grown by CROP_MARGIN_PT beyond each
    bubble's radius and clipped to the page; with no anchored grid line, the whole-sheet box;
  - pen class: the line class suggester inside the crop (src/linking/structural.py);
  - scale: the sheet's stored effective ratio (a person's override, else the parsed one);
  - T.O.S.: the T.O.S. notes parsed inside the crop (src/text_layer/parsers/elevation.py, reference
    top of steel, not a signed offset, with a value): the most frequent value, a tie gives none;
  - column plan of a framing page: the only built column plan, else the one with the most grid
    labels in common with the page, a tie gives none.
Pure functions over a page and its text; no database access.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import pymupdf

from src.build.clean import clean
from src.build.columns import find_glyphs
from src.build.geom import Box, Pt, box_dist, point_seg_dist, seg_intersection
from src.build.grids import (
    GRID_EXTEND_PT,
    GridLine,
    crossings,
    find_bubbles,
    find_grid_lines,
)
from src.build.segments import TextLine, crop, parse_page
from src.linking.lines import Line, page_lines
from src.linking.structural import MIN_LINES, class_table, lines_in_box, suggest_classes
from src.review.line_roles import HATCH
from src.text_layer.parsers.elevation import find_elevations

CROP_MARGIN_PT = 36.0
WHOLE_MARGIN, WHOLE_RIGHT = 0.025, 0.14  # Phase 5b whole-sheet view box
ROLE_OF_GUESS = {"foundation_plan": "column_plan", "framing_plan": "framing"}


@dataclass
class CropProposal:
    box: Box
    rule: str  # "grid_bubbles" | "fallback_whole_sheet"
    grid: list[GridLine] = field(default_factory=list)
    bubbles: list = field(default_factory=list)


@dataclass
class TosProposal:
    mm: float | None
    raw: str | None
    rule: str  # "single_note" | "most_frequent" | "tie" | "none"
    notes: int  # T.O.S. notes with a value inside the crop


def displayed_size(page: pymupdf.Page) -> tuple[float, float]:
    w, h = page.rect.width, page.rect.height
    return (h, w) if page.rotation in (90, 270) else (w, h)


def whole_sheet_box(w: float, h: float) -> Box:
    return (w * WHOLE_MARGIN, h * WHOLE_MARGIN, w * (1 - WHOLE_RIGHT), h * (1 - WHOLE_MARGIN))


def propose_role(page_type_guess: str | None) -> str | None:
    """'column_plan', 'framing' or None (skip)."""
    return ROLE_OF_GUESS.get(page_type_guess or "")


def propose_crop(page: pymupdf.Page, text: list[TextLine]) -> CropProposal:
    w, h = displayed_size(page)
    full = (0.0, 0.0, w, h)
    ps = crop(parse_page(page), full)
    cl = clean(ps, text)
    bubbles = find_bubbles(ps, text, full)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    anchors = [b for g in grid for b in g.bubbles]
    if not anchors:
        return CropProposal(whole_sheet_box(w, h), "fallback_whole_sheet", grid, bubbles)
    box = (
        max(0.0, min(b.centre[0] - b.radius for b in anchors) - CROP_MARGIN_PT),
        max(0.0, min(b.centre[1] - b.radius for b in anchors) - CROP_MARGIN_PT),
        min(w, max(b.centre[0] + b.radius for b in anchors) + CROP_MARGIN_PT),
        min(h, max(b.centre[1] + b.radius for b in anchors) + CROP_MARGIN_PT),
    )
    return CropProposal(box, "grid_bubbles", grid, bubbles)


def propose_pen(
    page: pymupdf.Page, box: Box, lines: list[Line] | None = None
) -> tuple[str | None, list[Line]]:
    """(the suggested beam pen class or None, the extracted lines inside the box)."""
    in_crop = lines_in_box(page_lines(page) if lines is None else lines, box, displayed_size(page))
    pen = suggest_classes(class_table(in_crop))
    return (pen[0] if pen else None), in_crop


def propose_scale(sheet: dict[str, Any]) -> tuple[float | None, str | None]:
    """The stored effective scale: a person's override, else the parsed one."""
    if sheet.get("scale_override_ratio") is not None:
        return float(sheet["scale_override_ratio"]), sheet.get("scale_override")
    if sheet.get("scale_parsed_ratio") is not None:
        return float(sheet["scale_parsed_ratio"]), sheet.get("scale_parsed")
    return None, None


def _inside(t: TextLine, box: Box) -> bool:
    cx, cy = t.centre
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def propose_tos(text: list[TextLine], box: Box) -> TosProposal:
    values: Counter[float] = Counter()
    first_raw: dict[float, str] = {}
    for t in text:
        if not _inside(t, box):
            continue
        for e in find_elevations(t.text):
            if e.reference != "top_of_steel" or e.is_relative or e.value_mm is None:
                continue
            v = round(e.value_mm, 1)
            values[v] += 1
            first_raw.setdefault(v, e.raw)
    if not values:
        return TosProposal(None, None, "none", 0)
    notes = sum(values.values())
    ranked = values.most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return TosProposal(None, None, "tie", notes)
    v = ranked[0][0]
    rule = "single_note" if len(ranked) == 1 else "most_frequent"
    return TosProposal(v, first_raw[v], rule, notes)


def choose_column_plan(
    page_labels: set[tuple[str, str]], plans: dict[str, set[tuple[str, str]]]
) -> tuple[str | None, str]:
    """(column plan sheet id or None, rule). `plans` maps each BUILT column plan page to its grid
    labels as (family, label); `page_labels` are the framing page's."""
    if not plans:
        return None, "no_column_plan_built"
    if len(plans) == 1:
        return next(iter(plans)), "only_column_plan"
    shared = sorted(((len(page_labels & lab), sid) for sid, lab in plans.items()), reverse=True)
    if shared[0][0] == 0 or shared[0][0] == shared[1][0]:
        return None, "no_clear_column_plan"
    return shared[0][1], "most_grid_labels_shared"


def grid_labels(grid: list[GridLine]) -> set[tuple[str, str]]:
    return {(g.family or "", g.label) for g in grid if g.label}


__all__ = [
    "CROP_MARGIN_PT",
    "CropProposal",
    "TosProposal",
    "choose_column_plan",
    "displayed_size",
    "grid_labels",
    "propose_crop",
    "propose_pen",
    "propose_role",
    "propose_scale",
    "propose_tos",
    "whole_sheet_box",
]


# --- Phase 13c proposals (behind flags; the rules above are unchanged) ---------------------------
# F1 "structural pen": candidate lines of at least PEN_MIN_IN real inches inside the crop, lines on
# a grid line left out; per pen with at least MIN_LINES such lines, four shares weighted below.
PEN_MIN_IN = 24.0
ON_GRID_PT = 2.0
ORTHO_DEG = 2.0
END_SUPPORT_PT = 12.0
SPAN_GRID_PT = 12.0
SPAN_GRID_MIN_DEG = 60.0
SPAN_GRID_MIN = 2
TEXT_ZONE_PAD_PT = 6.0
DIM_ZONE_PT = 2.0
PEN_WEIGHTS = {"orthogonal": 0.20, "ends_supported": 0.30, "spans_grid": 0.30, "clear": 0.20}

Seg = tuple[float, float, float, float]


def seg_seg_dist(a: Seg, b: Seg) -> float:
    if seg_intersection((a[0], a[1]), (a[2], a[3]), (b[0], b[1]), (b[2], b[3])) is not None:
        return 0.0
    return min(
        point_seg_dist((a[0], a[1]), (b[0], b[1]), (b[2], b[3])),
        point_seg_dist((a[2], a[3]), (b[0], b[1]), (b[2], b[3])),
        point_seg_dist((b[0], b[1]), (a[0], a[1]), (a[2], a[3])),
        point_seg_dist((b[2], b[3]), (a[0], a[1]), (a[2], a[3])),
    )


def _ang(s: Seg) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def _adiff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def score_pens(
    lines: dict[str, list[Seg]],
    grid: list[Seg],
    glyph_boxes: list[Box],
    text_boxes: list[Box],
    dim_segs: list[Seg],
) -> dict[str, dict[str, float]]:
    """F1 shares and score per pen (pens with at least MIN_LINES lines after the grid filter)."""
    out: dict[str, dict[str, float]] = {}
    for pen in sorted(lines):
        segs = [
            s
            for s in lines[pen]
            if not any(
                point_seg_dist((s[0], s[1]), (g[0], g[1]), (g[2], g[3])) <= ON_GRID_PT
                and point_seg_dist((s[2], s[3]), (g[0], g[1]), (g[2], g[3])) <= ON_GRID_PT
                for g in grid
            )
        ]
        if len(segs) < MIN_LINES:
            continue
        n = len(segs)
        ortho = sum(min(_adiff(_ang(s), 0.0), _adiff(_ang(s), 90.0)) <= ORTHO_DEG for s in segs)
        ends = 0
        spans = 0
        clear = 0
        for i, s in enumerate(segs):
            pts: list[Pt] = [(s[0], s[1]), (s[2], s[3])]
            if any(
                any(box_dist(p, b) <= END_SUPPORT_PT for b in glyph_boxes)
                or any(
                    point_seg_dist(p, (g[0], g[1]), (g[2], g[3])) <= END_SUPPORT_PT for g in grid
                )
                or any(
                    point_seg_dist(p, (o[0], o[1]), (o[2], o[3])) <= END_SUPPORT_PT
                    for j, o in enumerate(segs)
                    if j != i
                )
                for p in pts
            ):
                ends += 1
            a = _ang(s)
            hit = sum(
                1
                for g in grid
                if _adiff(_ang(g), a) >= SPAN_GRID_MIN_DEG and seg_seg_dist(s, g) <= SPAN_GRID_PT
            )
            spans += hit >= SPAN_GRID_MIN
            m = ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)
            in_text = any(
                b[0] - TEXT_ZONE_PAD_PT <= m[0] <= b[2] + TEXT_ZONE_PAD_PT
                and b[1] - TEXT_ZONE_PAD_PT <= m[1] <= b[3] + TEXT_ZONE_PAD_PT
                for b in text_boxes
            )
            near_dim = any(
                point_seg_dist(m, (d[0], d[1]), (d[2], d[3])) <= DIM_ZONE_PT for d in dim_segs
            )
            clear += not in_text and not near_dim
        sh = {
            "orthogonal": ortho / n,
            "ends_supported": ends / n,
            "spans_grid": (spans / n) if grid else 0.0,
            "clear": clear / n,
        }
        sh["score"] = sum(PEN_WEIGHTS[k] * sh[k] for k in PEN_WEIGHTS)
        sh["lines"] = n
        sh["length"] = sum(math.hypot(s[2] - s[0], s[3] - s[1]) for s in segs)
        out[pen] = sh
    return out


def best_structural_pen(scores: dict[str, dict[str, float]]) -> str | None:
    """Highest score; ties: larger total length, then the pen class name."""
    if not scores:
        return None
    return min(scores, key=lambda p: (-scores[p]["score"], -scores[p]["length"], p))


def propose_pen_structural(
    page: pymupdf.Page, box: Box, ratio: float, text: list[TextLine]
) -> tuple[str | None, dict[str, dict[str, float]]]:
    """F1-auto: the pen with the best structure score inside the crop (no estimator data)."""
    min_pt = PEN_MIN_IN * 72.0 / ratio
    by_pen: dict[str, list[Seg]] = {}
    for ln in lines_in_box(page_lines(page), box, displayed_size(page)):
        if ln.length >= min_pt:
            by_pen.setdefault(ln.klass, []).append((ln.x0, ln.y0, ln.x1, ln.y1))
    t_in = [t for t in text if _inside(t, box)]
    ps = crop(parse_page(page), box)
    cl = clean(ps, t_in)
    bubbles = find_bubbles(ps, t_in, box)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    glyphs = find_glyphs(ps, box, bubbles, t_in, crossings(grid))
    removed = (~cl.keep) & (cl.roles != HATCH) if len(ps) else []
    dim_segs = [tuple(map(float, ps.seg[i])) for i in range(len(ps)) if removed[i]]
    scores = score_pens(
        by_pen,
        [(*g.p0, *g.p1) for g in grid],
        [g.box for g in glyphs],
        [t.box for t in t_in],
        dim_segs,  # type: ignore[arg-type]
    )
    return best_structural_pen(scores), scores


# F3 "main grid crop": the bounding box of the main grid's bubbles and line ends + CROP_MARGIN_PT,
# united with the person's crop; "crop cuts grid" when the person's crop leaves out a bubble.


def grid_sets(grid: list[GridLine]) -> list[list[int]]:
    """Grid lines linked when a numbered and a lettered line cross (with the engine's extension);
    connected sets, largest first (ties: more crossings, then the smallest top-left corner)."""
    n = len(grid)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    links = [0] * n
    for i in range(n):
        for j in range(n):
            a, b = grid[i], grid[j]
            if a.family != "N" or b.family != "A":
                continue
            if seg_intersection(a.p0, a.p1, b.p0, b.p1, GRID_EXTEND_PT, GRID_EXTEND_PT) is None:
                continue
            parent[find(i)] = find(j)
            links[i] += 1
    sets: dict[int, list[int]] = {}
    for i in range(n):
        sets.setdefault(find(i), []).append(i)

    def corner(ids: list[int]) -> tuple[float, float]:
        pts = [p for k in ids for p in (grid[k].p0, grid[k].p1)]
        return (min(p[1] for p in pts), min(p[0] for p in pts))

    return sorted(
        sets.values(), key=lambda ids: (-len(ids), -sum(links[k] for k in ids), corner(ids))
    )


def main_grid_box(grid: list[GridLine], size: tuple[float, float]) -> Box | None:
    sets = grid_sets(grid)
    if not sets:
        return None
    lines = [grid[k] for k in sets[0]]
    xs: list[float] = []
    ys: list[float] = []
    for g in lines:
        xs += [g.p0[0], g.p1[0]]
        ys += [g.p0[1], g.p1[1]]
        for b in g.bubbles:
            xs += [b.centre[0] - b.radius, b.centre[0] + b.radius]
            ys += [b.centre[1] - b.radius, b.centre[1] + b.radius]
    w, h = size
    return (
        max(0.0, min(xs) - CROP_MARGIN_PT),
        max(0.0, min(ys) - CROP_MARGIN_PT),
        min(w, max(xs) + CROP_MARGIN_PT),
        min(h, max(ys) + CROP_MARGIN_PT),
    )


def union_box(a: Box, b: Box | None) -> Box:
    if b is None:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def cuts_grid(person: Box, grid: list[GridLine]) -> bool:
    sets = grid_sets(grid)
    if not sets:
        return False
    return any(
        not (person[0] <= b.centre[0] <= person[2] and person[1] <= b.centre[1] <= person[3])
        for k in sets[0]
        for b in grid[k].bubbles
    )


@dataclass
class MainGridCrop:
    box: Box  # the crop used: the person's crop united with the main grid box
    proposed: Box | None  # the main grid box (None: no grid)
    cuts_grid: bool
    main_lines: int
    other_lines: int


def propose_crop_main_grid(page: pymupdf.Page, text: list[TextLine], person: Box) -> MainGridCrop:
    w, h = displayed_size(page)
    full = (0.0, 0.0, w, h)
    ps = crop(parse_page(page), full)
    cl = clean(ps, text)
    bubbles = find_bubbles(ps, text, full)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    sets = grid_sets(grid)
    proposed = main_grid_box(grid, (w, h))
    main = len(sets[0]) if sets else 0
    return MainGridCrop(
        union_box(person, proposed), proposed, cuts_grid(person, grid), main, len(grid) - main
    )
