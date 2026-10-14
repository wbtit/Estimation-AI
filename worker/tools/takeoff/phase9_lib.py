"""Phase 9 Parts B and C: pure helpers (docs/PHASE9_PREREGISTRATION.md).

No file, database or network access here; the drivers feed these functions. Synthetic tests only.
"""

from __future__ import annotations

import html
import math
import re
from collections.abc import Iterable, Mapping, Sequence

_N = r"\d+(?:\.\d+)?(?:[-\s]\d+/\d+|/\d+)?"  # 12, 3.5, 3/8, 3-1/2, 3 1/2
_X = r"\s*[xX×]\s*"
_Q = r"\s*[\"']?"  # an optional inch or foot mark after a dimension
_LEN = _N + r"[\"']?(?:\s*-\s*" + _N + r"[\"']?)?"  # a plate length such as 12", 1'-0"
_B = r"(?<![A-Za-z0-9])"  # no letter or digit before the family letters

CLASSES: dict[str, str] = {
    "wide-flange": _B + r"(?:WT|MT|ST|HP|W|M|S)\s*" + _N + _X + _N,
    "channel": _B + r"(?:MC|C)\s*" + _N + _X + _N,
    "angle": _B + r"L\s*" + _N + _Q + _X + _N + _Q + _X + _N,
    "hollow": _B + r"(?:HSS|TS)\s*" + _N + _X + _N + r"(?:" + _X + _N + r")?",
    "pipe": _B
    + r"(?:PIPE\s*"
    + _N
    + r"(?:"
    + _X
    + _N
    + r")?(?:\s*(?:STD|XXS|XS))?|P\s*"
    + _N
    + r"\s*(?:STD|XXS|XS))",
    "plate-bar": _B
    + r"(?:PLATE|PL|BAR|FB)\s*"
    + _N
    + _Q
    + _X
    + _N
    + _Q
    + r"(?:"
    + _X
    + _LEN
    + r")?",
}
_FAMILY_RE = {k: re.compile(v, re.IGNORECASE) for k, v in CLASSES.items()}
_DIMS_ONLY = re.compile(_B + _N + _X + _N + r"(?:" + _X + _N + r")?(?![A-Za-z0-9])")


def size_classes(value: str | None, *, whole: bool) -> set[str]:
    """The steel-size classes the value matches: the whole trimmed value (`whole`) or as a token."""
    if not value:
        return set()
    v = value.strip()
    out = set()
    for name, rx in _FAMILY_RE.items():
        m = rx.fullmatch(v) if whole else rx.search(v)
        if m:
            out.add(name)
    return out


def dims_only(value: str | None, *, whole: bool) -> bool:
    """A bare dimension pair (no family letters); only counted when no family class matches."""
    if not value or size_classes(value, whole=whole):
        return False
    v = value.strip()
    return bool(_DIMS_ONLY.fullmatch(v) if whole else _DIMS_ONLY.search(v))


def canonical_from_text(value: str) -> str | None:
    """The first size in a text, in the Phase 8 canonical form (`W12X26`, `HSS12X12X3/8`,
    `PL:...`), or None. Spaces, quotes and case are removed; `x` becomes `X`."""
    best: tuple[int, str, str] | None = None
    for name, rx in _FAMILY_RE.items():
        m = rx.search(value)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name, m.group(0))
    if best is None:
        return None
    _, name, tok = best
    s = re.sub(r"[\s\"']", "", tok.upper()).replace("×", "X")
    if name == "plate-bar":
        s = re.sub(r"^(PLATE|PL|BAR|FB)", "", s)
        return "PL:" + s
    if name == "pipe":
        return s
    return s


# --- PDF strings ------------------------------------------------------------------------------


def parse_pdf_strings(raw: str | None) -> list[str]:
    """The strings of a PDF array literal like `[(a)()(0.00)<4142>]` in order. Parentheses nest,
    a backslash escapes, `<hex>` is a hex string. Anything else is skipped."""
    out: list[str] = []
    if not raw:
        return out
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        if c == "(":
            depth, i, buf = 1, i + 1, []
            while i < n and depth:
                ch = raw[i]
                if ch == "\\" and i + 1 < n:
                    nxt = raw[i + 1]
                    buf.append({"n": "\n", "r": "\r", "t": "\t"}.get(nxt, nxt))
                    i += 2
                    continue
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                buf.append(ch)
                i += 1
            out.append("".join(buf))
            continue
        if c == "<" and not raw.startswith("<<", i):
            j = raw.find(">", i)
            if j < 0:
                break
            hx = re.sub(r"\s", "", raw[i + 1 : j])
            if len(hx) % 2:
                hx += "0"
            try:
                b = bytes.fromhex(hx)
                out.append(
                    b[2:].decode("utf-16-be", "replace")
                    if b[:2] == b"\xfe\xff"
                    else b.decode("latin-1")
                )
            except ValueError:
                out.append("")
            i = j + 1
            continue
        i += 1
    return out


def rich_text_plain(raw: str | None) -> str:
    """Text of an XHTML rich-text entry: tags removed, entities decoded, spaces collapsed."""
    if not raw:
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


# --- field summaries ----------------------------------------------------------------------------


def value_kind(value: str | None) -> str:
    """empty / numeric / short code (no space, up to 12 characters) / text."""
    v = (value or "").strip()
    if not v:
        return "empty"
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", v):
        return "numeric"
    if len(v) <= 12 and " " not in v:
        return "short code"
    return "text"


def summarize_values(values: Iterable[str | None]) -> dict:
    """Counts only: filled share, distinct values, kind shares and the size-pattern shares among
    the filled values. The values themselves are never returned."""
    vals = [(v or "").strip() for v in values]
    n = len(vals)
    filled = [v for v in vals if v]
    kinds: dict[str, int] = {}
    for v in filled:
        k = value_kind(v)
        kinds[k] = kinds.get(k, 0) + 1
    whole = {}
    contains = {}
    for v in filled:
        for c in size_classes(v, whole=True):
            whole[c] = whole.get(c, 0) + 1
        for c in size_classes(v, whole=False):
            contains[c] = contains.get(c, 0) + 1
    any_whole = sum(1 for v in filled if size_classes(v, whole=True))
    any_contains = sum(1 for v in filled if size_classes(v, whole=False))
    dims = sum(1 for v in filled if dims_only(v, whole=True))
    return {
        "n": n,
        "filled": len(filled),
        "distinct": len(set(filled)),
        "kinds": kinds,
        "whole": whole,
        "contains": contains,
        "any_whole": any_whole,
        "any_contains": any_contains,
        "dims_only_whole": dims,
    }


def merge_summaries(parts: Sequence[Mapping]) -> dict:
    """Add counts of several `summarize_values` results (distinct values cannot be added: the sum
    of the per-file distinct counts is returned as `distinct_sum`)."""
    out: dict = {
        "n": 0,
        "filled": 0,
        "distinct_sum": 0,
        "kinds": {},
        "whole": {},
        "contains": {},
        "any_whole": 0,
        "any_contains": 0,
        "dims_only_whole": 0,
    }
    for p in parts:
        for k in ("n", "filled", "any_whole", "any_contains", "dims_only_whole"):
            out[k] += p[k]
        out["distinct_sum"] += p["distinct"]
        for f in ("kinds", "whole", "contains"):
            for k, v in p[f].items():
                out[f][k] = out[f].get(k, 0) + v
    return out


def qualifies(per_file_share: Mapping[str, float | None], *, share: float, min_files: int) -> bool:
    """The pre-registered rule: at least `share` of the markups carry a whole-value size in at least
    `min_files` files (a file with no markups of the kind has share None and does not count)."""
    return sum(1 for s in per_file_share.values() if s is not None and s >= share) >= min_files


# --- geometry for Part C ---------------------------------------------------------------------


def parallel_lines_in_region(
    anchor: Sequence[float],
    lines: Sequence[Sequence[float]],
    half_width: float,
    *,
    min_length_share: float = 0.5,
    max_angle_deg: float = 3.0,
    end_extension: float = 0.10,
    klass: Sequence | None = None,
    anchor_klass=None,
) -> int:
    """Number of lines (the anchor included) that are parallel to the anchor within `max_angle_deg`,
    at least `min_length_share` of its length, of the anchor's stroke class (when classes are given),
    and whose centre lies in the region: along the anchor's extent extended by `end_extension` at
    both ends and within `half_width` across it. Lines are [x0, y0, x1, y1]."""
    ax0, ay0, ax1, ay1 = anchor[:4]
    alen = math.hypot(ax1 - ax0, ay1 - ay0)
    if alen <= 0:
        return 0
    ux, uy = (ax1 - ax0) / alen, (ay1 - ay0) / alen
    cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    count = 0
    for i, ln in enumerate(lines):
        x0, y0, x1, y1 = ln[:4]
        ln_len = math.hypot(x1 - x0, y1 - y0)
        if ln_len < min_length_share * alen:
            continue
        if klass is not None and klass[i] != anchor_klass:
            continue
        cosang = abs((x1 - x0) * ux + (y1 - y0) * uy) / ln_len
        if math.degrees(math.acos(min(1.0, cosang))) > max_angle_deg:
            continue
        mx, my = (x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy
        along = mx * ux + my * uy
        across = -mx * uy + my * ux
        if abs(along) <= alen * (0.5 + end_extension) and abs(across) <= half_width:
            count += 1
    return count


def ratio_band(ratio: float | None, lo: float = 0.8, hi: float = 1.25) -> str:
    if ratio is None:
        return "n/a"
    return "in band" if lo <= ratio <= hi else ("below" if ratio < lo else "above")
