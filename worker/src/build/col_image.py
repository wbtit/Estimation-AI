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

import math
import time
from dataclasses import dataclass, field

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
CLICK_PT = 12.0  # the example: a symbol / ink within this of the click
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


# ---- matching ----------
def _source(r: Raster, s: Settings) -> np.ndarray:
    if s.edges:
        return (cv2.Canny(r.gray, CANNY_LO, CANNY_HI) > 0).astype(np.float32)
    return r.clean.astype(np.float32)


def image_matches(
    r: Raster, box_px: tuple[int, int, int, int], ratio: float, s: Settings
) -> list[Hit]:
    """Template matches of the example box (+ margin) at 0 and 90 degrees, after non-max
    suppression and the real-size check, in (y, x) order."""
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


def combine(vector: list[Pt], image: list[Pt], dedup_pt: float) -> list[dict]:
    """Vector matches, then image matches not within dedup_pt of one already kept."""
    out = [{"centre": list(p), "source": "vector"} for p in vector]
    for p in image:
        if not any(math.dist(p, o["centre"]) <= dedup_pt for o in out):
            out.append({"centre": list(p), "source": "image"})
    return sorted(out, key=lambda o: (o["centre"][1], o["centre"][0]))


def find_similar(
    page: pymupdf.Page,
    crop: Box,
    ratio: float,
    click: Pt,
    symbols: list[dict],
    grid: list[tuple[Pt, Pt]],
    s: Settings | None = None,
) -> Result:
    """Prereg 14d: the example under the click (a stored vector symbol, else the ink), its vector
    and image matches and both combined (the example itself included)."""
    s = s or Settings()
    t0 = time.perf_counter()
    r = render(page, crop, ratio, grid, s)
    vex = vector_example(click, symbols)
    if vex is not None:
        bx = vex["box"]
        p0, p1 = r.px((bx[0], bx[1])), r.px((bx[2], bx[3]))
        box_px = (math.floor(p0[0]), math.floor(p0[1]), math.ceil(p1[0]), math.ceil(p1[1]))
        keys = ("family", "box", "centre", "real_in")
        example = {"source": "vector", **{k: vex[k] for k in keys}, "solid": vex.get("solid")}
        vec = vector_similar(vex, symbols)
    else:
        ib = ink_example(r, click, ratio)
        if ib is None:
            return Result(
                None, runtime_s=time.perf_counter() - t0, z=r.z, note="no symbol under the click"
            )
        box_px = ib
        b0, b1 = r.pt(ib[0], ib[1]), r.pt(ib[2], ib[3])
        example = {"source": "ink", "family": "unknown", "solid": None,
                   "box": [b0[0], b0[1], b1[0], b1[1]],
                   "centre": [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2],
                   "real_in": list(_sides_in(ib, r, ratio))}  # fmt: skip
        vec = []
    hits = image_matches(r, box_px, ratio, s)
    long_pt = max(example["box"][2] - example["box"][0], example["box"][3] - example["box"][1])
    comb = combine([tuple(v["centre"]) for v in vec], [h.centre for h in hits],
                   max(DEDUP_MIN_PT, long_pt / 2))  # fmt: skip
    return Result(example, vec, hits, comb, time.perf_counter() - t0, r.z)
