"""Phase 7 Part C, step 1: vector parse of one page (docs/PHASE7_PREREGISTRATION.md, 4.2 rule 1).

Every path of `page.get_drawings()` becomes a `Prim` (paint, width, dash array, colours, closed
flag, item count, box) and its connected pieces become `Shape`s (a polyline, open or closed, with
curves sampled). Straight pieces become rows of a segment table with the width and dash of their
path. Filled rectangles whose short side is at most 6 pt and aspect at least 8 are segments too
(width = the short side), like the Phase 4e extractor. Coordinates are in the page's DISPLAYED
orientation (rotation applied by hand). The Form XObject transform stack is applied by the PDF
engine; `forms_report` only counts how many primitives sit inside a form (content-stream scan).

Pure and deterministic; no file access except the page it is given.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np
import pymupdf

from tools.takeoff import phase6c_lib as L6

Pt = tuple[float, float]
CURVE_SAMPLES = 8
THIN_RECT_SHORT_MAX = 6.0
THIN_RECT_ASPECT_MIN = 8.0
JOIN_TOL = 0.05
_DASH_RE = re.compile(r"\[([^\]]*)\]")


@dataclass
class Prim:
    id: int
    paint: str  # 's' stroke, 'f' fill, 'fs' both
    width: float
    dash: str  # the dash array as written, '' when solid
    closed: bool
    n_items: int
    bbox: tuple[float, float, float, float]
    stroke: tuple | None
    fill: tuple | None
    in_form: bool = False


@dataclass
class Shape:
    id: int
    prim: int
    pts: list[Pt]
    closed: bool
    paint: str
    curved: bool
    rect_item: bool  # came from a single 're' or 'qu' item
    bbox: tuple[float, float, float, float]


@dataclass
class PageParse:
    size: tuple[float, float]
    prims: list[Prim] = field(default_factory=list)
    shapes: list[Shape] = field(default_factory=list)
    # segment table (straight pieces): x0 y0 x1 y1
    seg: np.ndarray = field(default_factory=lambda: np.zeros((0, 4)))
    seg_w: np.ndarray = field(default_factory=lambda: np.zeros(0))
    seg_dashed: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    seg_prim: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=int))
    seg_shape: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=int))  # -1: none
    seg_thinfill: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    n_forms: int = 0


def is_dashed(dash: str | None) -> bool:
    """True for a non-empty dash array ('[ 3 2 ] 0'); '[] 0' and '' are solid."""
    if not dash:
        return False
    m = _DASH_RE.search(dash)
    return bool(m and m.group(1).strip())


def transform(m: pymupdf.Matrix):
    a, b, c, d, e, f = m.a, m.b, m.c, m.d, m.e, m.f

    def tp(p) -> Pt:
        return (a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f)

    return tp


def _bbox(pts: list[Pt]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _near(a: Pt, b: Pt) -> bool:
    return abs(a[0] - b[0]) <= JOIN_TOL and abs(a[1] - b[1]) <= JOIN_TOL


def _subpaths(items, tp) -> list[dict]:
    """Connect the items of a path into pieces: {'pts', 'closed', 'curved', 'rect'}."""
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
            out.append(
                {
                    "pts": [tp(p) for p in corners],
                    "closed": True,
                    "curved": False,
                    "rect": True,
                }
            )
            cur = None
            continue
        if kind == "l":
            seq = [tp(it[1]), tp(it[2])]
            curved = False
        elif kind == "c":
            seq = [tp(it[1]), tp(it[2]), tp(it[3]), tp(it[4])]
            seq = L6.bezier_points(seq[0], seq[1], seq[2], seq[3], CURVE_SAMPLES)
            curved = True
        else:
            continue
        if cur is not None and _near(cur["pts"][-1], seq[0]):
            cur["pts"].extend(seq[1:])
            cur["curved"] = cur["curved"] or curved
        else:
            cur = {"pts": list(seq), "closed": False, "curved": curved, "rect": False}
            out.append(cur)
    for sp in out:
        if not sp["closed"] and len(sp["pts"]) >= 4 and _near(sp["pts"][0], sp["pts"][-1]):
            sp["closed"] = True
            sp["pts"] = sp["pts"][:-1]
    return out


def parse_page(page: pymupdf.Page, doc: pymupdf.Document | None = None) -> PageParse:
    tp = transform(page.rotation_matrix)
    out = PageParse(size=(page.rect.width, page.rect.height))
    segs: list[tuple[float, float, float, float]] = []
    seg_w: list[float] = []
    seg_dashed: list[bool] = []
    seg_prim: list[int] = []
    seg_shape: list[int] = []
    seg_thin: list[bool] = []
    forms = L6.form_quads(doc, page) if doc is not None else []
    out.n_forms = len(forms)
    for d in page.get_drawings():
        paint = d.get("type")
        if paint not in ("s", "f", "fs"):
            continue
        items = d.get("items") or []
        if not items:
            continue
        width = float(d.get("width") or 0.0) if paint in ("s", "fs") else 0.0
        dash = d.get("dashes") or ""
        dashed = paint in ("s", "fs") and is_dashed(dash)
        pid = len(out.prims)
        subs = _subpaths(items, tp)
        all_pts = [p for sp in subs for p in sp["pts"]]
        if not all_pts:
            continue
        box = _bbox(all_pts)
        prim = Prim(
            id=pid,
            paint=paint,
            width=width,
            dash=dash if dashed else "",
            closed=bool(d.get("closePath")) or any(sp["closed"] for sp in subs),
            n_items=len(items),
            bbox=box,
            stroke=tuple(d["color"]) if d.get("color") is not None else None,
            fill=tuple(d["fill"]) if d.get("fill") is not None else None,
        )
        if forms:
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            prim.in_form = any(L6.inside_polygon(cx, cy, q) for q in forms)
        out.prims.append(prim)
        for sp in subs:
            pts = sp["pts"]
            sid = len(out.shapes)
            out.shapes.append(
                Shape(
                    id=sid,
                    prim=pid,
                    pts=pts,
                    closed=sp["closed"],
                    paint=paint,
                    curved=sp["curved"],
                    rect_item=sp["rect"],
                    bbox=_bbox(pts),
                )
            )
            if paint in ("s", "fs") and not sp["curved"]:
                edges = list(zip(pts, pts[1:], strict=False))
                if sp["closed"]:
                    edges.append((pts[-1], pts[0]))
                for a, b in edges:
                    if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05:
                        continue
                    segs.append((a[0], a[1], b[0], b[1]))
                    seg_w.append(width)
                    seg_dashed.append(dashed)
                    seg_prim.append(pid)
                    seg_shape.append(sid)
                    seg_thin.append(False)
            elif paint == "f":
                x0, y0, x1, y1 = out.shapes[-1].bbox
                w, h = x1 - x0, y1 - y0
                long_s, short_s = max(w, h), min(w, h)
                if (
                    sp["closed"]
                    and short_s > 0
                    and long_s >= 8
                    and long_s / short_s >= THIN_RECT_ASPECT_MIN
                    and short_s <= THIN_RECT_SHORT_MAX
                ):
                    if w >= h:
                        cy = (y0 + y1) / 2
                        segs.append((x0, cy, x1, cy))
                    else:
                        cx = (x0 + x1) / 2
                        segs.append((cx, y0, cx, y1))
                    seg_w.append(short_s)
                    seg_dashed.append(False)
                    seg_prim.append(pid)
                    seg_shape.append(sid)
                    seg_thin.append(True)
    if segs:
        out.seg = np.asarray(segs, dtype=float)
        out.seg_w = np.asarray(seg_w, dtype=float)
        out.seg_dashed = np.asarray(seg_dashed, dtype=bool)
        out.seg_prim = np.asarray(seg_prim, dtype=int)
        out.seg_shape = np.asarray(seg_shape, dtype=int)
        out.seg_thinfill = np.asarray(seg_thin, dtype=bool)
    return out


def forms_report(parse: PageParse) -> dict:
    """How many primitives were drawn inside a Form XObject, and how many forms the page calls."""
    return {
        "forms": parse.n_forms,
        "prims_in_form": sum(1 for p in parse.prims if p.in_form),
        "prims": len(parse.prims),
    }
