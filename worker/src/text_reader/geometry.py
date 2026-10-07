"""Glyph geometry: normalisation, resampling and the distance used to compare shapes.

The tolerances are the ones measured in Phase 4a (docs/PHASE4A_FINDINGS.md section 3.3) and are
fixed constants. They are not tuned on any evaluation set.
"""

import hashlib
import json
import math
from dataclasses import dataclass

import numpy as np

Point = tuple[float, float]
Strokes = list[list[Point]]

CHAMFER_TOL = 0.03  # symmetric mean nearest-point distance, as a fraction of glyph size
HAUSDORFF_TOL = 0.10  # symmetric maximum nearest-point distance, as a fraction of glyph size
N_POINTS = 64  # points per resampled glyph


@dataclass(frozen=True)
class Descriptor:
    """A glyph normalised for translation and scale, resampled to N_POINTS."""

    points: np.ndarray  # (N_POINTS, 2), in the unit box anchored at the glyph's min corner
    extent: tuple[float, float]  # (width, height) after normalisation, each in [0, 1]
    key: tuple  # coarse hashable key to de-duplicate near-identical clusters

    __hash__ = None  # type: ignore[assignment]  # ndarray field: identify by `key`


def bounds(strokes: Strokes) -> tuple[float, float, float, float]:
    xs = [x for s in strokes for x, _ in s]
    ys = [y for s in strokes for _, y in s]
    return min(xs), min(ys), max(xs), max(ys)


def normalise(strokes: Strokes) -> Strokes:
    """Translate to the min corner and divide by the larger dimension (aspect ratio is kept)."""
    x0, y0, x1, y1 = bounds(strokes)
    size = max(x1 - x0, y1 - y0)
    if size < 1e-9:
        size = 1.0
    return [[((x - x0) / size, (y - y0) / size) for x, y in s] for s in strokes]


def resample(strokes: Strokes, n: int = N_POINTS) -> np.ndarray:
    """n points evenly spaced by arc length along all strokes (gaps between strokes are skipped)."""
    segments: list[tuple[Point, Point]] = []
    for s in strokes:
        pts = s if len(s) > 1 else [s[0], s[0]]
        segments.extend(zip(pts[:-1], pts[1:], strict=True))
    lengths = np.array([math.dist(a, b) for a, b in segments])
    total = float(lengths.sum())
    if total < 1e-12:
        return np.tile(np.array(segments[0][0], dtype=float), (n, 1))
    cum = np.concatenate([[0.0], np.cumsum(lengths)])
    targets = np.linspace(0.0, total, n)
    idx = np.clip(np.searchsorted(cum, targets, side="right") - 1, 0, len(segments) - 1)
    a = np.array([segments[i][0] for i in idx], dtype=float)
    b = np.array([segments[i][1] for i in idx], dtype=float)
    seg_len = np.where(lengths[idx] > 0, lengths[idx], 1.0)
    t = ((targets - cum[idx]) / seg_len)[:, None]
    return a + t * (b - a)


def describe(strokes: Strokes) -> Descriptor:
    norm = normalise(strokes)
    pts = resample(norm)
    w, h = bounds(norm)[2:]
    key = (tuple(np.round(pts[::4] * 100).astype(int).ravel().tolist()), round(w, 2), round(h, 2))
    return Descriptor(points=pts, extent=(float(w), float(h)), key=key)


def distances(candidates: np.ndarray, probe: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(chamfer, hausdorff) of probe (N,2) against each candidate (K,N,2)."""
    d = np.sqrt(((candidates[:, :, None, :] - probe[None, None, :, :]) ** 2).sum(-1))
    to_probe = d.min(2)  # each candidate point -> nearest probe point
    to_cand = d.min(1)  # each probe point -> nearest candidate point
    chamfer = np.maximum(to_probe.mean(1), to_cand.mean(1))
    hausdorff = np.maximum(to_probe.max(1), to_cand.max(1))
    return chamfer, hausdorff


def signature_hash(strokes: Strokes) -> str:
    """Stable id of a normalised glyph: sha-256 of its strokes rounded to 1/1000."""
    norm = [[[round(x, 3), round(y, 3)] for x, y in s] for s in normalise(strokes)]
    return hashlib.sha256(json.dumps(norm, separators=(",", ":")).encode()).hexdigest()


def rounded_strokes(strokes: Strokes) -> list[list[list[float]]]:
    return [[[round(x, 3), round(y, 3)] for x, y in s] for s in normalise(strokes)]
