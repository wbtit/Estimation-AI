"""Candidate member lines for a label, and leader-line detection (generation only: no choice here).

Candidates are the K nearest structural lines (by distance from the label box to the segment) within
a radius. Structural classes come from the per-document `structural_classes.json` (verified on
overlay images). Pre-registered generation parameters: K = 6, R = 150 pt, minimum line length 12 pt.
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import numpy as np  # noqa: E402

K_CANDIDATES = 6
RADIUS_PT = 150.0
MIN_LINE_PT = 12.0


def load_structural(job: str) -> dict[int, set[str]]:
    path = common.doc_dir(job) / "structural_classes.json"
    data = json.loads(path.read_text())
    return {int(k): set(v.get("structural", [])) for k, v in data.items()}


def page_lines(job: str, page: int) -> list[dict]:
    dump = json.loads((common.doc_dir(job) / f"page_{page}.json").read_text())
    out = []
    for x0, y0, x1, y1, w, col, layer, dashed, n in dump["lines"]:
        klass = f"{__import__('linework').width_bucket(w)}|{col}|{'dash' if dashed else 'solid'}"
        out.append({"p": (x0, y0), "q": (x1, y1), "width": w, "klass": klass, "layer": layer,
                    "dashed": bool(dashed), "length": math.hypot(x1 - x0, y1 - y0)})  # fmt: skip
    return out


def rect_segment_distance(rect: list[float], lines: np.ndarray) -> np.ndarray:
    """Distance from an axis-aligned rect to each segment (rows: x0 y0 x1 y1); 0 if they touch."""
    x0, y0, x1, y1 = rect
    n = len(lines)
    d = np.full(n, np.inf)
    # sample points along each segment densely enough for pt-level accuracy
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


def candidates_for(label: dict, structural_lines: list[dict]) -> list[dict]:
    if not structural_lines:
        return []
    arr = np.array([[ln["p"][0], ln["p"][1], ln["q"][0], ln["q"][1]] for ln in structural_lines])
    d = rect_segment_distance(label["bbox"], arr)
    order = [i for i in np.argsort(d) if d[i] <= RADIUS_PT][:K_CANDIDATES]
    bx0, by0, bx1, by1 = label["bbox"]
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    theta = math.radians(label["angle_deg"])
    base = (math.cos(theta), -math.sin(theta))  # text baseline direction on screen (y down)
    up = (-math.sin(theta), -math.cos(theta))  # perpendicular to the baseline, text-up on screen
    out = []
    for rank, i in enumerate(order, 1):
        ln = structural_lines[i]
        (px, py), (qx, qy) = ln["p"], ln["q"]
        lx, ly = qx - px, qy - py
        norm = math.hypot(lx, ly) or 1.0
        rel = math.degrees(math.acos(min(1.0, abs(lx * base[0] + ly * base[1]) / norm)))  # 0..90
        # side: which side of the line the label centre lies on, in the text frame
        nx, ny = -ly / norm, lx / norm
        offset = (cx - px) * nx + (cy - py) * ny
        n_up = nx * up[0] + ny * up[1]
        if d[i] < 1.0 or abs(n_up) < 0.5:
            side = 0  # touching, or the line is across the text baseline: no side
        else:
            side = 1 if offset * n_up > 0 else -1  # +1: label above the line
        out.append(
            {"cand": rank, "p": [round(px, 2), round(py, 2)], "q": [round(qx, 2), round(qy, 2)],
             "klass": ln["klass"], "dashed": ln["dashed"], "length": round(ln["length"], 1),
             "dist": round(float(d[i]), 2), "rel_angle": round(rel, 1), "side": side}
        )  # fmt: skip
    return out


def structural_lines_for(job: str, page: int, classes: set[str]) -> list[dict]:
    return [ln for ln in page_lines(job, page) if ln["klass"] in classes and ln["length"] >= MIN_LINE_PT]
