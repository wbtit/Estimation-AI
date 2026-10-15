"""Small plane geometry for the build, in displayed page points (y down). Pure."""

from __future__ import annotations

import math

Pt = tuple[float, float]
Box = tuple[float, float, float, float]


def dist(a: Pt, b: Pt) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def angle_deg(a: Pt, b: Pt) -> float:
    """Direction of a line in [0, 180)."""
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def angle_diff(a: float, b: float) -> float:
    """Difference of two line directions in degrees, in [0, 90]."""
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def point_seg_dist(p: Pt, a: Pt, b: Pt) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 <= 1e-12:
        return dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def project(p: Pt, a: Pt, b: Pt) -> tuple[float, float]:
    """(along, perpendicular) of p on the line a->b, in pt; along 0 at a, perpendicular unsigned."""
    length = dist(a, b)
    if length <= 1e-12:
        return 0.0, dist(p, a)
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    vx, vy = p[0] - a[0], p[1] - a[1]
    return vx * ux + vy * uy, abs(-vx * uy + vy * ux)


def point_at(a: Pt, b: Pt, s: float) -> Pt:
    length = dist(a, b)
    if length <= 1e-12:
        return a
    return (a[0] + (b[0] - a[0]) * s / length, a[1] + (b[1] - a[1]) * s / length)


def seg_intersection(a0: Pt, a1: Pt, b0: Pt, b1: Pt, ext_a: float = 0.0, ext_b: float = 0.0):
    """Intersection of two segments, each extended by ext pt at both ends: (s on a, s on b) in pt
    from the first end, or None when parallel or they miss."""
    ax, ay = a1[0] - a0[0], a1[1] - a0[1]
    bx, by = b1[0] - b0[0], b1[1] - b0[1]
    la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    if la < 1e-9 or lb < 1e-9:
        return None
    den = ax * by - ay * bx
    if abs(den) < 1e-9 * la * lb:
        return None
    t = ((b0[0] - a0[0]) * by - (b0[1] - a0[1]) * bx) / den
    u = ((b0[0] - a0[0]) * ay - (b0[1] - a0[1]) * ax) / den
    sa, sb = t * la, u * lb
    if -ext_a <= sa <= la + ext_a and -ext_b <= sb <= lb + ext_b:
        return sa, sb
    return None


def in_box(p: Pt, box: Box) -> bool:
    return box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]


def box_dist(p: Pt, box: Box) -> float:
    dx = max(box[0] - p[0], 0.0, p[0] - box[2])
    dy = max(box[1] - p[1], 0.0, p[1] - box[3])
    return math.hypot(dx, dy)


def clip_segment(a: Pt, b: Pt, box: Box) -> tuple[Pt, Pt] | None:
    """The part of a->b inside the box (Liang-Barsky), or None."""
    x0, y0 = a
    dx, dy = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, x0 - box[0]),
        (dx, box[2] - x0),
        (-dy, y0 - box[1]),
        (dy, box[3] - y0),
    ):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
        if t0 > t1:
            return None
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def inside_polygon(x: float, y: float, pts: list[Pt]) -> bool:
    inside = False
    n = len(pts)
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def bezier_points(p1: Pt, c1: Pt, c2: Pt, p2: Pt, n: int) -> list[Pt]:
    out = []
    for k in range(n + 1):
        t = k / n
        u = 1 - t
        out.append(
            (
                u**3 * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p2[0],
                u**3 * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p2[1],
            )
        )
    return out
