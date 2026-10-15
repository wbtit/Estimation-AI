"""Step 5b: page-to-plan registration from matched grid lines, and columns projected through it.

The plan frame is the column plan page in mm (x right, y up, from its own confirmed scale). A page
is put in the same frame by a rigid transform (rotation + translation; the scale comes from each
page's confirmed scale, it is not fitted): plan = R(theta) * page_mm + t. Grid lines match by exact
label (and family). At least REG_MIN_MATCHED matched lines in at least two directions are needed
(fewer, or all parallel: no registration, recorded on the build run, and the build goes on with
glyph and girder supports only). theta = the mean direction difference of the matched lines; t
solves the line constraints n . (R a + t) = n . b by least squares. If the RMS residual exceeds
REG_MAX_RESIDUAL_MM the registration is refused too (likely a different grid or a wrong scale).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from src.build.geom import Pt
from src.build.grids import GridLine

MM_PER_PT = 25.4 / 72.0
REG_MIN_MATCHED = 2
REG_MIN_DIRECTION_SPREAD_DEG = 30.0
REG_MAX_RESIDUAL_MM = 150.0


def to_mm(p: Pt, ratio: float) -> Pt:
    k = MM_PER_PT * ratio
    return (p[0] * k, -p[1] * k)


def from_mm(p: Pt, ratio: float) -> Pt:
    k = MM_PER_PT * ratio
    return (p[0] / k, -p[1] / k)


@dataclass
class Registration:
    ok: bool
    reason: str | None  # why there is none: too_few_matched, parallel_only, residual_too_large
    matched: list[str] = field(default_factory=list)
    theta_deg: float = 0.0
    tx: float = 0.0
    ty: float = 0.0
    residual_mm: float | None = None

    def page_to_plan(self, p_mm: Pt) -> Pt:
        c, s = math.cos(math.radians(self.theta_deg)), math.sin(math.radians(self.theta_deg))
        return (c * p_mm[0] - s * p_mm[1] + self.tx, s * p_mm[0] + c * p_mm[1] + self.ty)

    def plan_to_page(self, q_mm: Pt) -> Pt:
        c, s = math.cos(math.radians(self.theta_deg)), math.sin(math.radians(self.theta_deg))
        x, y = q_mm[0] - self.tx, q_mm[1] - self.ty
        return (c * x + s * y, -s * x + c * y)

    def to_json(self) -> dict:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "matched": self.matched,
            "theta_deg": round(self.theta_deg, 4),
            "tx_mm": round(self.tx, 1),
            "ty_mm": round(self.ty, 1),
            "residual_mm": None if self.residual_mm is None else round(self.residual_mm, 1),
        }


def identity() -> Registration:
    return Registration(True, None, [], 0.0, 0.0, 0.0, 0.0)


def _dir(g: GridLine, ratio: float) -> tuple[Pt, float]:
    a, b = to_mm(g.p0, ratio), to_mm(g.p1, ratio)
    return a, math.atan2(b[1] - a[1], b[0] - a[0])


def register(
    page_lines: list[GridLine], page_ratio: float, plan_lines: list[GridLine], plan_ratio: float
) -> Registration:
    plan_by = {(g.family, g.label): g for g in plan_lines}
    pairs = [
        (g, plan_by[(g.family, g.label)])
        for g in sorted(page_lines, key=lambda x: (x.family, x.label))
        if (g.family, g.label) in plan_by
    ]
    names = [g.label for g, _ in pairs]
    if len(pairs) < REG_MIN_MATCHED:
        return Registration(False, "too_few_matched", names)
    # rotation: mean of the direction differences (directions mod 180, doubled-angle mean)
    diffs = []
    plan_dirs = []
    for g, h in pairs:
        _, ag = _dir(g, page_ratio)
        _, ah = _dir(h, plan_ratio)
        diffs.append(2 * (ah - ag))
        plan_dirs.append(ah)
    spread = max(
        min(abs(math.degrees(a - b)) % 180.0, 180.0 - abs(math.degrees(a - b)) % 180.0)
        for a in plan_dirs
        for b in plan_dirs
    )
    if spread < REG_MIN_DIRECTION_SPREAD_DEG:
        return Registration(False, "parallel_only", names)
    theta = 0.5 * math.atan2(sum(math.sin(d) for d in diffs), sum(math.cos(d) for d in diffs))
    c, s = math.cos(theta), math.sin(theta)
    rows, rhs = [], []
    for g, h in pairs:
        a, _ = _dir(g, page_ratio)
        b, ah = _dir(h, plan_ratio)
        n = (-math.sin(ah), math.cos(ah))
        ra = (c * a[0] - s * a[1], s * a[0] + c * a[1])
        rows.append(n)
        rhs.append(n[0] * (b[0] - ra[0]) + n[1] * (b[1] - ra[1]))
    A = np.asarray(rows, dtype=float)
    y = np.asarray(rhs, dtype=float)
    t, *_ = np.linalg.lstsq(A, y, rcond=None)
    residual = float(np.sqrt(np.mean((A @ t - y) ** 2)))
    reg = Registration(True, None, names, math.degrees(theta), float(t[0]), float(t[1]), residual)
    if residual > REG_MAX_RESIDUAL_MM:
        reg.ok, reg.reason = False, "residual_too_large"
    return reg


def project_columns(
    plan_columns_pt: list[Pt], plan_ratio: float, reg: Registration, page_ratio: float
) -> list[Pt]:
    """Column points of the column plan page, in this page's displayed points."""
    out = []
    for p in plan_columns_pt:
        q = to_mm(p, plan_ratio)
        out.append(from_mm(reg.plan_to_page(q), page_ratio))
    return out
