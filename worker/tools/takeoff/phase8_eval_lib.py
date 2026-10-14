"""Phase 8 Part A: pure helpers for the quantity-level evaluation (docs/PHASE8_PREREGISTRATION.md).

No file, database or network access here; the driver feeds these functions. Synthetic tests only.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping

FAMILY_OF_SHAPE = {
    "HSS": "HSS",
    "WF": "W",
    "W": "W",
    "C": "C",
    "L": "L",
    "HP": "HP",
    "M": "M",
    "S": "S",
    "MC": "MC",
    "T": "T",
    "WT": "WT",
    "PL": "PL",
}
_SIZE = re.compile(r"^\s*\d+(\.\d+)?(\s*[xX]\s*\d+(\.\d+)?(/\d+)?|\s*[xX]\s*\d+/\d+)+\s*$")


def num(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def canonical_size(shape: str | None, size: str | None) -> str | None:
    """`HSS` + `12X12X3/8` -> `HSS12X12X3/8`; `WF` + `12X26` -> `W12X26`; None when the row is not a
    profile row (no known shape code, or a size that is not a dimension pattern)."""
    fam = FAMILY_OF_SHAPE.get((shape or "").strip().upper())
    if fam is None or not size:
        return None
    s = re.sub(r"\s+", "", size.upper())
    if fam == "PL":
        return "PL:" + s
    if not _SIZE.match(size):
        return None
    return fam + s


def ref_tokens(cell: str | None) -> list[str]:
    """The sheet part of each comma-separated `detail/sheet` reference, letters and digits only."""
    out = []
    for part in (cell or "").split(","):
        if "/" not in part:
            continue
        tail = re.sub(r"[^A-Z0-9]", "", part.split("/")[-1].upper())
        if tail:
            out.append(tail)
    return out


def norm(text: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def in_corner(
    x0: float, y0: float, x1: float, y1: float, w: float, h: float, frac: float = 0.7
) -> bool:
    """The centre of a text line lies in the lower-right corner (above `frac` of both extents)."""
    return (x0 + x1) / 2 / w > frac and (y0 + y1) / 2 / h > frac


def map_tokens(
    tokens: Iterable[str],
    lines_by_page: Mapping[int, list[tuple[str, float, float, float, float]]],
    sizes: Mapping[int, tuple[float, float]],
) -> dict[str, int | None]:
    """token -> page index when exactly one page has a whole text line equal to it in the corner."""
    out: dict[str, int | None] = {}
    for tok in tokens:
        pages = set()
        for p, lines in lines_by_page.items():
            w, h = sizes[p]
            if any(
                norm(t) == tok and in_corner(x0, y0, x1, y1, w, h) for t, x0, y0, x1, y1 in lines
            ):
                pages.add(p)
        out[tok] = next(iter(pages)) if len(pages) == 1 else None
    return out


def group_metrics(theirs: Mapping, ours: Mapping) -> dict:
    """Exact, within 1 and within 20% shares over theirs keys and over the union of keys, the
    quantity error rate, and the sizes (keys) only one side has. Keys with quantity 0 are dropped."""
    t = {k: v for k, v in theirs.items() if v > 0}
    o = {k: v for k, v in ours.items() if v > 0}
    keys = sorted(set(t) | set(o), key=str)

    def shares(ks: list) -> dict:
        n = len(ks)
        if n == 0:
            return {"n": 0, "exact": None, "within1": None, "within20": None}
        ex = w1 = w20 = 0
        for k in ks:
            a, b = o.get(k, 0), t.get(k, 0)
            ex += a == b
            w1 += abs(a - b) <= 1
            w20 += b >= 1 and abs(a - b) <= 0.2 * b
        return {"n": n, "exact": ex / n, "within1": w1 / n, "within20": w20 / n}

    tot_t = sum(t.values())
    only_t = [k for k in t if k not in o]
    only_o = [k for k in o if k not in t]
    return {
        "theirs_keys": shares(sorted(t, key=str)),
        "union_keys": shares(keys),
        "error_rate": (sum(abs(o.get(k, 0) - t.get(k, 0)) for k in keys) / tot_t)
        if tot_t
        else None,
        "theirs_total": tot_t,
        "ours_total": sum(o.values()),
        "missed": {
            "n": len(only_t),
            "share_of_theirs_qty": (sum(t[k] for k in only_t) / tot_t) if tot_t else None,
        },
        "extra": {
            "n": len(only_o),
            "share_of_ours_qty": (sum(o[k] for k in only_o) / sum(o.values())) if o else None,
        },
    }


def weight_total(
    by_size: Mapping[str, float], weights: Mapping[str, float]
) -> tuple[float, list[str]]:
    """Sum of quantity times unit weight (lb/ft) over sizes with a catalog weight; the others listed."""
    total = 0.0
    missing = []
    for size, q in by_size.items():
        w = weights.get(size)
        if w is None:
            missing.append(size)
        else:
            total += q * w
    return total, sorted(missing)


def weight_error(
    theirs_by_size: Mapping[str, float],
    ours_by_size: Mapping[str, float],
    weights: Mapping[str, float],
) -> dict:
    # a size without a weight is left out of BOTH sums
    miss = {s for s in set(theirs_by_size) | set(ours_by_size) if s not in weights}
    t, _ = weight_total({k: v for k, v in theirs_by_size.items() if k not in miss}, weights)
    o, _ = weight_total({k: v for k, v in ours_by_size.items() if k not in miss}, weights)
    return {
        "theirs": t,
        "ours": o,
        "signed": (o - t) / t if t else None,
        "absolute": abs(o - t) / t if t else None,
        "sizes_without_weight": sorted(miss),
    }


def reading(within20_share: float | None, abs_weight_error: float | None) -> str:
    """The pre-registered reading on G1 (S1)."""
    if within20_share is None or abs_weight_error is None:
        return "not usable"
    if within20_share >= 0.70 and abs_weight_error <= 0.10:
        return "usable as a first draft"
    if within20_share >= 0.40 and abs_weight_error <= 0.25:
        return "partial"
    return "not usable"
