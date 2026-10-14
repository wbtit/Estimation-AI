"""Phase 7 pure helpers (pre-registered in docs/PHASE7_PREREGISTRATION.md).

Part B: distance from an estimator symbol to a piece's GEOMETRY (polyline, point or rectangle),
one-to-one matching (exact Hungarian: maximum number of matches within the radius first, then the
smallest total distance; the greedy rule of Phase 6b is kept for reconciliation), the two chance
controls, and the fixed development / held-out job split. No file or network access here.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence

import numpy as np

Pt = tuple[float, float]
RADII = (12.0, 24.0, 36.0)
BIG = 1.0e6

# ---- control constants (fixed in the pre-registration) -----------------------------------------
CONTROL_REPLICATES = 20
CONTROL_SEED_UNIFORM = 7100
CONTROL_SEED_DISPLACED = 7200
DISPLACE_MIN_PT = 60.0
DISPLACE_MAX_PT = 200.0

# ---- job split -----------------------------------------------------------------------------------
SPLIT_SEED = 7001
N_DEV_TOTAL = 10


# ---- geometry ------------------------------------------------------------------------------------
def poly_distances(xy: np.ndarray, pts: Sequence[Pt]) -> np.ndarray:
    """Distance from each point of `xy` (n x 2) to the polyline `pts` (at least one vertex)."""
    if len(pts) == 1:
        return np.hypot(xy[:, 0] - pts[0][0], xy[:, 1] - pts[0][1])
    best = np.full(len(xy), np.inf)
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:], strict=True):
        dx, dy = x1 - x0, y1 - y0
        l2 = dx * dx + dy * dy
        if l2 <= 1e-12:
            d = np.hypot(xy[:, 0] - x0, xy[:, 1] - y0)
        else:
            t = np.clip(((xy[:, 0] - x0) * dx + (xy[:, 1] - y0) * dy) / l2, 0.0, 1.0)
            d = np.hypot(xy[:, 0] - (x0 + t * dx), xy[:, 1] - (y0 + t * dy))
        best = np.minimum(best, d)
    return best


def rect_distances(xy: np.ndarray, r: Sequence[float]) -> np.ndarray:
    dx = np.maximum(np.maximum(r[0] - xy[:, 0], xy[:, 0] - r[2]), 0.0)
    dy = np.maximum(np.maximum(r[1] - xy[:, 1], xy[:, 1] - r[3]), 0.0)
    return np.hypot(dx, dy)


def geometry_distances(xy: np.ndarray, geom: dict) -> np.ndarray:
    """Distances from the symbols to one piece geometry: {"k": "poly"|"point"|"rect", ...}."""
    k = geom["k"]
    if k == "poly":
        return poly_distances(xy, [tuple(p) for p in geom["pts"]])
    if k == "point":
        return np.hypot(xy[:, 0] - geom["p"][0], xy[:, 1] - geom["p"][1])
    if k == "rect":
        return rect_distances(xy, geom["r"])
    raise ValueError(f"unknown geometry kind {k!r}")


def distance_matrix(symbols: Sequence[Pt], geoms: Sequence[dict]) -> np.ndarray:
    """(n symbols) x (m pieces) distances. Two-point polylines, rectangles and points are done in
    bulk; longer polylines one by one."""
    n, m = len(symbols), len(geoms)
    out = np.full((n, m), np.inf)
    if n == 0 or m == 0:
        return out
    xy = np.asarray(symbols, dtype=float)
    seg_cols = [j for j, g in enumerate(geoms) if g["k"] == "poly" and len(g["pts"]) == 2]
    rect_cols = [j for j, g in enumerate(geoms) if g["k"] == "rect"]
    pt_cols = [j for j, g in enumerate(geoms) if g["k"] == "point"]
    done = set(seg_cols) | set(rect_cols) | set(pt_cols)
    if seg_cols:
        segs = np.array([[*geoms[j]["pts"][0], *geoms[j]["pts"][1]] for j in seg_cols], dtype=float)
        out[:, seg_cols] = segment_matrix(xy, segs)
    if rect_cols:
        rects = np.array([geoms[j]["r"] for j in rect_cols], dtype=float)
        out[:, rect_cols] = rect_matrix(xy, rects)
    if pt_cols:
        pts = np.array([geoms[j]["p"] for j in pt_cols], dtype=float)
        out[:, pt_cols] = np.hypot(
            xy[:, 0][:, None] - pts[:, 0][None, :], xy[:, 1][:, None] - pts[:, 1][None, :]
        )
    for j in range(m):
        if j not in done:
            out[:, j] = geometry_distances(xy, geoms[j])
    return out


def rect_matrix(xy: np.ndarray, rects: np.ndarray) -> np.ndarray:
    """(n points) x (m rectangles) distances (0 inside); rects is m x 4 (x0, y0, x1, y1)."""
    px, py = xy[:, 0][:, None], xy[:, 1][:, None]
    dx = np.maximum(np.maximum(rects[:, 0][None, :] - px, px - rects[:, 2][None, :]), 0.0)
    dy = np.maximum(np.maximum(rects[:, 1][None, :] - py, py - rects[:, 3][None, :]), 0.0)
    return np.hypot(dx, dy)


def segment_matrix(xy: np.ndarray, segs: np.ndarray) -> np.ndarray:
    """(n points) x (m segments) distances in one go; segs is m x 4 (x0, y0, x1, y1)."""
    ax, ay, bx, by = (segs[:, k][None, :] for k in range(4))
    px, py = xy[:, 0][:, None], xy[:, 1][:, None]
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    safe = np.where(l2 <= 1e-12, 1.0, l2)
    t = np.where(l2 <= 1e-12, 0.0, np.clip(((px - ax) * dx + (py - ay) * dy) / safe, 0.0, 1.0))
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


# ---- matching ------------------------------------------------------------------------------------
def greedy_pairs(d: np.ndarray, radius: float) -> list[tuple[int, int, float]]:
    """Phase 6b rule: candidate pairs within the radius by ascending distance (ties: symbol, piece)."""
    si, pj = np.nonzero(d <= radius)
    pairs = sorted((float(d[i, j]), int(i), int(j)) for i, j in zip(si, pj, strict=True))
    used_s: set[int] = set()
    used_p: set[int] = set()
    out = []
    for dist, i, j in pairs:
        if i in used_s or j in used_p:
            continue
        used_s.add(i)
        used_p.add(j)
        out.append((i, j, dist))
    return out


def _assign(cost: np.ndarray) -> list[int]:
    """Minimum-cost assignment of every row to a distinct column (rows <= columns)."""
    n, m = cost.shape
    u = np.zeros(n + 1)
    v = np.zeros(m + 1)
    p = np.zeros(m + 1, dtype=int)
    way = np.zeros(m + 1, dtype=int)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = np.full(m + 1, np.inf)
        used = np.zeros(m + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = p[j0]
            cur = cost[i0 - 1, :] - u[i0] - v[1:]
            free = ~used[1:]
            upd = free & (cur < minv[1:])
            minv[1:][upd] = cur[upd]
            way[1:][upd] = j0
            masked = np.where(free, minv[1:], np.inf)
            j1 = int(np.argmin(masked)) + 1
            delta = masked[j1 - 1]
            idx = np.nonzero(used)[0]
            u[p[idx]] += delta
            v[idx] -= delta
            minv[~used] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    assign = [-1] * n
    for j in range(1, m + 1):
        if p[j] != 0:
            assign[p[j] - 1] = j - 1
    return assign


def hungarian_pairs(d: np.ndarray, radius: float) -> list[tuple[int, int, float]]:
    """One-to-one matching with the largest possible number of pairs within the radius, and among
    those the smallest total distance. Solved per connected component of the feasibility graph."""
    n, m = d.shape
    if n == 0 or m == 0:
        return []
    si, pj = np.nonzero(d <= radius)
    if len(si) == 0:
        return []
    parent = list(range(n + m))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i, j in zip(si, pj, strict=True):
        ra, rb = find(int(i)), find(n + int(j))
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    comps: dict[int, tuple[list[int], list[int]]] = {}
    for i in sorted(set(int(a) for a in si)):
        comps.setdefault(find(i), ([], []))[0].append(i)
    for j in sorted(set(int(b) for b in pj)):
        comps.setdefault(find(n + j), ([], []))[1].append(j)
    out: list[tuple[int, int, float]] = []
    for rows, cols in (comps[k] for k in sorted(comps)):
        sub = d[np.ix_(rows, cols)]
        cost = np.where(sub <= radius, sub, BIG)
        transpose = len(rows) > len(cols)
        mat = cost.T if transpose else cost
        assign = _assign(mat)
        for a, b in enumerate(assign):
            if b < 0:
                continue
            ri, cj = (b, a) if transpose else (a, b)
            if sub[ri, cj] <= radius:
                out.append((rows[ri], cols[cj], float(sub[ri, cj])))
    out.sort()
    return out


def prf(
    matched: int, n_pieces: int, n_syms: int
) -> tuple[float | None, float | None, float | None]:
    p = None if n_pieces == 0 else matched / n_pieces
    r = None if n_syms == 0 else matched / n_syms
    if p is None or r is None or p + r == 0:
        return p, r, None
    return p, r, 2 * p * r / (p + r)


# ---- chance controls -----------------------------------------------------------------------------
def uniform_points(box: tuple[float, float, float, float], n: int, rng: random.Random) -> list[Pt]:
    """n points uniform in the page's view box."""
    return [(rng.uniform(box[0], box[2]), rng.uniform(box[1], box[3])) for _ in range(n)]


def displaced_points(
    symbols: Sequence[Pt], box: tuple[float, float, float, float], rng: random.Random
) -> list[Pt]:
    """Each symbol moved by a random vector of length 60 to 200 pt in a random direction; a point
    that leaves the view box is moved back onto its edge. Keeps the layout and density, breaks the
    alignment with our geometry."""
    out = []
    for x, y in symbols:
        ang = rng.uniform(0.0, 2.0 * math.pi)
        r = rng.uniform(DISPLACE_MIN_PT, DISPLACE_MAX_PT)
        nx = min(max(x + r * math.cos(ang), box[0]), box[2])
        ny = min(max(y + r * math.sin(ang), box[1]), box[3])
        out.append((nx, ny))
    return out


# ---- job split -----------------------------------------------------------------------------------
def split_jobs(symbols_per_job: dict[str, int], seed: int = SPLIT_SEED) -> dict[str, str]:
    """job -> 'dev' | 'held-out'. The two jobs with the most symbols go to different sides (which
    one goes where is drawn); the others are shuffled and the first N_DEV_TOTAL - 1 go to dev, so
    dev has N_DEV_TOTAL jobs in all (with 16 jobs: 10 dev, 6 held-out)."""
    rng = random.Random(seed)
    ranked = sorted(symbols_per_job, key=lambda j: (-symbols_per_job[j], j))
    first, second = ranked[0], ranked[1]
    big_dev, big_held = (first, second) if rng.random() < 0.5 else (second, first)
    rest = sorted(ranked[2:])
    rng.shuffle(rest)
    dev = [big_dev, *rest[: N_DEV_TOTAL - 1]]
    held = [big_held, *rest[N_DEV_TOTAL - 1 :]]
    return {**{j: "dev" for j in dev}, **{j: "held-out" for j in held}}
