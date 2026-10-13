"""Phase 6c post-hoc control (NOT pre-registered): how close is a RANDOM point to an extracted line?

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_control

For every page of the census, 5 x (their symbol count) uniform random points inside the
whole-sheet box (fixed seed), distance to the nearest extracted line of any class and of the
suggested class. Pooled with the same page weights as the symbols, so it can be set beside the
shares of their symbols. Reported as post hoc in the results.
"""

from __future__ import annotations

import json
import random

import numpy as np
import pymupdf

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

SEED = 6004
PER_SYMBOL = 5
RADII = (6.0, 12.0, 24.0)


def nearest(segs: np.ndarray, pts: np.ndarray) -> np.ndarray:
    out = np.full(len(pts), 1e9)
    if len(segs) == 0:
        return out
    ax, ay, bx, by = segs[:, 0], segs[:, 1], segs[:, 2], segs[:, 3]
    dx, dy = bx - ax, by - ay
    l2 = np.maximum(dx * dx + dy * dy, 1e-9)
    for i, (x, y) in enumerate(pts):
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1)
        out[i] = np.hypot(x - (ax + t * dx), y - (ay + t * dy)).min()
    return out


def main() -> dict:
    data = json.loads((TAKEOFFS / "phase6c_census.json").read_text())
    runs = json.loads(RUNS.read_text())
    conn = connect()
    docs: dict = {}
    rng = random.Random(SEED)
    any_d: list[float] = []
    sug_d: list[float] = []
    sym_any: list[float] = []
    for p in data["pages"]:
        job = p["job"]
        if job not in docs:
            docs[job] = pymupdf.open(stored_pdf(conn, runs[job]["project_id"]))
        page = docs[job][p["dp"]]
        size = (page.rect.width, page.rect.height)
        b = whole_sheet_box(*size)
        box = (b["x0"], b["y0"], b["x1"], b["y1"])
        lines = page_lines(page)
        in_view = lines_in_box(lines, box, size)
        sug = suggest_classes(class_table(in_view))
        seg_a = (
            np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in lines]) if lines else np.zeros((0, 4))
        )
        structural = [ln for ln in in_view if ln.klass in sug]
        seg_s = (
            np.array([[ln.x0, ln.y0, ln.x1, ln.y1] for ln in structural])
            if structural
            else np.zeros((0, 4))
        )
        n = PER_SYMBOL * len(p["symbols"])
        pts = np.array(
            [(rng.uniform(box[0], box[2]), rng.uniform(box[1], box[3])) for _ in range(n)]
        )
        any_d += list(nearest(seg_a, pts))
        sug_d += list(nearest(seg_s, pts))
        for r in p["symbols"]:
            sym_any.append(1e9 if r["extracted_nearest"] is None else r["extracted_nearest"])
    out = {"random_points": len(any_d), "symbols": len(sym_any)}
    for r in RADII:
        out[f"random_any_within_{int(r)}"] = float(np.mean(np.array(any_d) <= r))
        out[f"random_suggested_within_{int(r)}"] = float(np.mean(np.array(sug_d) <= r))
        out[f"symbols_any_within_{int(r)}"] = float(np.mean(np.array(sym_any) <= r))
    (TAKEOFFS / "phase6c_control.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    print(json.dumps(main(), indent=1))
