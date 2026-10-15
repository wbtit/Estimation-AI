"""Collinear chaining of segments across gaps (port of chain_segments in the Phase 7 grammar).

Segments are grouped by direction (clusters no wider than `angle_deg`, cut at ANGLE_CUT_DEG so
horizontal lines do not wrap), then by perpendicular offset (runs no wider than `offset_pt`), then
joined along the axis while the gap to the next piece is at most `gap_max`; each joined piece must
stay within `offset_pt` of the first piece's line. Every chain keeps its segment ids and the gaps it
bridged. Deterministic (stable sorts).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from src.build.geom import Pt

ANGLE_CUT_DEG = 22.5
GAP_REPORT_MIN_PT = 0.5  # gaps smaller than this are touching pieces, not bridged gaps


@dataclass
class Chain:
    seg_ids: list[int]
    p0: Pt
    p1: Pt
    gaps: list[float]  # bridged gaps along the chain, pt (only those above GAP_REPORT_MIN_PT)

    @property
    def length(self) -> float:
        return math.hypot(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])


def _runs(values: np.ndarray, tol: float) -> list[list[int]]:
    order = np.argsort(values, kind="stable")
    runs: list[list[int]] = []
    last = None
    for o in order:
        if last is None or values[o] - last > tol:
            runs.append([])
        runs[-1].append(int(o))
        last = values[o]
    return runs


def chain_segments(
    seg: np.ndarray, idx: list[int], gap_max: float, angle_deg: float, offset_pt: float
) -> list[Chain]:
    if not idx:
        return []
    s = seg[idx]
    theta = np.degrees(np.arctan2(s[:, 3] - s[:, 1], s[:, 2] - s[:, 0])) % 180.0
    theta = (theta - ANGLE_CUT_DEG) % 180.0 + ANGLE_CUT_DEG
    order = np.argsort(theta, kind="stable")
    clusters: list[list[int]] = []
    anchor = None
    for k in order:
        if anchor is None or theta[k] - anchor > angle_deg:
            clusters.append([])
            anchor = theta[k]
        clusters[-1].append(int(k))
    out: list[Chain] = []
    for cl in clusters:
        th = math.radians(float(np.mean(theta[cl])))
        ux, uy = math.cos(th), math.sin(th)
        a = s[cl]
        flip = (a[:, 2] - a[:, 0]) * ux + (a[:, 3] - a[:, 1]) * uy < 0
        x0 = np.where(flip, a[:, 2], a[:, 0])
        y0 = np.where(flip, a[:, 3], a[:, 1])
        x1 = np.where(flip, a[:, 0], a[:, 2])
        y1 = np.where(flip, a[:, 1], a[:, 3])
        rho = -((x0 + x1) / 2) * uy + ((y0 + y1) / 2) * ux
        for sub in _runs(rho, offset_pt):
            sub_idx = np.asarray(sub)
            s0 = x0[sub_idx] * ux + y0[sub_idx] * uy
            s1 = x1[sub_idx] * ux + y1[sub_idx] * uy
            cur: list[int] = []
            gaps: list[float] = []
            cur_end = -math.inf
            ref = None
            for o in np.argsort(s0, kind="stable"):
                k = int(sub_idx[o])
                ok = False
                if ref is not None:
                    (r0x, r0y), rux, ruy = ref

                    def off(px: float, py: float, r0x=r0x, r0y=r0y, rux=rux, ruy=ruy) -> float:
                        return abs(-(px - r0x) * ruy + (py - r0y) * rux)

                    ok = (
                        s0[o] - cur_end <= gap_max
                        and off(x0[k], y0[k]) <= offset_pt
                        and off(x1[k], y1[k]) <= offset_pt
                    )
                if not ok:
                    if cur:
                        out.append(_finish(cur, gaps, cl, idx, x0, y0, x1, y1, ux, uy))
                    cur, gaps, cur_end, ref = [], [], -math.inf, None
                else:
                    gap = float(s0[o] - cur_end)
                    if gap > GAP_REPORT_MIN_PT:
                        gaps.append(round(gap, 2))
                cur.append(k)
                if ref is None:
                    ln = math.hypot(x1[k] - x0[k], y1[k] - y0[k]) or 1.0
                    ref = (
                        (float(x0[k]), float(y0[k])),
                        float((x1[k] - x0[k]) / ln) if ln > 1e-9 else ux,
                        float((y1[k] - y0[k]) / ln) if ln > 1e-9 else uy,
                    )
                cur_end = max(cur_end, float(s1[o]))
            if cur:
                out.append(_finish(cur, gaps, cl, idx, x0, y0, x1, y1, ux, uy))
    return out


def _finish(cur, gaps, cl, idx, x0, y0, x1, y1, ux, uy) -> Chain:
    pts = []
    for k in cur:
        pts.append((float(x0[k]), float(y0[k])))
        pts.append((float(x1[k]), float(y1[k])))
    lo = min(pts, key=lambda p: (p[0] * ux + p[1] * uy, p))
    hi = max(pts, key=lambda p: (p[0] * ux + p[1] * uy, p))
    return Chain(sorted(idx[cl[k]] for k in cur), lo, hi, gaps)
