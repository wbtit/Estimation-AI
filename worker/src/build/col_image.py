"""Phase 14d: image-based Find similar (docs/PHASE14D_PREREGISTRATION.md).

From one clicked column, the page's crop is rendered at a fixed resolution, the ink is cleaned
(long straight lines and the detected grid lines removed), and the clicked symbol's image is a
template searched with normalised template matching at 0 and 90 degrees; hits pass non-max
suppression and the real-size check of 14b. A square drawn as loose corner strokes that never
close into one vector outline is found this way. The vector matches (stored candidate symbols,
the same rule as the API's Find similar) and the image matches are combined and de-duplicated.
Pure and deterministic over the PDF page; OpenCV (headless); no LLM.
"""

from __future__ import annotations

import json
import math
import os
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pymupdf

from src.build.geom import Box, Pt

# fixed values (prereg 14d section 2)
PX_PER_IN = 3.0  # render resolution: pixels per REAL inch
MAX_PX = 40_000_000  # cap on rendered crop pixels (the resolution drops when over)
INK_LEVEL = 128  # grey below this is ink
LONG_LINE_IN = 36.0  # straight ink runs longer than this (real inches) are lines, not symbols
GRID_BAND_PT = 1.0  # a detected grid line erases this much ink each side of its axis
JOIN_PT = 2.0  # ink this close joins one component (the example from ink)
SNAP_RADIUS_PT = float(
    json.loads((Path(__file__).resolve().parents[3] / "schema" / "column-snap.json").read_text())[
        "snap_radius_pt"
    ]
)  # Phase 0-14g: ONE value for the web snap, the API and this lookup (schema/column-snap.json)
CLICK_PT = SNAP_RADIUS_PT  # the example: a symbol / ink within this of the click
ANGLE_MIN_DEG = 2.0  # an example (or a stored symbol) turned more than this has its own angle
ANGLE_DEDUP_DEG = 2.0  # search angles closer than this are one
BLOB_ASPECT_MAX = 6.0  # an ink blob longer than this x its short side is not a column symbol
# hull area / min rectangle area: 0.9 x the lowest of 5 fit-set column blobs, floored to 0.05
# (docs/PHASE0_14G_PREREGISTRATION.md section 3)
BLOB_FILL_MIN = 0.55
EX_WINDOW_IN = 36.0  # the example's ink is read inside this square around the click
MARGIN_SHARE, MARGIN_MIN_PX = 0.1, 2  # template margin
THRESHOLD = 0.70  # TM_CCOEFF_NORMED
NMS_SHARE = 0.5  # hits closer than this x the template's long side: the best one stays
REAL_LONG_MIN_IN, REAL_LONG_MAX_IN, REAL_SHORT_MIN_IN = 4.0, 36.0, 1.5
SIZE_TOL_IN, SIZE_TOL_SHARE = 1.0, 0.15
TAKEN_PT = 12.0
DEDUP_MIN_PT = 12.0
CANNY_LO, CANNY_HI = 50, 150
KNOWN = ("w_shape", "w_cover_plates", "hss_square", "hss_rect", "hss_round")


@dataclass
class Settings:
    threshold: float = THRESHOLD
    edges: bool = False  # information variant: match on edge images
    px_per_in: float = PX_PER_IN


@dataclass
class Raster:
    gray: np.ndarray  # uint8, 255 = paper
    clean: np.ndarray  # uint8 0 / 1: ink without long lines and grid bands
    z: float  # pixels per page point
    origin: Pt  # page point of pixel (0, 0)
    crop: Box

    def px(self, p: Pt) -> tuple[float, float]:
        return ((p[0] - self.origin[0]) * self.z, (p[1] - self.origin[1]) * self.z)

    def pt(self, x: float, y: float) -> Pt:
        return (self.origin[0] + x / self.z, self.origin[1] + y / self.z)


@dataclass
class Hit:
    centre: Pt
    box: Box
    score: float
    rotation: int
    real_in: tuple[float, float]


@dataclass
class Result:
    example: dict | None  # {"source": "vector" | "ink", "box", "centre", "real_in", "family", ...}
    vector: list[dict] = field(default_factory=list)
    image: list[Hit] = field(default_factory=list)
    combined: list[dict] = field(default_factory=list)
    runtime_s: float = 0.0
    z: float = 0.0
    note: str | None = None
    refused: str | None = None  # 'click_closer': no symbol or sane ink blob within the radius
    snap: dict | None = None  # {"source": "symbol" | "ink", "centre", "distance"} of the example
    angles: list[float] = field(default_factory=list)  # the absolute angles searched
    warning: str | None = None  # 'unchecked_ink': the example is main's ink read, not checked


def real_in(pt: float, ratio: float) -> float:
    return pt * ratio / 72.0


def same_size(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return all(
        abs(x - y) <= max(SIZE_TOL_IN, SIZE_TOL_SHARE * y) for x, y in zip(a, b, strict=True)
    )


# ---- raster ----------
def render(
    page: pymupdf.Page,
    crop: Box,
    ratio: float,
    grid: list[tuple[Pt, Pt]],
    s: Settings,
) -> Raster:
    """The crop in grey at s.px_per_in pixels per real inch (capped at MAX_PX); its clean ink."""
    w, h = crop[2] - crop[0], crop[3] - crop[1]
    z = s.px_per_in * ratio / 72.0
    if w * h * z * z > MAX_PX:
        z = math.sqrt(MAX_PX / (w * h))
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(z, z), clip=pymupdf.Rect(*crop), colorspace=pymupdf.csGRAY,
        alpha=False,
    )  # fmt: skip
    gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    gray = gray[:, : pix.width].copy()
    ink = (gray < INK_LEVEL).astype(np.uint8)
    long_px = max(3, round(LONG_LINE_IN * z * 72.0 / ratio))
    lines = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, long_px), np.uint8)) | (
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((long_px, 1), np.uint8))
    )
    clean = ink & (1 - lines)
    band = np.zeros_like(clean)
    t = max(1, round(2 * GRID_BAND_PT * z))
    for a, b in grid:
        pa = (round((a[0] - crop[0]) * z), round((a[1] - crop[1]) * z))
        pb = (round((b[0] - crop[0]) * z), round((b[1] - crop[1]) * z))
        cv2.line(band, pa, pb, 1, thickness=t)
    clean = clean & (1 - band)
    return Raster(gray, clean.astype(np.uint8), z, (crop[0], crop[1]), crop)


def _ink_box(
    clean: np.ndarray, x0: int, y0: int, x1: int, y1: int
) -> tuple[int, int, int, int] | None:
    sub = clean[max(y0, 0) : max(y1, 0), max(x0, 0) : max(x1, 0)]
    ys, xs = np.nonzero(sub)
    if len(xs) == 0:
        return None
    return (max(x0, 0) + int(xs.min()), max(y0, 0) + int(ys.min()),
            max(x0, 0) + int(xs.max()) + 1, max(y0, 0) + int(ys.max()) + 1)  # fmt: skip


def _sides_in(box_px: tuple[int, int, int, int], r: Raster, ratio: float) -> tuple[float, float]:
    w = real_in((box_px[2] - box_px[0]) / r.z, ratio)
    h = real_in((box_px[3] - box_px[1]) / r.z, ratio)
    return (min(w, h), max(w, h))


def _size_ok(sides: tuple[float, float]) -> bool:
    short, long_ = sides
    return REAL_LONG_MIN_IN <= long_ <= REAL_LONG_MAX_IN and short >= REAL_SHORT_MIN_IN


# ---- the example ----------
def vector_example(click: Pt, symbols: list[dict]) -> dict | None:
    """The stored symbol under the click: nearest known family within CLICK_PT, else the nearest
    solid shape (14c 2.3)."""
    for ok in (lambda s: s["family"] in KNOWN, lambda s: bool(s.get("solid"))):
        best = None
        for k, s in enumerate(symbols):
            if not ok(s):
                continue
            d = math.dist(click, s["centre"])
            if d <= CLICK_PT and (best is None or (d, k) < best):
                best = (d, k)
        if best is not None:
            return symbols[best[1]]
    return None


def ink_example(r: Raster, click: Pt, ratio: float) -> tuple[int, int, int, int] | None:
    """The clean ink joined (within JOIN_PT) to the ink nearest the click (within CLICK_PT), read
    inside an EX_WINDOW_IN square around the click; None when there is none or it fails the
    real-size filter."""
    cx, cy = r.px(click)
    half = EX_WINDOW_IN * 72.0 / ratio * r.z / 2
    x0, y0 = int(math.floor(cx - half)), int(math.floor(cy - half))
    x1, y1 = int(math.ceil(cx + half)), int(math.ceil(cy + half))
    H, W = r.clean.shape
    x0c, y0c, x1c, y1c = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if x1c <= x0c or y1c <= y0c:
        return None
    win = r.clean[y0c:y1c, x0c:x1c]
    j = max(1, round(JOIN_PT * r.z))
    joined = cv2.dilate(win, np.ones((2 * j + 1, 2 * j + 1), np.uint8))
    n, labels = cv2.connectedComponents(joined, connectivity=8)
    ys, xs = np.nonzero(win)
    if len(xs) == 0:
        return None
    d = np.hypot(xs + x0c + 0.5 - cx, ys + y0c + 0.5 - cy)
    k = int(np.argmin(d))
    if d[k] > CLICK_PT * r.z:
        return None
    lab = labels[ys[k], xs[k]]
    mask = (labels == lab) & (win > 0)
    ys2, xs2 = np.nonzero(mask)
    box = (
        x0c + int(xs2.min()),
        y0c + int(ys2.min()),
        x0c + int(xs2.max()) + 1,
        y0c + int(ys2.max()) + 1,
    )  # noqa: E501
    return box if _size_ok(_sides_in(box, r, ratio)) else None


# ---- the example's own geometry (Phase 0-14g) ----------
@dataclass
class Blob:
    """The clean-ink component nearest a point: its minimum-area rectangle (page points)."""

    centre: Pt
    angle: float  # the rectangle's turn from the page axes, degrees in (-45, 45] (clockwise > 0)
    sides_in: tuple[float, float]  # (short, long), real inches, along the rectangle
    box: Box  # axis-aligned box of the ink (page points)
    box_px: tuple[int, int, int, int]
    rect: list[Pt]  # the four corners (page points)
    rect_px: list[tuple[float, float]]
    sides_px: tuple[float, float]  # (short, long)
    fill: float  # hull area / rectangle area
    touches_edge: bool


def ink_blob(r: Raster, point: Pt, ratio: float) -> Blob | None:
    """The ink joined (JOIN_PT) to the ink nearest `point` (within CLICK_PT), read inside an
    EX_WINDOW_IN square around it, with its minimum-area rectangle; None when there is no ink."""
    cx, cy = r.px(point)
    # the window holds the whole radius around the point and a symbol of the largest real size
    half = (CLICK_PT + LONG_LINE_IN * 72.0 / ratio) * r.z
    x0, y0 = int(math.floor(cx - half)), int(math.floor(cy - half))
    x1, y1 = int(math.ceil(cx + half)), int(math.ceil(cy + half))
    H, W = r.clean.shape
    x0c, y0c, x1c, y1c = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if x1c <= x0c or y1c <= y0c:
        return None
    win = r.clean[y0c:y1c, x0c:x1c]
    j = max(1, round(JOIN_PT * r.z))
    joined = cv2.dilate(win, np.ones((2 * j + 1, 2 * j + 1), np.uint8))
    _n, labels = cv2.connectedComponents(joined, connectivity=8)
    ys, xs = np.nonzero(win)
    if len(xs) == 0:
        return None
    d = np.hypot(xs + x0c + 0.5 - cx, ys + y0c + 0.5 - cy)
    k = int(np.argmin(d))
    if d[k] > CLICK_PT * r.z:
        return None
    mask = (labels == labels[ys[k], xs[k]]) & (win > 0)
    ys2, xs2 = np.nonzero(mask)
    pts = np.column_stack((xs2 + x0c + 0.5, ys2 + y0c + 0.5)).astype(np.float32)
    rect = cv2.minAreaRect(pts)
    corners = cv2.boxPoints(rect)
    e0 = corners[1] - corners[0]
    a = float(np.degrees(np.arctan2(e0[1], e0[0]))) % 90.0
    angle = round(a if a <= 45.0 else a - 90.0, 1)
    edges = [(corners[i], corners[(i + 1) % 4]) for i in range(4)]
    sides_px = tuple(sorted(float(np.hypot(*(e[1] - e[0]))) for e in edges[:2]))
    hull = cv2.convexHull(pts)
    rect_area = float(rect[1][0] * rect[1][1])
    fill = float(cv2.contourArea(hull)) / rect_area if rect_area > 0 else 0.0
    box_px = (x0c + int(xs2.min()), y0c + int(ys2.min()),
              x0c + int(xs2.max()) + 1, y0c + int(ys2.max()) + 1)  # fmt: skip
    b0, b1 = r.pt(box_px[0], box_px[1]), r.pt(box_px[2], box_px[3])
    touches = (
        (x0c == x0 and bool(mask[:, 0].any())) or (x1c == x1 and bool(mask[:, -1].any()))
        or (y0c == y0 and bool(mask[0, :].any())) or (y1c == y1 and bool(mask[-1, :].any()))
    )  # fmt: skip
    return Blob(
        r.pt(*rect[0]), angle,
        (round(real_in(sides_px[0] / r.z, ratio), 2), round(real_in(sides_px[1] / r.z, ratio), 2)),
        (b0[0], b0[1], b1[0], b1[1]), box_px,
        [r.pt(float(c[0]), float(c[1])) for c in corners],
        [(float(c[0]), float(c[1])) for c in corners],
        (sides_px[0], sides_px[1]), fill, touches,
    )  # fmt: skip


def blob_refusal(b: Blob) -> str | None:
    """Why an ink blob is not a column symbol (None when it passes): the sanity check of the ink
    example. Size and aspect are the symbol rules of 14b; the fill (hull / rectangle) keeps out a
    column fused to loose linework."""
    short, long_ = b.sides_in
    if not _size_ok((short, long_)):
        return "size"
    if long_ > BLOB_ASPECT_MAX * short:
        return "aspect"
    if b.fill < BLOB_FILL_MIN:
        return "fill"
    if b.touches_edge:
        return "touches_edge"
    return None


# ---- matching ----------
SEARCH_THRESHOLD = 0.6  # Phase 14e: one search at the slider's floor; the preview filters by score
TILE = 256  # result positions per tile side (Phase 14e tiled search)


def _source(r: Raster, s: Settings) -> np.ndarray:
    if s.edges:
        return (cv2.Canny(r.gray, CANNY_LO, CANNY_HI) > 0).astype(np.float32)
    return r.clean.astype(np.float32)


def _template(src: np.ndarray, box_px, r: Raster):
    """(source maybe padded, offset, template, the template window in unpadded pixels)."""
    H, W = src.shape
    bw, bh = box_px[2] - box_px[0], box_px[3] - box_px[1]
    m = max(MARGIN_MIN_PX, round(MARGIN_SHARE * max(bw, bh)))
    tx0, ty0, tx1, ty1 = box_px[0] - m, box_px[1] - m, box_px[2] + m, box_px[3] + m
    off = 0
    if tx0 < 0 or ty0 < 0 or tx1 > W or ty1 > H:
        off = max(-tx0, -ty0, tx1 - W, ty1 - H, 0)
        src = cv2.copyMakeBorder(src, off, off, off, off, cv2.BORDER_CONSTANT, value=0)
        tx0, ty0, tx1, ty1 = tx0 + off, ty0 + off, tx1 + off, ty1 + off
    return src, off, src[ty0:ty1, tx0:tx1].copy(), (tx0 - off, ty0 - off, tx1 - off, ty1 - off)


_POOL: ThreadPoolExecutor | None = None


def _pool() -> ThreadPoolExecutor:
    global _POOL
    if _POOL is None:
        _POOL = ThreadPoolExecutor(max_workers=max(1, os.cpu_count() or 1))
    return _POOL


def _scores(src: np.ndarray, t: np.ndarray) -> np.ndarray:
    """TM_CCOEFF_NORMED of `t` over `src`, by tiles that overlap by the template size, computed
    in parallel; a tile whose source has no ink is skipped (scored -1: a window of blank paper
    scores 0 in OpenCV, below any threshold, and lowering it never makes another position a local
    maximum). Equal to one matchTemplate over the whole source up to float rounding."""
    th, tw = t.shape
    H, W = src.shape
    rh, rw = H - th + 1, W - tw + 1
    res = np.full((rh, rw), -1.0, np.float32)
    ink = cv2.integral((src > 0).astype(np.uint8))

    def has_ink(y0, x0, y1, x1) -> bool:
        return bool(ink[y1, x1] - ink[y0, x1] - ink[y1, x0] + ink[y0, x0])

    jobs = []
    for y0 in range(0, rh, TILE):
        for x0 in range(0, rw, TILE):
            y1, x1 = min(y0 + TILE, rh), min(x0 + TILE, rw)
            if has_ink(y0, x0, y1 + th - 1, x1 + tw - 1):
                jobs.append((y0, x0, y1, x1))

    def one(j):
        y0, x0, y1, x1 = j
        out = cv2.matchTemplate(src[y0 : y1 + th - 1, x0 : x1 + tw - 1], t, cv2.TM_CCOEFF_NORMED)
        res[y0:y1, x0:x1] = np.nan_to_num(out, nan=-1.0, posinf=-1.0, neginf=-1.0)

    list(_pool().map(one, jobs))
    return res


def rotate_template(t: np.ndarray, theta: float) -> np.ndarray:
    """`t` turned clockwise by `theta` degrees (page terms, y down) on a canvas that holds it
    whole; paper (0) fills the corners."""
    h, w = t.shape
    m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), -theta, 1.0)
    c, sn = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(round(h * sn + w * c)), int(round(h * c + w * sn))
    m[0, 2] += nw / 2.0 - w / 2.0
    m[1, 2] += nh / 2.0 - h / 2.0
    return cv2.warpAffine(t, m, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=0)


def _canonical_template(src: np.ndarray, ex: Blob, r: Raster) -> np.ndarray:
    """A turned example read upright: its ink turned back by its own angle about its centre and
    cut to its (now axis-aligned) rectangle plus the template margin."""
    cx = sum(p[0] for p in ex.rect_px) / 4.0
    cy = sum(p[1] for p in ex.rect_px) / 4.0
    short, long_ = ex.sides_px
    m = max(MARGIN_MIN_PX, round(MARGIN_SHARE * long_))
    half = int(math.ceil(math.hypot(short, long_) / 2.0)) + m + 2
    pad = np.pad(src, half, mode="constant")
    px, py = int(round(cx)) + half, int(round(cy)) + half
    patch = pad[py - half : py + half, px - half : px + half].astype(np.float32)
    mat = cv2.getRotationMatrix2D((half, half), ex.angle, 1.0)  # turn it back by -angle
    up = cv2.warpAffine(patch, mat, (2 * half, 2 * half), flags=cv2.INTER_LINEAR, borderValue=0)
    phi = math.radians(-ex.angle)  # the rectangle's corners after turning back
    xs, ys = [], []
    for qx, qy in ex.rect_px:
        dx, dy = qx - cx, qy - cy
        xs.append(dx * math.cos(phi) - dy * math.sin(phi))
        ys.append(dx * math.sin(phi) + dy * math.cos(phi))
    w = int(round(max(xs) - min(xs))) + 2 * m
    h = int(round(max(ys) - min(ys))) + 2 * m
    return up[half - h // 2 : half - h // 2 + h, half - w // 2 : half - w // 2 + w].copy()


def _turned_sides_in(
    clean: np.ndarray,
    cx: float,
    cy: float,
    tw: int,
    th: int,
    theta: float,
    r: Raster,
    ratio: float,
) -> tuple[float, float] | None:
    """Real sides (short, long) of the ink inside a tw x th window turned by theta about (cx, cy):
    the minimum-area rectangle of that ink; None when there is none."""
    rect = ((cx, cy), (float(tw), float(th)), theta)
    poly = np.round(cv2.boxPoints(rect)).astype(np.int32)
    x0, y0 = int(poly[:, 0].min()), int(poly[:, 1].min())
    x1, y1 = int(poly[:, 0].max()) + 1, int(poly[:, 1].max()) + 1
    H, W = clean.shape
    xa, ya, xb, yb = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if xb <= xa or yb <= ya:
        return None
    mask = np.zeros((yb - ya, xb - xa), np.uint8)
    cv2.fillPoly(mask, [poly - np.array([xa, ya], np.int32)], 1)
    ys, xs = np.nonzero(clean[ya:yb, xa:xb] & mask)
    if len(xs) == 0:
        return None
    rr = cv2.minAreaRect(np.column_stack((xs, ys)).astype(np.float32))
    a, b = sorted(float(v) for v in rr[1])
    return (real_in(a / r.z, ratio), real_in(b / r.z, ratio))


def image_matches(
    r: Raster,
    box_px: tuple[int, int, int, int],
    ratio: float,
    s: Settings,
    angles: list[float] | None = None,
    ex: Blob | None = None,
) -> list[Hit]:
    """Template matches of the example box (+ margin) at 0 and 90 degrees (Phase 0-14g: or at the
    absolute column angles `angles`; a turned example `ex` is read upright first), after non-max
    suppression and the real-size check, in (y, x) order (prereg 14d 2.3; Phase 14e: tiled and
    parallel scores, grid-hashed suppression, the same hits). Hit.rotation is the template's turn
    relative to the example (0 and 90 as before when the example is upright)."""
    src, off, tmpl, win = _template(_source(r, s), box_px, r)
    alpha = 0.0 if ex is None or ex.angle < ANGLE_MIN_DEG else ex.angle
    if alpha:
        canon = _canonical_template(src, ex, r)  # type: ignore[arg-type]
        ex_sides = ex.sides_in  # type: ignore[union-attr]
        tmpl = canon
    else:
        # the example is measured like every hit: the clean ink inside its template window
        ex_ink = _ink_box(r.clean, *win)
        if ex_ink is None:
            return []
        ex_sides = _sides_in(ex_ink, r, ratio)
    thetas = [0.0, 90.0] if angles is None else [float(a) % 180.0 for a in angles]
    ch, cw = tmpl.shape  # the upright template (turning it never changes this)
    parts = []
    dims: dict[float, tuple[int, int]] = {}
    for rot in thetas:
        if rot == 0.0:
            t = tmpl
        elif rot == 90.0:
            t = cv2.rotate(tmpl, cv2.ROTATE_90_CLOCKWISE)
        else:
            t = rotate_template(tmpl, rot)
        th, tw = t.shape
        if th > src.shape[0] or tw > src.shape[1] or float(t.std()) == 0.0:
            continue
        res = _scores(src, t)
        dims[rot] = (tw, th)
        k = max(3, int(NMS_SHARE * max(tw, th)) | 1)
        peaks = (res >= s.threshold) & (res == cv2.dilate(res, np.ones((k, k), np.float32)))
        ys, xs = np.nonzero(peaks)
        parts.append((-res[ys, xs].astype(np.float64), ys, xs, np.full(len(ys), rot)))
    if not parts:
        return []
    neg = np.concatenate([p[0] for p in parts])
    ys = np.concatenate([p[1] for p in parts])
    xs = np.concatenate([p[2] for p in parts])
    rots = np.concatenate([p[3] for p in parts])
    order = np.lexsort((rots, xs, ys, neg))  # score desc, then y, x, rotation (as 14d)
    kept: list[tuple[float, float, float, float, int, int]] = []
    cells: dict[tuple[int, int], list[int]] = {}
    for i in order:
        rot = float(rots[i])
        tw, th = dims[rot]
        rad = NMS_SHARE * max(tw, th)
        cx, cy = xs[i] + tw / 2 - off, ys[i] + th / 2 - off
        cs = max(rad, 1.0)
        gx, gy = int(cx // cs), int(cy // cs)
        close = False
        for ax in (gx - 1, gx, gx + 1):
            for ay in (gy - 1, gy, gy + 1):
                for k in cells.get((ax, ay), ()):
                    a, b, *_rest = kept[k]
                    # the radius of the candidate, as 14d (max(tw, th) of the candidate)
                    if math.hypot(cx - a, cy - b) < rad:
                        close = True
                        break
                if close:
                    break
            if close:
                break
        if close:
            continue
        cells.setdefault((gx, gy), []).append(len(kept))
        kept.append((cx, cy, -float(neg[i]), rot, tw, th))
    out: list[Hit] = []
    clean = r.clean
    for cx, cy, score, rot, tw, th in kept:
        x0, y0 = round(cx - tw / 2), round(cy - th / 2)
        if not alpha and rot in (0.0, 90.0):
            ib = _ink_box(clean, x0, y0, x0 + tw, y0 + th)  # the 14d check, unchanged
            if ib is None:
                continue
            sides = _sides_in(ib, r, ratio)
        else:
            ts = _turned_sides_in(clean, cx, cy, cw, ch, rot, r, ratio)
            if ts is None:
                continue
            sides = ts
        if not same_size(sides, ex_sides):
            continue
        c = r.pt(cx, cy)
        if not (r.crop[0] <= c[0] <= r.crop[2] and r.crop[1] <= c[1] <= r.crop[3]):
            continue
        b0, b1 = r.pt(x0, y0), r.pt(x0 + tw, y0 + th)
        rel = (rot - alpha) % 180.0
        out.append(Hit(c, (b0[0], b0[1], b1[0], b1[1]), round(score, 4),
                       int(rel) if rel == int(rel) else round(rel, 1),
                       (round(sides[0], 2), round(sides[1], 2))))  # fmt: skip
    out.sort(key=lambda h: (round(h.centre[1], 1), round(h.centre[0], 1)))
    return out


# ---- the 14d reference implementation (kept for the Phase 14e equivalence check) ----------
def image_matches_14d(
    r: Raster, box_px: tuple[int, int, int, int], ratio: float, s: Settings
) -> list[Hit]:
    """The Phase 14d implementation, unchanged: one matchTemplate over the whole source and a
    plain suppression loop."""
    src = _source(r, s)
    H, W = src.shape
    bw, bh = box_px[2] - box_px[0], box_px[3] - box_px[1]
    m = max(MARGIN_MIN_PX, round(MARGIN_SHARE * max(bw, bh)))
    tx0, ty0, tx1, ty1 = box_px[0] - m, box_px[1] - m, box_px[2] + m, box_px[3] + m
    if tx0 < 0 or ty0 < 0 or tx1 > W or ty1 > H:
        pad = max(-tx0, -ty0, tx1 - W, ty1 - H, 0)
        src = cv2.copyMakeBorder(src, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
        tx0, ty0, tx1, ty1 = tx0 + pad, ty0 + pad, tx1 + pad, ty1 + pad
        off = pad
    else:
        off = 0
    tmpl = src[ty0:ty1, tx0:tx1].copy()
    # the example is measured like every hit: the clean ink inside its template window
    ex_ink = _ink_box(r.clean, tx0 - off, ty0 - off, tx1 - off, ty1 - off)
    if ex_ink is None:
        return []
    ex_sides = _sides_in(ex_ink, r, ratio)
    cands: list[tuple[float, int, int, int, int, int]] = []  # (-score, y, x, rot, tw, th)
    for rot in (0, 90):
        t = tmpl if rot == 0 else cv2.rotate(tmpl, cv2.ROTATE_90_CLOCKWISE)
        th, tw = t.shape
        if th > src.shape[0] or tw > src.shape[1] or float(t.std()) == 0.0:
            continue
        res = cv2.matchTemplate(src, t, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=-1.0, posinf=-1.0, neginf=-1.0)
        k = max(3, int(NMS_SHARE * max(tw, th)) | 1)
        peaks = (res >= s.threshold) & (res == cv2.dilate(res, np.ones((k, k), np.float32)))
        for y, x in zip(*np.nonzero(peaks), strict=True):
            cands.append((-float(res[y, x]), int(y), int(x), rot, tw, th))
    cands.sort()
    kept: list[tuple[float, float, float, int, int, int]] = []
    clean = r.clean
    for neg, y, x, rot, tw, th in cands:
        cx, cy = x + tw / 2 - off, y + th / 2 - off
        if any(math.hypot(cx - a, cy - b) < NMS_SHARE * max(tw, th) for a, b, *_ in kept):
            continue
        kept.append((cx, cy, -neg, rot, tw, th))
    out: list[Hit] = []
    for cx, cy, score, rot, tw, th in kept:
        x0, y0 = round(cx - tw / 2), round(cy - th / 2)
        ib = _ink_box(clean, x0, y0, x0 + tw, y0 + th)
        if ib is None:
            continue
        sides = _sides_in(ib, r, ratio)
        if not same_size(sides, ex_sides):
            continue
        c = r.pt(cx, cy)
        if not (r.crop[0] <= c[0] <= r.crop[2] and r.crop[1] <= c[1] <= r.crop[3]):
            continue
        b0, b1 = r.pt(x0, y0), r.pt(x0 + tw, y0 + th)
        out.append(Hit(c, (b0[0], b0[1], b1[0], b1[1]), round(score, 4), rot,
                       (round(sides[0], 2), round(sides[1], 2))))  # fmt: skip
    out.sort(key=lambda h: (round(h.centre[1], 1), round(h.centre[0], 1)))
    return out


# ---- vector (the stored symbols; the same rule as the API) ----------
def vector_similar(example: dict, symbols: list[dict]) -> list[dict]:
    solid = example["family"] == "unknown" and example.get("solid")
    out = []
    for s in symbols:
        if solid:
            ok = s.get("solid") == example["solid"]
        else:
            ok = s["family"] == example["family"] and s["family"] != "unknown"
        if ok and same_size(tuple(s["real_in"]), tuple(example["real_in"])):
            out.append(s)
    return sorted(out, key=lambda s: (s["centre"][1], s["centre"][0]))


def combine(vector: list[Pt], image: list[tuple[Pt, float, int]], dedup_pt: float) -> list[dict]:
    """Vector matches, then image matches (point, score, rotation) in score order (ties: y, x),
    each kept unless within dedup_pt of one already kept; in (y, x) order. Phase 14e: score order
    (14d took the image matches in (y, x) order), so a match is only ever hidden by a stronger
    one and the preview's strictness filter (score >= t) equals a search at t."""
    out = [{"centre": list(p), "source": "vector", "score": None, "rotation": 0} for p in vector]
    for p, score, rot in sorted(image, key=lambda h: (-h[1], h[0][1], h[0][0])):
        if not any(math.dist(p, o["centre"]) <= dedup_pt for o in out):
            out.append({"centre": list(p), "source": "image", "score": score, "rotation": rot})
    return sorted(out, key=lambda o: (o["centre"][1], o["centre"][0]))


def strict(combined: list[dict], threshold: float) -> list[dict]:
    """The preview at a strictness: the vector matches and the image matches scoring at least it."""
    return [c for c in combined if c["score"] is None or c["score"] >= threshold - 1e-9]


# ---- the Build-time cache of the cleaned ink (Phase 14e) ----------
CACHE_VERSION = 1  # bump when the raster rules or values change


def cache_path(upload_dir: Path, build_run_id: str) -> Path:
    return upload_dir / "cache" / "page_ink" / f"{build_run_id}.npz"


def save_raster(path: Path, r: Raster) -> None:
    """The cleaned ink of a Build's crop (packed bits) with its scale and origin; written to a
    temporary file then moved, so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(
        tmp, bits=np.packbits(r.clean, axis=None), shape=np.array(r.clean.shape),
        meta=np.array([r.z, r.origin[0], r.origin[1], *r.crop, CACHE_VERSION, PX_PER_IN]),
    )  # fmt: skip
    os.replace(tmp, path)


def load_raster(path: Path) -> Raster | None:
    """The cached raster, or None (no file, another version or other settings)."""
    try:
        with np.load(path) as f:
            meta, shape, bits = f["meta"], tuple(int(v) for v in f["shape"]), f["bits"]
    except (OSError, ValueError, KeyError):
        return None
    if int(meta[7]) != CACHE_VERSION or float(meta[8]) != PX_PER_IN:
        return None
    clean = np.unpackbits(bits, count=shape[0] * shape[1]).reshape(shape)
    crop = (float(meta[3]), float(meta[4]), float(meta[5]), float(meta[6]))
    return Raster(np.empty((0, 0), np.uint8), clean, float(meta[0]),
                  (float(meta[1]), float(meta[2])), crop)  # fmt: skip


def _ang(a: Pt, b: Pt) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _clusters(angles: list[tuple[float, float]], by_count: bool = True) -> list[float]:
    """Dominant directions of (angle in [0, 180), weight) pairs: angles within ANGLE_DEDUP_DEG are
    one cluster (weighted mean); kept when it has 15% of the total weight, or (`by_count`) at
    least 2 members."""
    total = sum(w for _a, w in angles)
    out: list[tuple[float, float, int]] = []  # (weighted sum of angle, weight, count) per cluster
    centres: list[float] = []
    for a, w in sorted(angles):
        for k, c in enumerate(centres):
            if _angle_diff(a, c) < ANGLE_DEDUP_DEG:
                sa, sw, n = out[k]
                # unwrap about the cluster centre so 179 and 1 degrees average to 0, not 90
                d = ((a - c + 90.0) % 180.0) - 90.0
                out[k] = (sa + (c + d) * w, sw + w, n + 1)
                centres[k] = (out[k][0] / out[k][1]) % 180.0
                break
        else:
            out.append((a * w, w, 1))
            centres.append(a)
    return [c for c, (_sa, sw, n) in zip(centres, out, strict=True)
            if (by_count and n >= 2) or (total > 0 and sw / total >= 0.15)]  # fmt: skip


def grid_angles(grid: list[tuple[Pt, Pt]]) -> list[float]:
    """The dominant directions of the page's grid lines (degrees in [0, 180))."""
    pairs = []
    for a, b in grid:
        ln = math.dist(a, b)
        if ln > 0:
            pairs.append((_ang(a, b), ln))
    return _clusters(pairs)


def long_line_angles(page: pymupdf.Page, crop: Box, ratio: float) -> list[float]:
    """Fallback when the Build found no grid: the dominant directions of the page's long straight
    lines (at least LONG_LINE_IN real inches, inside the crop), weighted by length."""
    min_pt = LONG_LINE_IN * 72.0 / ratio
    pairs = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] != "l":
                continue
            a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
            if not (crop[0] <= a[0] <= crop[2] and crop[1] <= a[1] <= crop[3]):
                continue
            ln = math.dist(a, b)
            if ln >= min_pt:
                pairs.append((_ang(a, b), ln))
    return _clusters(pairs, by_count=False)  # a few stray lines are not a direction


def search_angles(
    grid: list[tuple[Pt, Pt]] | None,
    ex_angle: float = 0.0,
    fallback: Callable[[], list[float]] | None = None,
) -> list[float]:
    """The absolute column angles searched: 0 and 90, each dominant grid direction and its
    perpendicular (else the page's long-line directions), then the example's own angle and its
    perpendicular; all deduplicated within ANGLE_DEDUP_DEG (the first of a group stays)."""
    cands = [0.0, 90.0]
    dom = grid_angles(grid or [])
    if not dom and fallback is not None:
        dom = fallback()
    for c in dom:
        cands += [c % 180.0, (c + 90.0) % 180.0]
    if abs(ex_angle) >= ANGLE_MIN_DEG:
        cands += [ex_angle % 180.0, (ex_angle + 90.0) % 180.0]
    out: list[float] = []
    for a in cands:
        if all(_angle_diff(a, b) >= ANGLE_DEDUP_DEG for b in out):
            out.append(round(a, 1))
    return out


def _signed(a: float) -> float:
    """A direction mod 90 (symbol_json rotation_deg) as a signed turn in (-45, 45]."""
    a = a % 90.0
    return a if a <= 45.0 else a - 90.0


def search(
    r: Raster,
    ratio: float,
    click: Pt,
    symbols: list[dict],
    s: Settings,
    grid: list[tuple[Pt, Pt]] | None = None,
    fallback: Callable[[], list[float]] | None = None,
) -> Result:
    """Prereg 14d 2.2-2.4 on a rendered crop: the example under the click (a stored vector symbol,
    else the ink), its vector and image matches and both combined (the example included).
    Phase 0-14g: the lookup radius is SNAP_RADIUS_PT. NEVER WORSE THAN MAIN: without a stored
    symbol the example is main's own ink read (`ink_example`: the ink inside the 36 in window),
    always; the checked ink blob (`blob_refusal`) only decides whether the column moves onto its
    centre and whether the result carries `warning == 'unchecked_ink'`. The result is a refusal
    (`refused == 'click_closer'`) only where main also found no example. The image search runs
    at `search_angles` (0 and 90 on an orthogonal grid, as main)."""
    t0 = time.perf_counter()
    vex = vector_example(click, symbols)
    ex_blob: Blob | None = None
    if vex is not None:
        sym_turn = _signed(float(vex.get("rotation_deg") or 0.0))
        if abs(sym_turn) >= ANGLE_MIN_DEG:  # a turned symbol is read from its own ink
            b = ink_blob(r, tuple(vex["centre"]), ratio)
            if b is not None and blob_refusal(b) is None and abs(b.angle) >= ANGLE_MIN_DEG:
                ex_blob = b
        bx = vex["box"]
        p0, p1 = r.px((bx[0], bx[1])), r.px((bx[2], bx[3]))
        box_px = (math.floor(p0[0]), math.floor(p0[1]), math.ceil(p1[0]), math.ceil(p1[1]))
        keys = ("family", "box", "centre", "real_in")
        example = {"source": "vector", **{k: vex[k] for k in keys}, "solid": vex.get("solid")}
        example["angle"] = ex_blob.angle if ex_blob else 0.0
        box_corners = [[bx[0], bx[1]], [bx[2], bx[1]], [bx[2], bx[3]], [bx[0], bx[3]]]
        example["rect"] = [list(c) for c in ex_blob.rect] if ex_blob else box_corners
        vec = vector_similar(vex, symbols)
        if ex_blob:
            box_px = ex_blob.box_px
    else:
        # NEVER WORSE THAN MAIN: the example is main's own ink read (the ink inside the 36 in
        # window), whatever the checked blob says. The blob only decides whether the column is
        # moved onto its centre and whether the screen warns that nothing was checked.
        ib = ink_example(r, click, ratio)  # main's example logic, unchanged
        if ib is None:  # main found none either
            b = ink_blob(r, click, ratio)
            why = "no ink within the radius" if b is None else blob_refusal(b)
            return Result(
                None, runtime_s=time.perf_counter() - t0, z=r.z, refused="click_closer",
                note=f"click closer to the column symbol ({why})",
            )  # fmt: skip
        b0, b1 = r.pt(ib[0], ib[1]), r.pt(ib[2], ib[3])
        corners = [[b0[0], b0[1]], [b1[0], b0[1]], [b1[0], b1[1]], [b0[0], b1[1]]]
        example = {"source": "ink", "family": "unknown", "solid": None,
                   "box": [b0[0], b0[1], b1[0], b1[1]],
                   "centre": [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2],
                   "real_in": list(_sides_in(ib, r, ratio)), "angle": 0.0,
                   "rect": corners}  # fmt: skip
        blob = ink_blob(r, click, ratio)
        checked = blob is not None and blob_refusal(blob) is None
        return _finish(r, ratio, click, symbols, s, grid, fallback, t0, example, [], ib, None,
                       None, None if checked else "unchecked_ink",
                       blob.centre if checked and blob is not None else None)  # fmt: skip
    return _finish(r, ratio, click, symbols, s, grid, fallback, t0, example, vec, box_px,
                   ex_blob, vex, None)  # fmt: skip


def _finish(
    r: Raster, ratio: float, click: Pt, symbols: list[dict], s: Settings,
    grid: list[tuple[Pt, Pt]] | None, fallback: Callable[[], list[float]] | None, t0: float,
    example: dict, vec: list[dict], box_px: tuple[int, int, int, int], ex_blob: Blob | None,
    vex: dict | None, warning: str | None, snap_centre: Pt | None = None,
) -> Result:  # fmt: skip
    """The image search from the example, combined with the vector matches."""
    ex_angle = float(example["angle"])
    angles = search_angles(grid, ex_angle, fallback)
    hits = image_matches(r, box_px, ratio, s, angles, ex_blob)
    long_pt = max(example["box"][2] - example["box"][0], example["box"][3] - example["box"][1])
    image = [(h.centre, h.score, h.rotation) for h in hits]
    comb = combine([tuple(v["centre"]) for v in vec], image, max(DEDUP_MIN_PT, long_pt / 2))
    centre = example["centre"]
    snap = None
    if vex is not None:  # a stored symbol: the screen snapped to its centre
        snap = {"source": "symbol", "centre": list(centre),
                "distance": round(math.dist(click, centre), 2)}  # fmt: skip
    elif snap_centre is not None:  # a checked ink blob: the column may move onto its centre
        snap = {"source": "ink", "centre": list(snap_centre),
                "distance": round(math.dist(click, snap_centre), 2)}  # fmt: skip
    return Result(example, vec, hits, comb, time.perf_counter() - t0, r.z, snap=snap,
                  angles=angles, warning=warning)  # fmt: skip


def find_similar(
    page: pymupdf.Page,
    crop: Box,
    ratio: float,
    click: Pt,
    symbols: list[dict],
    grid: list[tuple[Pt, Pt]],
    s: Settings | None = None,
) -> Result:
    """Render the crop, then `search` (the runtime includes the render, as 14d measured it)."""
    s = s or Settings()
    t0 = time.perf_counter()
    r = render(page, crop, ratio, grid, s)
    res = search(r, ratio, click, symbols, s)
    res.runtime_s = time.perf_counter() - t0
    return res
