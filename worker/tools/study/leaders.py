"""Leader-line following (rule R4): from the label box along end-to-end connected lines to a candidate.

Registered parameters: snap in {3, 6} pt, maximum total chain length in {120, 250} pt, at most 3
segments. Lines considered are all reconstructed lines that are not candidates. An arrowhead (a small
filled triangle) within 8 pt of the far end widens the target test by 6 pt.
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import numpy as np  # noqa: E402

MAX_HOPS = 3
ARROW_NEAR = 8.0
ARROW_BONUS = 6.0


def _point_segment(px: float, py: float, a: tuple, b: tuple) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1.0)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _box_point(b: list[float], x: float, y: float) -> float:
    return math.hypot(max(b[0] - x, 0, x - b[2]), max(b[1] - y, 0, y - b[3]))


class PageIndex:
    def __init__(self, job: str, page: int):
        dump = json.loads((common.doc_dir(job) / f"page_{page}.json").read_text())
        self.lines = [
            {"p": (l[0], l[1]), "q": (l[2], l[3]), "length": math.hypot(l[2] - l[0], l[3] - l[1])}
            for l in dump["lines"]
        ]
        self.ends = np.array(
            [[ln["p"][0], ln["p"][1], ln["q"][0], ln["q"][1]] for ln in self.lines]
        )
        self.arrows = [
            ((s["bbox"][0] + s["bbox"][2]) / 2, (s["bbox"][1] + s["bbox"][3]) / 2)
            for s in dump["shapes"]
            if s["filled"] and 3 <= s["items"] <= 4 and max(s["bbox"][2] - s["bbox"][0], s["bbox"][3] - s["bbox"][1]) <= 14
        ]  # fmt: skip


def find_leader_target(
    idx: PageIndex, label_box: list[float], cands: list[dict], snap: float, max_len: float
) -> int | None:
    """Candidate number reached by a leader from the label, or None."""
    if not cands:
        return None
    cand_keys = {(tuple(c["p"]), tuple(c["q"])) for c in cands}

    def is_candidate(ln: dict) -> bool:
        return any(
            abs(ln["p"][0] - c[0][0]) < 0.05 and abs(ln["p"][1] - c[0][1]) < 0.05
            and abs(ln["q"][0] - c[1][0]) < 0.05 and abs(ln["q"][1] - c[1][1]) < 0.05
            for c in cand_keys
        )  # fmt: skip

    usable = [i for i, ln in enumerate(idx.lines) if not is_candidate(ln)]
    starts = []
    for i in usable:
        ln = idx.lines[i]
        for end, far in ((ln["p"], ln["q"]), (ln["q"], ln["p"])):
            if _box_point(label_box, *end) <= snap:
                starts.append((i, far, ln["length"]))
    best: tuple[float, int] | None = None
    for i0, far0, len0 in starts:
        used = {i0}
        far, total = far0, len0
        for _ in range(MAX_HOPS):
            if total > max_len:
                break
            bonus = (
                ARROW_BONUS
                if any(math.hypot(far[0] - ax, far[1] - ay) <= ARROW_NEAR for ax, ay in idx.arrows)
                else 0.0
            )
            hit = [
                (_point_segment(far[0], far[1], tuple(c["p"]), tuple(c["q"])), c["cand"])
                for c in cands
            ]
            hit = [h for h in hit if h[0] <= snap + bonus]
            if hit:
                d, n = min(hit)
                if best is None or total < best[0]:
                    best = (total, n)
                break
            nxt = None
            for j in usable:
                if j in used:
                    continue
                lj = idx.lines[j]
                for e, f in ((lj["p"], lj["q"]), (lj["q"], lj["p"])):
                    if math.hypot(e[0] - far[0], e[1] - far[1]) <= snap:
                        nxt = (j, f, lj["length"])
                        break
                if nxt:
                    break
            if not nxt:
                break
            used.add(nxt[0])
            far, total = nxt[1], total + nxt[2]
    return best[1] if best else None
