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

Phase 12b rule "joist_label": a text line holding a joist designation (depth + K / KCS / LH / DLH +
number, e.g. 30K7, 24KCS4, 28LH10, 40DLH15; or a joist girder, depth + G + panels + N + load + K,
e.g. 24G8N8K) and no profile is a label of kind "joist". A piece whose attached label (on the piece,
or nearest) is a joist label is a joist: size state "joist", no size (a joist never takes a W or
HSS size).
Phase 12b rules "column_label_leader" and "typical_column_size" (columns only; joist labels and
sizes of other families never go to a column; column families COLUMN_FAMILIES): a column takes the
nearest column label within COLUMN_LABEL_MAX_PT as before; else a label whose leader (one segment
with one end within LEADER_LABEL_PT of the label's box and the other within LEADER_COLUMN_PT of the
column's box) ends at it ("sized", rule leader). Then each label with TYP / TYPICAL gives its size
to every unsized column with the same glyph signature as a column it is attached to; a TYP label
attached to no column gives its size to every unsized column when all the view's columns share one
signature ("inferred", rule typical_note, so the column needs review).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from src.build.geom import Pt, angle_deg, angle_diff, point_seg_dist, project
from src.build.segments import TextLine
from src.text_layer.parsers.profile import find_profiles
from src.text_layer.parsers.studs_camber import find_camber, find_studs

PARALLEL_DEG = 10.0
LABEL_PERP_MAX_PT = 36.0
INFER_MAX_PT = 48.0
COLUMN_LABEL_MAX_PT = 60.0
LEADER_LABEL_PT = 6.0
LEADER_COLUMN_PT = 8.0
LEADER_MIN_PT = 6.0
COLUMN_FAMILIES = ("W", "HSS", "HP", "PIPE", "S", "M")
JOIST_RE = re.compile(
    r"(?<![A-Za-z0-9./-])\d{1,3}\s*-?\s*(?:(?:KCS|DLH|LH|K)\s*-?\s*\d{1,2}"
    r"|G\s*\d{1,2}\s*N\s*[\d.]+\s*K)(?![A-Za-z0-9])",
    re.IGNORECASE,
)
TYPICAL_RE = re.compile(r"\bTYP(?:ICAL)?\b\.?", re.IGNORECASE)
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
    family: str | None = None  # the profile family (W, HSS, ...) of a profile label

    @property
    def typical(self) -> bool:
        return bool(TYPICAL_RE.search(self.text.text))


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
            out.append(
                Label(t, "profile", p.raw, p.canonical, None, sk[0], sk[1], *ck, family=p.family)
            )
            continue
        joist = JOIST_RE.search(t.text)
        if joist:
            raw = re.sub(r"\s+", "", joist.group(0)).upper()
            out.append(Label(t, "joist", raw, None, None, None, None, None, None))
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
            if labels[li].kind == "joist":
                out.append(Attached("joist", "joist_label", labels[li], perp))
                continue
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
        elif labels[best[1]].kind == "joist":
            out.append(Attached("joist", "joist_label", labels[best[1]], best[0]))
        else:
            out.append(Attached("inferred", "nearest_any", labels[best[1]], best[0]))
    return out


def _box_dist(p: Pt, box: tuple[float, float, float, float]) -> float:
    dx = max(box[0] - p[0], 0.0, p[0] - box[2])
    dy = max(box[1] - p[1], 0.0, p[1] - box[3])
    return math.hypot(dx, dy)


def is_column_label(lb: Label) -> bool:
    return lb.kind == "mark" or (lb.kind == "profile" and lb.family in COLUMN_FAMILIES)


def attach_to_columns(
    points: list[Pt],
    labels: list[Label],
    boxes: list[tuple[float, float, float, float]] | None = None,
    segments: list[tuple[float, float, float, float]] | None = None,
    signatures: list[object] | None = None,
) -> list[Attached]:
    """Column sizes (module note): nearest column label, then a leader, then TYP notes. `boxes`,
    `segments` and `signatures` are optional (without them only the nearest rule runs)."""
    idx = [i for i, lb in enumerate(labels) if is_column_label(lb)]
    centres = [labels[i].text.centre for i in idx]
    cells = _cells(centres)
    out: list[Attached] = []
    for p in points:
        best = None
        for k in _near(cells, p, p, COLUMN_LABEL_MAX_PT):
            d = math.dist(centres[k], p)
            if d <= COLUMN_LABEL_MAX_PT and (best is None or (d, k) < best):
                best = (d, k)
        if best is None:
            out.append(Attached("undefined", None, None, None))
        else:
            out.append(Attached("sized", "nearest_to_column", labels[idx[best[1]]], best[0]))
    if boxes is not None and segments:
        _leaders(out, labels, idx, boxes, segments)
    if signatures is not None:
        _typical(out, labels, idx, signatures)
    return out


def _leaders(out, labels, idx, boxes, segments) -> None:
    """Rule "column_label_leader": a segment from a label's box to an unsized column's box."""
    for ci, box in enumerate(boxes):
        if out[ci].size_state != "undefined":
            continue
        best = None
        for x0, y0, x1, y1 in segments:
            if math.hypot(x1 - x0, y1 - y0) < LEADER_MIN_PT:
                continue
            for a, b in (((x0, y0), (x1, y1)), ((x1, y1), (x0, y0))):
                if _box_dist(b, box) > LEADER_COLUMN_PT:
                    continue
                for i in idx:
                    d = _box_dist(a, labels[i].text.box)
                    if d <= LEADER_LABEL_PT and (best is None or (d, i) < best):
                        best = (d, i)
        if best is not None:
            out[ci] = Attached("sized", "leader", labels[best[1]], best[0])


def _typical(out, labels, idx, signatures) -> None:
    """Rule "typical_column_size": a TYP label's size goes to the unsized columns of its glyph
    signature (or of the only signature when it is attached to no column)."""
    typ = [i for i in idx if labels[i].typical]
    if not typ:
        return
    by_label: dict[int, set] = {}
    for ci, a in enumerate(out):
        if a.label is not None and a.rule != "typical_note":
            for i in typ:
                if labels[i] is a.label:
                    by_label.setdefault(i, set()).add(signatures[ci])
    sigs = set(signatures)
    for i in typ:
        targets = by_label.get(i) or (sigs if len(sigs) == 1 else set())
        for ci, a in enumerate(out):
            if a.size_state == "undefined" and signatures[ci] in targets:
                out[ci] = Attached("inferred", "typical_note", labels[i], None)
