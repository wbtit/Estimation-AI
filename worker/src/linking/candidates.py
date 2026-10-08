"""Candidate member lines for a label: the K nearest structural lines (distance only).

Frozen generation parameters (Phase 4e): K = 6, radius 150 pt, minimum line length 12 pt.
"""

import math
from dataclasses import dataclass

import numpy as np

from src.linking.lines import Line

K_CANDIDATES = 6
RADIUS_PT = 150.0
MIN_LINE_PT = 12.0


@dataclass(frozen=True)
class Candidate:
    cand: int  # 1-based, nearest first
    line: Line
    dist: float  # label box to segment, pt
    rel_angle: float  # angle to the text baseline, 0..90 degrees


def rect_segment_distance(rect: tuple[float, float, float, float], lines: np.ndarray) -> np.ndarray:
    """Distance from an axis-aligned rect to each segment (rows x0 y0 x1 y1); 0 if they touch."""
    x0, y0, x1, y1 = rect
    d = np.full(len(lines), np.inf)
    ax, ay, bx, by = lines[:, 0], lines[:, 1], lines[:, 2], lines[:, 3]
    length = np.hypot(bx - ax, by - ay)
    steps = np.maximum(2, np.minimum(60, (length / 3).astype(int) + 2))
    for k in range(int(steps.max())):
        t = np.minimum(k / np.maximum(steps - 1, 1), 1.0)
        px, py = ax + t * (bx - ax), ay + t * (by - ay)
        dx = np.maximum(np.maximum(x0 - px, 0), px - x1)
        dy = np.maximum(np.maximum(y0 - py, 0), py - y1)
        d = np.minimum(d, np.hypot(dx, dy))
    return d


def candidates_for(
    label_bbox: tuple[float, float, float, float], angle_deg: float, structural: list[Line]
) -> list[Candidate]:
    lines = [ln for ln in structural if ln.length >= MIN_LINE_PT]
    if not lines:
        return []
    arr = np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in lines])
    d = rect_segment_distance(label_bbox, arr)
    order = [i for i in np.argsort(d, kind="stable") if d[i] <= RADIUS_PT][:K_CANDIDATES]
    theta = math.radians(angle_deg)
    base = (math.cos(theta), -math.sin(theta))  # text baseline on screen (y down)
    out = []
    for rank, i in enumerate(order, 1):
        ln = lines[i]
        lx, ly = ln.x1 - ln.x0, ln.y1 - ln.y0
        norm = math.hypot(lx, ly) or 1.0
        rel = math.degrees(math.acos(min(1.0, abs(lx * base[0] + ly * base[1]) / norm)))
        out.append(Candidate(rank, ln, float(d[i]), rel))
    return out
