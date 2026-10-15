"""Step 8: attach size, <studs> and C= camber to the pieces, after the pieces exist.

Labels come from the text lines of the page: a line with a profile (text_layer/parsers/profile.py,
the first profile of the line) or a line that is exactly a mark with one legend designation
(legend_rows). Studs and camber are read from the same text line (parsers/studs_camber.py).

Rule, per label: the label goes to ONE piece, the piece it is parallel to (directions within
PARALLEL_DEG) whose length its centre projects onto, nearest by perpendicular distance (at most
LABEL_PERP_MAX_PT), ties by the distance along the piece from its middle. A piece with such a label
is "sized" (rule parallel_on_piece, or legend_mark when the label is a mark). A piece without one
takes the nearest label in any direction within INFER_MAX_PT: "inferred" (rule nearest_any). Else
"undefined": the piece is kept, with no size.
Columns: the nearest label within COLUMN_LABEL_MAX_PT of the column centre ("sized", rule
nearest_to_column), else undefined.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from src.build.geom import Pt, angle_deg, angle_diff, point_seg_dist, project
from src.build.segments import TextLine
from src.text_layer.parsers.profile import find_profiles
from src.text_layer.parsers.studs_camber import find_camber, find_studs

PARALLEL_DEG = 10.0
LABEL_PERP_MAX_PT = 36.0
INFER_MAX_PT = 48.0
COLUMN_LABEL_MAX_PT = 60.0
CELL = 100.0


@dataclass
class Label:
    text: TextLine
    kind: str  # profile or mark
    raw: str  # the size as written (for a mark: the legend designation)
    canonical: str | None
    mark: str | None
    studs: int | None
    studs_raw: str | None
    camber_raw: str | None
    camber_mm: float | None


@dataclass
class Attached:
    size_state: str  # sized, inferred, undefined
    rule: str | None
    label: Label | None
    distance_pt: float | None

    def evidence(self) -> dict:
        if self.label is None:
            return {"size": {"state": self.size_state, "rule": None}}
        lb = self.label
        return {
            "size": {
                "state": self.size_state,
                "rule": self.rule,
                "kind": lb.kind,
                "distance_pt": None if self.distance_pt is None else round(self.distance_pt, 1),
                "box": [round(v, 1) for v in lb.text.box],
            },
            "studs": None if lb.studs is None else {"raw": lb.studs_raw, "count": lb.studs},
            "camber": None if lb.camber_raw is None else {"raw": lb.camber_raw},
        }


def find_labels(
    text: list[TextLine], legend: dict[str, list[tuple[str, str | None]]]
) -> list[Label]:
    """`legend`: mark -> [(designation as written, canonical profile or None)]."""
    out: list[Label] = []
    for t in text:
        studs, camber = find_studs(t.text), find_camber(t.text)
        sk = (studs.count, studs.raw) if studs else (None, None)
        ck = (camber.raw, camber.mm) if camber else (None, None)
        profiles = find_profiles(t.text)
        if profiles:
            p = profiles[0]
            out.append(Label(t, "profile", p.raw, p.canonical, None, sk[0], sk[1], *ck))
            continue
        token = t.text.strip()
        rows = legend.get(token)
        if rows and len({canon or raw for raw, canon in rows}) == 1:
            raw, canon = rows[0]
            out.append(Label(t, "mark", raw, canon, token, sk[0], sk[1], *ck))
    return out


def _cells(points: list[Pt]) -> dict[tuple[int, int], list[int]]:
    g: dict[tuple[int, int], list[int]] = {}
    for i, p in enumerate(points):
        g.setdefault((int(p[0] // CELL), int(p[1] // CELL)), []).append(i)
    return g


def _near(cells, a: Pt, b: Pt, pad: float) -> list[int]:
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = sorted((a[1], b[1]))
    out = []
    for gx in range(int((x0 - pad) // CELL), int((x1 + pad) // CELL) + 1):
        for gy in range(int((y0 - pad) // CELL), int((y1 + pad) // CELL) + 1):
            out.extend(cells.get((gx, gy), ()))
    return sorted(out)


def attach_to_pieces(pieces: list[tuple[Pt, Pt]], labels: list[Label]) -> list[Attached]:
    centres = [lb.text.centre for lb in labels]
    cells = _cells(centres)
    best_of_label: dict[int, tuple[float, float, int]] = {}
    for pi, (a, b) in enumerate(pieces):
        length = math.dist(a, b)
        ang = angle_deg(a, b)
        for li in _near(cells, a, b, LABEL_PERP_MAX_PT):
            lb = labels[li]
            if angle_diff(lb.text.angle_deg, ang) > PARALLEL_DEG:
                continue
            along, perp = project(centres[li], a, b)
            if not 0.0 <= along <= length or perp > LABEL_PERP_MAX_PT:
                continue
            key = (perp, abs(along - length / 2), pi)
            if li not in best_of_label or key < best_of_label[li]:
                best_of_label[li] = key
    on_piece: dict[int, tuple[float, int]] = {}
    for li, (perp, _, pi) in best_of_label.items():
        if pi not in on_piece or (perp, li) < on_piece[pi]:
            on_piece[pi] = (perp, li)
    out: list[Attached] = []
    for pi, (a, b) in enumerate(pieces):
        if pi in on_piece:
            perp, li = on_piece[pi]
            rule = "legend_mark" if labels[li].kind == "mark" else "parallel_on_piece"
            out.append(Attached("sized", rule, labels[li], perp))
            continue
        best = None
        for li in _near(cells, a, b, INFER_MAX_PT):
            d = point_seg_dist(centres[li], a, b)
            if d <= INFER_MAX_PT and (best is None or (d, li) < best):
                best = (d, li)
        if best is None:
            out.append(Attached("undefined", None, None, None))
        else:
            out.append(Attached("inferred", "nearest_any", labels[best[1]], best[0]))
    return out


def attach_to_columns(points: list[Pt], labels: list[Label]) -> list[Attached]:
    centres = [lb.text.centre for lb in labels]
    cells = _cells(centres)
    out = []
    for p in points:
        best = None
        for li in _near(cells, p, p, COLUMN_LABEL_MAX_PT):
            d = math.dist(centres[li], p)
            if d <= COLUMN_LABEL_MAX_PT and (best is None or (d, li) < best):
                best = (d, li)
        if best is None:
            out.append(Attached("undefined", None, None, None))
        else:
            out.append(Attached("sized", "nearest_to_column", labels[best[1]], best[0]))
    return out
