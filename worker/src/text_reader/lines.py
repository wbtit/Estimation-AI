"""Assemble character clusters into text lines (Phase 4a rules, see rules.py)."""

from collections import defaultdict
from dataclasses import dataclass, field

from src.text_reader import rules
from src.text_reader.strokes import Cluster


@dataclass
class Line:
    orientation: str  # "horizontal" | "vertical"
    members: list[Cluster]  # character-like clusters, in reading order
    marks: list[Cluster] = field(default_factory=list)  # small clusters attached to the line

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        all_c = self.members + self.marks
        return (
            min(c.x0 for c in all_c),
            min(c.y0 for c in all_c),
            max(c.x1 for c in all_c),
            max(c.y1 for c in all_c),
        )


def _components(items: list[Cluster], adjacent) -> list[list[int]]:
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = 24.0
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(items):
        grid[(int(c.cx // cell), int(c.cy // cell))].append(i)
    for i, c in enumerate(items):
        gx, gy = int(c.cx // cell), int(c.cy // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), []):
                    if j > i and adjacent(c, items[j]):
                        parent[find(i)] = find(j)
    comp: dict[int, list[int]] = defaultdict(list)
    for i in range(len(items)):
        comp[find(i)].append(i)
    return list(comp.values())


def _hadj(a: Cluster, b: Cluster) -> bool:
    h = max(a.h, b.h)
    gap = max(a.x0, b.x0) - min(a.x1, b.x1)
    return (
        abs(a.cy - b.cy) <= rules.LINE_CENTRE_TOL * h
        and rules.LINE_GAP_MIN_PT <= gap <= rules.LINE_GAP_MAX_H * h
    )


def _vadj(a: Cluster, b: Cluster) -> bool:
    w = max(a.w, b.w)
    gap = max(a.y0, b.y0) - min(a.y1, b.y1)
    return (
        abs(a.cx - b.cx) <= rules.LINE_CENTRE_TOL * w
        and rules.LINE_GAP_MIN_PT <= gap <= rules.LINE_GAP_MAX_H * w
    )


def is_char_like(c: Cluster) -> bool:
    return max(c.w, c.h) >= rules.CHAR_MIN_PT and min(c.w, c.h) < rules.CHAR_MAX_MIN_DIM_PT


def assemble(clusters: list[Cluster]) -> tuple[list[Line], list[Line], int]:
    """(horizontal lines, vertical lines, number of character-like clusters left unassigned)."""
    chars = [c for c in clusters if is_char_like(c)]
    small = [c for c in clusters if not is_char_like(c)]
    hcomp = _components(chars, _hadj)
    vcomp = _components(chars, _vadj)
    hsize = {i: len(comp) for comp in hcomp for i in comp}
    vsize = {i: len(comp) for comp in vcomp for i in comp}

    def horizontal(i: int) -> bool:
        return hsize[i] >= rules.MIN_LINE_CHARS and hsize[i] >= vsize[i]

    def vertical(i: int) -> bool:
        return vsize[i] >= rules.MIN_LINE_CHARS and vsize[i] > hsize[i]

    hlines = [
        Line("horizontal", sorted((chars[i] for i in comp), key=lambda c: c.x0))
        for comp in hcomp
        if len(comp) >= rules.MIN_LINE_CHARS and all(horizontal(i) for i in comp)
    ]
    vlines = [
        Line("vertical", sorted((chars[i] for i in comp), key=lambda c: c.y0))
        for comp in vcomp
        if len(comp) >= rules.MIN_LINE_CHARS and all(vertical(i) for i in comp)
    ]
    used = sum(len(line.members) for line in hlines) + sum(len(line.members) for line in vlines)

    # Attach small clusters (dots, ticks) to the nearest horizontal line they sit against.
    for c in small:
        best: Line | None = None
        best_d = float("inf")
        for line in hlines:
            x0, y0, x1, y1 = line.bbox
            r = _typical_height(line)
            gap = max(x0 - c.x1, c.x0 - x1, 0.0)
            if (
                gap <= rules.ATTACH_GAP_R * r
                and y0 - rules.ATTACH_VERT_R * r <= c.cy <= y1 + rules.ATTACH_VERT_R * r
                and gap < best_d
            ):
                best, best_d = line, gap
        if best is not None:
            best.marks.append(c)
    return hlines, vlines, len(chars) - used


def _typical_height(line: Line) -> float:
    hs = sorted(c.h for c in line.members if c.h > rules.CHAR_MIN_PT)
    if not hs:
        hs = sorted(c.h for c in line.members) or [1.0]
    return hs[len(hs) // 2] if len(hs) % 2 else (hs[len(hs) // 2 - 1] + hs[len(hs) // 2]) / 2


typical_height = _typical_height
