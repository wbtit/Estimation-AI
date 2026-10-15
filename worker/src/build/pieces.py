"""Steps 9 and 10: length, elevations, colour state and stable ids of the built pieces.

Length = support-to-support distance on the page x the confirmed scale (pt x 25.4/72 x ratio). The
resolved end points are written in the page's plan frame in mm (x right, y up, origin at the page
origin) with z = the page T.O.S. at both ends, so the existing BOM length (3D distance of the end
points) equals the support-to-support length. Colour state:
  found         sized and supported at both ends;
  needs_review  inferred size, or one end unsupported;
  attention     undefined size, or no support at all.
Ids are stable: a hash of the sheet, the kind and the piece's end points rounded to STABLE_ROUND_PT
(order-free), so a rebuild of an unchanged page gives the same ids.
"""

from __future__ import annotations

import hashlib
import math

from src.build.geom import Pt

MM_PER_PT = 25.4 / 72.0
STABLE_ROUND_PT = 1.0


def length_mm(a: Pt, b: Pt, ratio: float) -> float:
    return math.dist(a, b) * MM_PER_PT * ratio


def plan_mm(p: Pt, ratio: float) -> Pt:
    k = MM_PER_PT * ratio
    return (p[0] * k, -p[1] * k)


def build_state(size_state: str, support_state: str) -> str:
    if size_state == "undefined" or support_state == "none":
        return "attention"
    if size_state == "inferred" or support_state == "one":
        return "needs_review"
    return "found"


def _key(p: Pt) -> tuple[int, int]:
    return (round(p[0] / STABLE_ROUND_PT), round(p[1] / STABLE_ROUND_PT))


def stable_member_id(sheet_id: str, kind: str, a: Pt, b: Pt | None = None) -> str:
    pts = sorted([_key(a)] + ([_key(b)] if b is not None else []))
    raw = f"{sheet_id}|{kind}|{pts}"
    prefix = "LF-C-" if b is None else "LF-B-"
    return prefix + hashlib.sha1(raw.encode()).hexdigest()[:16]
