"""Phase 6c helpers (pure, synthetic-testable): primitive classification and distances, the
exclusive census categories, content-stream scan for Form XObject regions, the sample selection.

The extractor rule mirrored here is `src/linking/lines.py::page_segments`: an `l` or `re` item of a
stroked path (paint stroke or both) is kept; a filled-only path is kept only when its box is a thin
rectangle (long side >= 8, aspect >= 8, thin side <= 6). Everything else is dropped.
"""

from __future__ import annotations

import math
import random
import re
from collections.abc import Iterable, Iterator

import pymupdf

# Fixed census constants (docs/PHASE6C_PREREGISTRATION.md)
RADIUS_PT = 24.0
CURVE_SAMPLES = 8
BACKGROUND_IMAGE_SHARE = 0.9
SAMPLE_SEED = 6003
SAMPLE_SIZE = 60
SAMPLE_PER_JOB = 6

KEPT = "kept"
DROPPED_TYPES = ("curve", "quad", "filled shape", "short stroked line")
CATEGORIES = (
    "0 extracted line of another class within 24 pt",
    "a dropped geometry within 24 pt",
    "c image region",
    "b only text within 24 pt",
    "d nothing within 24 pt",
)

Pt = tuple[float, float]


# ---- geometry -----------------------------------------------------------------------------------
def seg_distance(x: float, y: float, a: Pt, b: Pt) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 <= 1e-12:
        return math.hypot(x - a[0], y - a[1])
    t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
    return math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))


def inside_polygon(x: float, y: float, pts: list[Pt]) -> bool:
    inside = False
    n = len(pts)
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polyline_distance(x: float, y: float, pts: list[Pt], closed: bool, filled: bool) -> float:
    if closed and filled and len(pts) >= 3 and inside_polygon(x, y, pts):
        return 0.0
    n = len(pts)
    edges = range(n) if closed else range(n - 1)
    return min(seg_distance(x, y, pts[i], pts[(i + 1) % n]) for i in edges)


def bezier_points(p1: Pt, c1: Pt, c2: Pt, p2: Pt, n: int = CURVE_SAMPLES) -> list[Pt]:
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


def item_shape(item, m: pymupdf.Matrix) -> tuple[str, list[Pt], bool]:
    """(kind, points after the matrix, closed) of one drawing item; kind in l, re, qu, c."""
    kind = item[0]

    def tp(p) -> Pt:
        q = pymupdf.Point(p) * m
        return (q.x, q.y)

    if kind == "l":
        return "l", [tp(item[1]), tp(item[2])], False
    if kind == "re":
        r = pymupdf.Rect(item[1]) * m
        r.normalize()
        return "re", [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)], True
    if kind == "qu":
        q = item[1]
        return "qu", [tp(q.ul), tp(q.ur), tp(q.lr), tp(q.ll)], True
    if kind == "c":
        return "c", bezier_points(tp(item[1]), tp(item[2]), tp(item[3]), tp(item[4])), False
    return kind, [], False


def is_thin_rect(w: float, h: float) -> bool:
    long_side, thin = max(w, h), min(w, h)
    return long_side >= 8 and thin > 0 and long_side / thin >= 8 and thin <= 6


def classify_primitive(
    path_type: str, kind: str, path_box: tuple[float, float, float, float], length: float
) -> str:
    """'kept' when the line extractor turns it into a segment, else the dropped type."""
    if path_type in ("s", "fs") and kind in ("l", "re"):
        return "short stroked line" if kind == "l" and length < 0.05 else KEPT
    if path_type == "f" and is_thin_rect(path_box[2] - path_box[0], path_box[3] - path_box[1]):
        return KEPT
    if kind == "c":
        return "curve"
    if kind == "qu":
        return "quad"
    return "filled shape"


def width_bucket(w: float) -> str:
    for hi, name in ((0.1, "<0.1"), (0.25, "0.1-0.25"), (0.5, "0.25-0.5"), (1.0, "0.5-1")):
        if w < hi:
            return name
    return "1-1.5" if w < 1.5 else ("1.5-2.5" if w < 2.5 else ">2.5")


def path_size_bucket(n: int) -> str:
    return "1" if n == 1 else ("2-4" if n <= 4 else ("5-20" if n <= 20 else ">20"))


# ---- census category (exclusive, fixed order 0, a, c, b, d) ------------------------------------
def census_category(
    *, other_class_line: bool, dropped: bool, in_image: bool, text_near: bool
) -> str:
    if other_class_line:
        return CATEGORIES[0]
    if dropped:
        return CATEGORIES[1]
    if in_image:
        return CATEGORIES[2]
    if text_near:
        return CATEGORIES[3]
    return CATEGORIES[4]


# ---- content-stream scan: Form XObject regions -------------------------------------------------
_TOKEN = re.compile(
    rb"%[^\r\n]*|<<|>>|\[|\]|<[0-9A-Fa-f\s]*>|/[^\s/\[\]()<>%]*|[-+]?(?:\d+\.?\d*|\.\d+)"
    rb"|[A-Za-z'\"*]+|\("
)
Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mat_mul(a: Matrix, b: Matrix) -> Matrix:
    """Row-vector convention of PDF: result = a then b (point * a * b)."""
    return (
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    )


def stream_ops(data: bytes) -> Iterator[tuple[list[float], str]]:
    """Operators of a content stream with their numeric operands only; names are returned as
    '/Name' strings in the operand slot via the operator tuple (name operand kept as last str)."""
    pos, n = 0, len(data)
    operands: list = []
    while pos < n:
        m = _TOKEN.search(data, pos)
        if m is None:
            return
        tok = m.group(0)
        pos = m.end()
        if tok == b"(":  # string with balanced parentheses and escapes
            depth = 1
            while pos < n and depth:
                c = data[pos]
                if c == 0x5C:  # backslash
                    pos += 1
                elif c == 0x28:
                    depth += 1
                elif c == 0x29:
                    depth -= 1
                pos += 1
            operands.append("(str)")
        elif tok[:1] == b"%":
            continue
        elif tok[:1] == b"/":
            operands.append(tok.decode("latin-1"))
        elif tok in (b"[", b"]", b"<<", b">>") or tok[:1] == b"<":
            operands.append(tok.decode("latin-1")[:2])
        elif tok[:1].isalpha() or tok[:1] in b"'\"*":
            op = tok.decode("latin-1")
            if op == "BI":  # inline image: skip to EI
                end = data.find(b"EI", pos)
                pos = n if end < 0 else end + 2
                operands = []
                continue
            yield operands, op
            operands = []
        else:
            try:
                operands.append(float(tok))
            except ValueError:  # a stray token (for example a lone '*') is not an operand
                continue


def form_calls(data: bytes, base: Matrix = IDENTITY) -> list[tuple[str, Matrix]]:
    """(resource name, CTM) of every `Do` in a content stream (q, Q, cm tracked)."""
    ctm = base
    stack: list[Matrix] = []
    out: list[tuple[str, Matrix]] = []
    for operands, op in stream_ops(data):
        if op == "q":
            stack.append(ctm)
        elif op == "Q":
            if stack:
                ctm = stack.pop()
        elif op == "cm":
            nums = [v for v in operands if isinstance(v, float)]
            if len(nums) == 6:
                ctm = mat_mul((nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]), ctm)
        elif op == "Do" and operands and isinstance(operands[-1], str) and operands[-1][:1] == "/":
            out.append((operands[-1][1:], ctm))
    return out


def quad_of_box(box: tuple[float, float, float, float], m: Matrix) -> list[Pt]:
    x0, y0, x1, y1 = box
    return [
        (x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5])
        for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    ]


def form_quads(doc: pymupdf.Document, page: pymupdf.Page, max_calls: int = 20000) -> list[list[Pt]]:
    """Displayed-point quadrilaterals of the Form XObjects the page draws (nested ones included).

    Page-level names come from `get_xobjects()` with invoker 0; names inside a form with the form's
    xref as invoker. Positions: form box through form matrix and CTM, then the page's
    transformation and rotation matrices. Approximate for unusual streams (see the
    pre-registration)."""
    by_invoker: dict[int, dict[str, tuple[int, tuple]]] = {}
    for xref, name, invoker, bbox in page.get_xobjects():
        by_invoker.setdefault(invoker, {})[name] = (xref, tuple(bbox))
    quads: list[list[Pt]] = []
    calls = 0
    to_display = page.transformation_matrix * page.rotation_matrix

    def form_matrix(xref: int) -> Matrix:
        kind, val = doc.xref_get_key(xref, "Matrix")
        if kind != "array":
            return IDENTITY
        nums = [float(v) for v in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)", val)]
        return (
            (nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]) if len(nums) == 6 else IDENTITY
        )

    def walk(data: bytes, invoker: int, base: Matrix, depth: int) -> None:
        nonlocal calls
        for name, ctm in form_calls(data, base):
            calls += 1
            if calls > max_calls:
                return
            hit = by_invoker.get(invoker, {}).get(name)
            if hit is None:
                continue
            xref, bbox = hit
            full = mat_mul(form_matrix(xref), ctm)
            quad = quad_of_box(bbox, full)
            pts = []
            for x, y in quad:
                q = pymupdf.Point(x, y) * to_display
                pts.append((q.x, q.y))
            quads.append(pts)
            if depth < 4 and xref in by_invoker:
                try:
                    walk(doc.xref_stream(xref) or b"", xref, full, depth + 1)
                except Exception:  # noqa: BLE001 - an unreadable stream is just not scanned
                    continue

    walk(page.read_contents(), 0, IDENTITY, 0)
    return quads


# ---- sample selection ---------------------------------------------------------------------------
def select_sample(
    population: Iterable[tuple[str, int, int]],
    seed: int = SAMPLE_SEED,
    size: int = SAMPLE_SIZE,
    per_job: int = SAMPLE_PER_JOB,
) -> list[tuple[str, int, int]]:
    """(job, page, symbol index) triples: sort, shuffle with the seed, keep while the job has fewer
    than `per_job`, stop at `size`."""
    items = sorted(population)
    random.Random(seed).shuffle(items)
    taken: dict[str, int] = {}
    out = []
    for it in items:
        if taken.get(it[0], 0) >= per_job:
            continue
        taken[it[0]] = taken.get(it[0], 0) + 1
        out.append(it)
        if len(out) >= size:
            break
    return out
