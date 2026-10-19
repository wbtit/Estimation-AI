"""Step 4: grid lines from bubbles with labels and dash-dot or long lines (port of the Phase 7
grammar rules, widened as agreed for Phase 11).

A bubble is a closed curved shape of 10 to 40 pt, nearly round, with a short label (1 to 4
characters: letters, digits, '.', apostrophe) of the text inside it. A grid line is a chain of
collinear segments of ONE pen (width and colour), gaps up to GRID_GAP_PT, at least GRID_MIN_LEN_PT
long, that ends at a bubble: the bubble centre lies on its axis (GRID_AXIS_TOL_PT) and an end of the
chain is within the bubble radius + GRID_END_TOL_PT. Dashed (dash-dot drawn as pieces, or a PDF dash
array) and long solid lines both count (Phase 7 accepted only dashed-like lines and anchored few
grids). Lines with the same label that lie on one axis are one grid line (bubbles at both ends).
Family: a label starting with a digit is N, anything else A; grid crossings pair N with A.
Labels keep their exact characters.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np

from src.build.chain import chain_segments
from src.build.geom import Box, Pt, angle_deg, angle_diff, in_box, project, seg_intersection
from src.build.segments import PageSegments, TextLine

BUBBLE_MIN_PT, BUBBLE_MAX_PT, BUBBLE_ASPECT = 10.0, 40.0, 1.2
LABEL_RE = re.compile(r"^[A-Za-z0-9.']{1,4}$")
GRID_MIN_LEN_PT = 150.0
GRID_GAP_PT = 12.0
GRID_CHAIN_ANGLE_DEG = 1.0
GRID_CHAIN_OFFSET_PT = 1.0
GRID_AXIS_TOL_PT = 6.0
GRID_END_TOL_PT = 12.0
GRID_SAME_AXIS_DEG = 1.0
GRID_SAME_AXIS_PT = 6.0
GRID_EXTEND_PT = 24.0  # grid lines meet when they cross within this extension
# Phase 12b rule "grid_family_by_direction": a label family with lines in two directions at least
# 90 - FAMILY_DIRECTION_TOL_DEG apart is split by direction (more vertical lines -> "N")
FAMILY_DIRECTION_TOL_DEG = 20.0


@dataclass
class Bubble:
    shape: int
    centre: Pt
    radius: float
    label: str

    @property
    def family(self) -> str:
        return family_of(self.label)


@dataclass
class GridLine:
    label: str
    family: str
    p0: Pt
    p1: Pt
    bubbles: list[Bubble] = field(default_factory=list)
    seg_ids: list[int] = field(default_factory=list)

    @property
    def angle(self) -> float:
        return angle_deg(self.p0, self.p1)


@dataclass
class Crossing:
    point: Pt
    n_label: str
    a_label: str


def family_of(label: str) -> str:
    return "N" if label[:1].isdigit() else "A"


def find_bubbles(ps: PageSegments, text: list[TextLine], box: Box) -> list[Bubble]:
    out: list[Bubble] = []
    for sh in ps.shapes:
        if not (sh.curved and sh.closed):
            continue
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        if not (BUBBLE_MIN_PT <= w <= BUBBLE_MAX_PT and BUBBLE_MIN_PT <= h <= BUBBLE_MAX_PT):
            continue
        if max(w, h) / max(min(w, h), 1e-9) > BUBBLE_ASPECT:
            continue
        c = ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
        if not in_box(c, box):
            continue
        r = max(w, h) / 2
        inside = sorted(
            (t for t in text if math.hypot(t.centre[0] - c[0], t.centre[1] - c[1]) <= r),
            key=lambda t: (t.box[0], t.box[1]),
        )
        label = "".join(t.text.strip() for t in inside)
        if not LABEL_RE.match(label):
            continue
        out.append(Bubble(sh.id, c, r, label))
    out.sort(key=lambda b: (round(b.centre[0], 1), round(b.centre[1], 1), b.shape))
    keep: list[Bubble] = []
    for b in out:  # a circle drawn twice (fill and outline) is one bubble
        if any(
            math.hypot(b.centre[0] - k.centre[0], b.centre[1] - k.centre[1]) < 2.0 for k in keep
        ):
            continue
        keep.append(b)
    return keep


def find_grid_lines(
    ps: PageSegments, keep: np.ndarray, bubbles: list[Bubble]
) -> tuple[list[GridLine], set[int]]:
    """Grid lines and the segment ids they use."""
    if not bubbles or len(ps) == 0:
        return [], set()
    length = ps.length()
    by_pen: dict[tuple[float, str], list[int]] = {}
    for i in range(len(ps)):
        if keep[i] and length[i] >= 1.0:
            by_pen.setdefault((round(float(ps.width[i]), 2), ps.colour[i]), []).append(i)
    found: list[GridLine] = []
    for pen in sorted(by_pen):
        for ch in chain_segments(
            ps.seg, by_pen[pen], GRID_GAP_PT, GRID_CHAIN_ANGLE_DEG, GRID_CHAIN_OFFSET_PT
        ):
            if ch.length < GRID_MIN_LEN_PT:
                continue
            anchors: list[tuple[float, int, Bubble]] = []
            for b in bubbles:
                _, perp = project(b.centre, ch.p0, ch.p1)
                if perp > GRID_AXIS_TOL_PT:
                    continue
                e = min(math.dist(b.centre, ch.p0), math.dist(b.centre, ch.p1))
                if e <= b.radius + GRID_END_TOL_PT:
                    anchors.append((e, b.shape, b))
            if not anchors:
                continue
            anchors.sort(key=lambda t: (t[0], t[1]))
            b = anchors[0][2]  # the nearest bubble names the line; others with its label join
            same = [a[2] for a in anchors if a[2].label == b.label]
            found.append(GridLine(b.label, b.family, ch.p0, ch.p1, same, list(ch.seg_ids)))
    return _merge_same_axis(found)


def _merge_same_axis(lines: list[GridLine]) -> tuple[list[GridLine], set[int]]:
    lines = sorted(lines, key=lambda g: (g.label, -math.dist(g.p0, g.p1), g.p0, g.p1))
    out: list[GridLine] = []
    for g in lines:
        for k in out:
            if k.label != g.label or angle_diff(k.angle, g.angle) > GRID_SAME_AXIS_DEG:
                continue
            if max(project(g.p0, k.p0, k.p1)[1], project(g.p1, k.p0, k.p1)[1]) > GRID_SAME_AXIS_PT:
                continue
            s = [0.0, math.dist(k.p0, k.p1), project(g.p0, k.p0, k.p1)[0]]
            s.append(project(g.p1, k.p0, k.p1)[0])
            lo, hi = min(s), max(s)
            length = math.dist(k.p0, k.p1)
            ux, uy = (k.p1[0] - k.p0[0]) / length, (k.p1[1] - k.p0[1]) / length
            a = k.p0
            k.p0, k.p1 = (a[0] + ux * lo, a[1] + uy * lo), (a[0] + ux * hi, a[1] + uy * hi)
            k.bubbles.extend(b for b in g.bubbles if b.shape not in {x.shape for x in k.bubbles})
            k.seg_ids = sorted(set(k.seg_ids) | set(g.seg_ids))
            break
        else:
            out.append(g)
    used = {i for g in out for i in g.seg_ids}
    out = families_by_direction(out)
    out.sort(key=lambda g: (g.family, g.label))
    return out, used


def _is_vertical(g: GridLine) -> bool:
    return angle_diff(g.angle, 90.0) < angle_diff(g.angle, 0.0)


def families_by_direction(lines: list[GridLine]) -> list[GridLine]:
    """Rule "grid_family_by_direction": labels like E.12 and E.14 are one family by their first
    character, but when that family holds lines in two directions (at least 90 -
    FAMILY_DIRECTION_TOL_DEG apart) the drawing uses one prefix for both axes: the more vertical
    lines become numbers ("N") and the others letters ("A"), so they cross."""
    for fam in sorted({g.family for g in lines}):
        group = [g for g in lines if g.family == fam]
        if not any(
            angle_diff(a.angle, b.angle) >= 90.0 - FAMILY_DIRECTION_TOL_DEG
            for i, a in enumerate(group)
            for b in group[i + 1 :]
        ):
            continue
        for g in group:
            g.family = "N" if _is_vertical(g) else "A"
    return lines


CROSSING_RULES = ("family", "direction")
DIRECTION_TOL_DEG = 10.0  # rule "direction": two grid lines within this of 90 degrees cross


def crossings(lines: list[GridLine], rule: str = "family") -> list[Crossing]:
    """Grid crossings. Rule "family" (the registered rule): a line whose label starts with a
    digit meets a line whose label does not. Rule "direction" (Phase 11 deviation, reported
    apart): any two grid lines whose directions are within DIRECTION_TOL_DEG of perpendicular;
    the crossing is named (more vertical line, more horizontal line)."""
    if rule not in CROSSING_RULES:
        raise ValueError(f"unknown crossing rule {rule!r}")
    if rule == "family":
        pairs = [(a, b) for a in lines if a.family == "N" for b in lines if b.family == "A"]
    else:
        pairs = []
        for i, a in enumerate(lines):
            for b in lines[i + 1 :]:
                if angle_diff(a.angle, b.angle) < 90.0 - DIRECTION_TOL_DEG:
                    continue
                va = angle_diff(a.angle, 90.0) <= angle_diff(b.angle, 90.0)
                pairs.append((a, b) if va else (b, a))
    out: list[Crossing] = []
    for a, b in pairs:
        hit = seg_intersection(a.p0, a.p1, b.p0, b.p1, GRID_EXTEND_PT, GRID_EXTEND_PT)
        if hit is None:
            continue
        length = math.dist(a.p0, a.p1)
        t = hit[0] / length
        p = (a.p0[0] + t * (a.p1[0] - a.p0[0]), a.p0[1] + t * (a.p1[1] - a.p0[1]))
        out.append(Crossing(p, a.label, b.label))
    return out
