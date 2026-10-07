"""Stroke clusters of a page, in DISPLAYED coordinates (rotation applied).

PyMuPDF reports path coordinates in unrotated page space; every point is mapped through the
page's rotation matrix so that "right" and "up" are what a person sees.
"""

from collections import defaultdict
from dataclasses import dataclass

import pymupdf

from src.text_reader import rules
from src.text_reader.geometry import Strokes

BEZIER_SAMPLES = 6


@dataclass(frozen=True)
class Cluster:
    strokes: Strokes
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


def _bezier(p0, p1, p2, p3, n: int = BEZIER_SAMPLES):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t**2, t**3
        pts.append(
            (
                a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
            )
        )
    return pts


def _stroke_points(items, matrix: pymupdf.Matrix) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []

    def add(points):
        for p in points:
            q = pymupdf.Point(p) * matrix
            if not pts or (abs(pts[-1][0] - q.x) > 1e-9 or abs(pts[-1][1] - q.y) > 1e-9):
                pts.append((q.x, q.y))

    for it in items:
        kind = it[0]
        if kind == "l":
            add([it[1], it[2]])
        elif kind == "c":
            add(_bezier(it[1], it[2], it[3], it[4]))
        elif kind == "re":
            r = it[1]
            add([r.tl, r.tr, r.br, r.bl, r.tl])
        elif kind == "qu":
            q = it[1]
            add([q.ul, q.ur, q.lr, q.ll, q.ul])
    return pts


def _is_dark(colour) -> bool:
    return colour is None or sum(colour) / len(colour) < rules.DARK_MAX_MEAN_COLOUR


def extract_clusters(page: pymupdf.Page) -> list[Cluster]:
    """Character clusters: dark stroked paths up to MAX_STROKE_PT, merged where they touch."""
    matrix = page.rotation_matrix
    prims: list[tuple[list[tuple[float, float]], tuple[float, float, float, float]]] = []
    for d in page.get_drawings():
        if d["type"] != "s" or not _is_dark(d["color"]):
            continue
        pts = _stroke_points(d["items"], matrix)
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        box = (min(xs), min(ys), max(xs), max(ys))
        if max(box[2] - box[0], box[3] - box[1]) > rules.MAX_STROKE_PT:
            continue
        prims.append((pts, box))

    eps = rules.CLUSTER_EPS_PT
    parent = list(range(len(prims)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = 8.0
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (_, b) in enumerate(prims):
        for gx in range(int((b[0] - eps) // cell), int((b[2] + eps) // cell) + 1):
            for gy in range(int((b[1] - eps) // cell), int((b[3] + eps) // cell) + 1):
                grid[(gx, gy)].append(i)
    for ids in grid.values():
        for a in range(len(ids)):
            for c in range(a + 1, len(ids)):
                i, j = ids[a], ids[c]
                A, B = prims[i][1], prims[j][1]
                if (
                    A[0] - eps <= B[2]
                    and B[0] - eps <= A[2]
                    and A[1] - eps <= B[3]
                    and B[1] - eps <= A[3]
                ):
                    parent[find(i)] = find(j)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(prims)):
        groups[find(i)].append(i)
    clusters = []
    for members in groups.values():
        strokes = [prims[i][0] for i in members]
        boxes = [prims[i][1] for i in members]
        clusters.append(
            Cluster(
                strokes=strokes,
                x0=min(b[0] for b in boxes),
                y0=min(b[1] for b in boxes),
                x1=max(b[2] for b in boxes),
                y1=max(b[3] for b in boxes),
            )
        )
    clusters.sort(key=lambda c: (round(c.y0, 3), round(c.x0, 3)))
    return clusters
