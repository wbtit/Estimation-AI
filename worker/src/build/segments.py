"""Step 2: the vector content of a page inside the crop (port of tools/takeoff/phase7_parse.py).

Every drawing path becomes `Shape`s (connected pieces, open or closed, curves sampled) and its
straight pieces become rows of a segment table with width, colour class and the PDF dash flag.
Filled thin rectangles (short side at most 6 pt, aspect at least 8) are segments too, of width =
short side, as in src/linking/lines.py. Coordinates are DISPLAYED page points (rotation applied).
The pen class of a segment uses the same width buckets and colour classes as the line classes a
person confirms (src/linking/lines.py), so a confirmed class selects the same pens here.
Pure, apart from reading the page it is given.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np
import pymupdf

from src.build.geom import Box, Pt, bezier_points, clip_segment
from src.linking.lines import colour_class, width_bucket

CURVE_SAMPLES = 8
THIN_RECT_SHORT_MAX = 6.0
THIN_RECT_ASPECT_MIN = 8.0
THIN_RECT_LONG_MIN = 8.0
JOIN_TOL = 0.05
MIN_SEG_PT = 0.05
_DASH_RE = re.compile(r"\[([^\]]*)\]")


@dataclass
class Shape:
    id: int
    pts: list[Pt]
    closed: bool
    paint: str  # 's' stroke, 'f' fill, 'fs' both
    curved: bool
    bbox: Box
    width: float


@dataclass
class TextLine:
    text: str
    box: Box
    angle_deg: float = 0.0

    @property
    def centre(self) -> Pt:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)


@dataclass
class PageSegments:
    size: tuple[float, float]
    shapes: list[Shape] = field(default_factory=list)
    seg: np.ndarray = field(default_factory=lambda: np.zeros((0, 4)))
    width: np.ndarray = field(default_factory=lambda: np.zeros(0))
    colour: list[str] = field(default_factory=list)
    pdf_dashed: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    shape_id: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=int))

    def __len__(self) -> int:
        return len(self.seg)

    def length(self) -> np.ndarray:
        s = self.seg
        return np.hypot(s[:, 2] - s[:, 0], s[:, 3] - s[:, 1]) if len(s) else np.zeros(0)

    def pen(self, i: int) -> tuple[str, str]:
        """(width bucket, colour class) of segment i: the first two parts of a pen class key."""
        return width_bucket(float(self.width[i])), self.colour[i]


def is_dashed(dash: str | None) -> bool:
    """True for a non-empty dash array ('[ 3 2 ] 0'); '[] 0' and '' are solid."""
    if not dash:
        return False
    m = _DASH_RE.search(dash)
    return bool(m and m.group(1).strip())


def _bbox(pts: list[Pt]) -> Box:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _near(a: Pt, b: Pt) -> bool:
    return abs(a[0] - b[0]) <= JOIN_TOL and abs(a[1] - b[1]) <= JOIN_TOL


def _subpaths(items, m: pymupdf.Matrix) -> list[dict]:
    def tp(p) -> Pt:
        q = pymupdf.Point(p) * m
        return (q.x, q.y)

    out: list[dict] = []
    cur: dict | None = None
    for it in items:
        kind = it[0]
        if kind in ("re", "qu"):
            if kind == "re":
                r = pymupdf.Rect(it[1])
                corners = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
            else:
                q = it[1]
                corners = [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
            out.append({"pts": [tp(p) for p in corners], "closed": True, "curved": False})
            cur = None
            continue
        if kind == "l":
            seq = [tp(it[1]), tp(it[2])]
            curved = False
        elif kind == "c":
            p = [tp(it[k]) for k in range(1, 5)]
            seq = bezier_points(p[0], p[1], p[2], p[3], CURVE_SAMPLES)
            curved = True
        else:
            continue
        if cur is not None and _near(cur["pts"][-1], seq[0]):
            cur["pts"].extend(seq[1:])
            cur["curved"] = cur["curved"] or curved
        else:
            cur = {"pts": list(seq), "closed": False, "curved": curved}
            out.append(cur)
    for sp in out:
        if not sp["closed"] and len(sp["pts"]) >= 4 and _near(sp["pts"][0], sp["pts"][-1]):
            sp["closed"] = True
            sp["pts"] = sp["pts"][:-1]
    return out


def parse_page(page: pymupdf.Page) -> PageSegments:
    m = page.rotation_matrix
    rect = page.rect * m
    rect.normalize()
    out = PageSegments(size=(rect.width, rect.height))
    segs: list[tuple[float, float, float, float]] = []
    widths: list[float] = []
    dashed: list[bool] = []
    sids: list[int] = []
    for d in page.get_drawings():
        paint = d.get("type")
        if paint not in ("s", "f", "fs"):
            continue
        items = d.get("items") or []
        if not items:
            continue
        width = float(d.get("width") or 0.0) if paint in ("s", "fs") else 0.0
        dash = paint in ("s", "fs") and is_dashed(d.get("dashes"))
        col = colour_class(d.get("color"))
        fill_col = colour_class(d.get("fill"))
        for sp in _subpaths(items, m):
            pts = sp["pts"]
            sid = len(out.shapes)
            shape = Shape(sid, pts, sp["closed"], paint, sp["curved"], _bbox(pts), width)
            out.shapes.append(shape)
            if paint in ("s", "fs") and not sp["curved"]:
                edges = list(zip(pts, pts[1:], strict=False))
                if sp["closed"]:
                    edges.append((pts[-1], pts[0]))
                for a, b in edges:
                    if math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_SEG_PT:
                        continue
                    segs.append((a[0], a[1], b[0], b[1]))
                    widths.append(width)
                    dashed.append(dash)
                    sids.append(sid)
                    out.colour.append(col)
            elif paint == "f" and sp["closed"]:
                x0, y0, x1, y1 = shape.bbox
                w, h = x1 - x0, y1 - y0
                long_s, short_s = max(w, h), min(w, h)
                if (
                    short_s > 0
                    and long_s >= THIN_RECT_LONG_MIN
                    and long_s / short_s >= THIN_RECT_ASPECT_MIN
                    and short_s <= THIN_RECT_SHORT_MAX
                ):
                    if w >= h:
                        segs.append((x0, (y0 + y1) / 2, x1, (y0 + y1) / 2))
                    else:
                        segs.append(((x0 + x1) / 2, y0, (x0 + x1) / 2, y1))
                    widths.append(short_s)
                    dashed.append(False)
                    sids.append(sid)
                    out.colour.append(fill_col)
    if segs:
        out.seg = np.asarray(segs, dtype=float)
        out.width = np.asarray(widths, dtype=float)
        out.pdf_dashed = np.asarray(dashed, dtype=bool)
        out.shape_id = np.asarray(sids, dtype=int)
    return out


def crop(ps: PageSegments, box: Box) -> PageSegments:
    """The segments clipped to the crop box, and the shapes whose centre lies inside it. Shape ids
    are kept (segments still point at their shape)."""
    out = PageSegments(size=ps.size)
    out.shapes = [
        s
        for s in ps.shapes
        if box[0] <= (s.bbox[0] + s.bbox[2]) / 2 <= box[2]
        and box[1] <= (s.bbox[1] + s.bbox[3]) / 2 <= box[3]
    ]
    rows, keep = [], []
    for i, (x0, y0, x1, y1) in enumerate(ps.seg):
        c = clip_segment((x0, y0), (x1, y1), box)
        if c is None or math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < MIN_SEG_PT:
            continue
        rows.append((c[0][0], c[0][1], c[1][0], c[1][1]))
        keep.append(i)
    if rows:
        idx = np.asarray(keep, dtype=int)
        out.seg = np.asarray(rows, dtype=float)
        out.width = ps.width[idx]
        out.colour = [ps.colour[i] for i in keep]
        out.pdf_dashed = ps.pdf_dashed[idx]
        out.shape_id = ps.shape_id[idx]
    return out


def page_text_lines(page: pymupdf.Page) -> list[TextLine]:
    """Text lines of the text layer, displayed orientation, angle from the line direction."""
    m = page.rotation_matrix
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for ln in block["lines"]:
            dx, dy = ln["dir"]
            v = pymupdf.Point(dx, dy) * pymupdf.Matrix(m.a, m.b, m.c, m.d, 0, 0)
            ang = math.degrees(math.atan2(v.y, v.x)) % 180.0
            text = "".join(sp["text"] for sp in ln["spans"])
            if not text.strip():
                continue
            r = pymupdf.Rect(ln["bbox"]) * m
            r.normalize()
            out.append(TextLine(text.strip(), (r.x0, r.y0, r.x1, r.y1), ang))
    return out
