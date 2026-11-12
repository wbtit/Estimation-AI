"""Profile labels of a page (Phase 0 profile from callout).

Pure functions plus one catalog reader. The text lines of a page become `PageLabel`s: every profile
expression (text_layer/parsers/profile.py, catalog-validated), every joist designation, with the
flags EXISTING "(E)", TYPICAL "TYP", a mark tag ("BP1") and the far ends of the leader lines that
start at the label. `link_point` gives a column (a point) its label with a method, a confidence
and a reason; `typical_for` applies the TYP rule (profile_config.TYP_SCOPE). The same rules are in
api/src/review/profile-link.ts (a shared case file keeps them equal).
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field
from typing import Any

from src.build import profile_config as cfg
from src.build.segments import TextLine
from src.text_layer.parsers.profile import CatalogMatcher, find_profiles

EXISTING_RE = re.compile(r"\(\s*E\s*\)|\bEXIST(?:ING)?\b", re.IGNORECASE)
TYPICAL_RE = re.compile(r"\bTYP(?:ICAL)?\b\.?", re.IGNORECASE)
TAG_RE = re.compile(r"(?<![A-Za-z0-9./-])([A-Z]{1,3}-?\d{1,3}[A-Z]?)(?![A-Za-z0-9/])")
COLUMN_FAMILIES = ("W", "HSS", "HP", "PIPE", "S", "M")
Pt = tuple[float, float]
Box = tuple[float, float, float, float]


@dataclass
class PageLabel:
    text: str
    raw: str
    canonical: str | None
    family: str  # W, HSS, ..., or JOIST
    kind: str  # profile | joist
    box: Box
    flags: tuple[str, ...] = ()
    tag: str | None = None
    valid: bool = False
    catalog_name: str | None = None
    leaders: list[Pt] = field(default_factory=list)
    id: str | None = None  # the stored row id, when known

    @property
    def typical(self) -> bool:
        return "typical" in self.flags

    @property
    def existing(self) -> bool:
        return "existing" in self.flags

    @property
    def centre(self) -> Pt:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)

    @property
    def column_family(self) -> bool:
        return self.kind == "profile" and self.family in COLUMN_FAMILIES


class CatalogIndex:
    """AISC names with a weight > 0 of the catalog edition the API uses (CATALOG_EDITION, else the
    latest imported). `None` conn: no catalog (every label is invalid: "catalog not loaded")."""

    def __init__(self, conn: Any | None) -> None:
        names: list[str] | None = None
        self.weights: dict[str, float] = {}
        self.edition: str | None = None
        if conn is not None:
            edition = os.environ.get("CATALOG_EDITION")
            if not edition:
                row = conn.execute(
                    "SELECT edition FROM catalog_shapes ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
                edition = row["edition"] if row else None
            if edition:
                self.edition = edition
                rows = conn.execute(
                    "SELECT shape_name, weight_kg_per_m FROM catalog_shapes WHERE edition = %s",
                    (edition,),
                ).fetchall()
                names = [r["shape_name"] for r in rows]
                self.weights = {
                    r["shape_name"]: float(r["weight_kg_per_m"])
                    for r in rows
                    if r["weight_kg_per_m"] is not None
                }
        self.matcher = CatalogMatcher(names)

    def check(self, profile: Any) -> tuple[bool, str | None]:
        v = self.matcher.validate(profile)
        if v.status == "unvalidated" or v.catalog_name is None:
            return False, None
        return self.weights.get(v.catalog_name, 0.0) > 0.0, v.catalog_name


def _box_dist(p: Pt, box: Box) -> float:
    dx = max(box[0] - p[0], 0.0, p[0] - box[2])
    dy = max(box[1] - p[1], 0.0, p[1] - box[3])
    return math.hypot(dx, dy)


def _leader_ends(box: Box, segments: list[tuple[float, float, float, float]]) -> list[Pt]:
    """Far ends of segments that start at the label box (LEADER_LABEL_PT), shortest first."""
    out: list[tuple[float, Pt]] = []
    for x0, y0, x1, y1 in segments:
        ln = math.hypot(x1 - x0, y1 - y0)
        if ln < cfg.LEADER_MIN_PT:
            continue
        for a, b in (((x0, y0), (x1, y1)), ((x1, y1), (x0, y0))):
            if _box_dist(a, box) <= cfg.LEADER_LABEL_PT and _box_dist(b, box) > cfg.LEADER_LABEL_PT:
                out.append((ln, (round(b[0], 2), round(b[1], 2))))
    out.sort()
    return [p for _, p in out[: cfg.LEADER_MAX_PER_LABEL]]


def read_page_labels(
    text: list[TextLine],
    segments: list[tuple[float, float, float, float]] | None = None,
    catalog: CatalogIndex | None = None,
) -> list[PageLabel]:
    """Every profile and joist label of the text lines, in reading order of the lines."""
    from src.build.labels import JOIST_RE  # the Phase 12b joist pattern

    out: list[PageLabel] = []
    for t in text:
        flags = []
        if EXISTING_RE.search(t.text):
            flags.append("existing")
        if TYPICAL_RE.search(t.text):
            flags.append("typical")
        profiles = find_profiles(t.text)
        if profiles:
            rest = t.text
            for p in profiles:
                rest = rest.replace(p.raw, " ")
            m = TAG_RE.search(rest)
            for p in profiles:
                valid, name = catalog.check(p) if catalog else (False, None)
                # a catalog match is stored under the catalog's own name (HSS12X12X.375 and
                # HSS12X12X3/8 are one profile); an unknown profile keeps the parsed form
                lb = PageLabel(
                    t.text, p.raw, name if valid and name else p.canonical, p.family,
                    "profile", t.box, tuple(flags), m.group(1) if m else None, valid, name,
                )  # fmt: skip
                out.append(lb)
        else:
            j = JOIST_RE.search(t.text)
            if j:
                raw = re.sub(r"\s+", "", j.group(0)).upper()
                out.append(PageLabel(t.text, raw, None, "JOIST", "joist", t.box, (*flags, "joist")))
    if segments:
        for lb in out:
            lb.leaders = _leader_ends(lb.box, segments)
    return out


@dataclass
class Link:
    label: PageLabel | None
    method: str | None  # leader | beside | typical | None
    confidence: str | None  # high | medium | low
    reason: str
    competitor: str | None = None  # the other profile that was close

    def evidence(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "confidence": self.confidence,
            "reason": self.reason,
            "competitor": self.competitor,
            "valid": None if self.label is None else self.label.valid,
            "existing": bool(self.label and self.label.existing),
        }


def link_point(point: Pt, box: Box | None, labels: list[PageLabel]) -> Link:
    """The column label of a column at `point` (box: its symbol box). A leader that ends at the
    column wins; else the nearest column label within COLUMN_LABEL_MAX_PT; the confidence says
    how clear the choice is."""
    cols = [lb for lb in labels if lb.column_family]
    bx = box or (point[0], point[1], point[0], point[1])
    hit = [lb for lb in cols if any(_box_dist(e, bx) <= cfg.LEADER_COLUMN_PT for e in lb.leaders)]
    if hit:
        hit.sort(key=lambda lb: (min(_box_dist(e, bx) for e in lb.leaders), lb.centre))
        best = hit[0]
        rivals = {lb.canonical for lb in hit if lb.canonical != best.canonical}
        return Link(
            best,
            "leader",
            "medium" if rivals else "high",
            "a leader line runs from the label to the column",
            sorted(rivals)[0] if rivals else None,
        )
    near = sorted(
        (
            (math.dist(lb.centre, point), i)
            for i, lb in enumerate(cols)
            if math.dist(lb.centre, point) <= cfg.COLUMN_LABEL_MAX_PT
        )
    )
    if not near:
        return Link(None, None, None, "no label near the column")
    d1, i1 = near[0]
    best = cols[i1]
    rival = next(((d, cols[i]) for d, i in near[1:] if cols[i].canonical != best.canonical), None)
    if rival is None:
        conf = "high" if d1 <= cfg.HIGH_DISTANCE_PT else "medium"
        why = f"nearest label, {d1:.0f} pt away, no other profile close"
        return Link(best, "beside", conf, why)
    ratio = rival[0] / max(d1, 0.01)
    if ratio >= cfg.HIGH_RIVAL_RATIO and d1 <= cfg.HIGH_DISTANCE_PT:
        conf = "high"
    elif ratio >= cfg.MEDIUM_RIVAL_RATIO:
        conf = "medium"
    else:
        conf = "low"
    why = f"nearest label, {d1:.0f} pt away; {rival[1].canonical} is {rival[0]:.0f} pt away"
    return Link(best, "beside", conf, why, rival[1].canonical)


def typical_for(point: Pt, labels: list[PageLabel], family_group: str = "column") -> Link:
    """The TYP label for a member that has no label of its own (TYP_SCOPE view_family): the TYP
    labels of the view of the same family group, the nearest wins, an exact tie between different
    profiles leaves it unset. `labels` are the labels of the member's view."""
    typ = [
        lb
        for lb in labels
        if lb.typical
        and lb.kind == "profile"
        and (lb.family in COLUMN_FAMILIES) == (family_group == "column")
    ]
    if not typ:
        return Link(None, None, None, "no TYP label in the view")
    ranked = sorted((math.dist(lb.centre, point), i) for i, lb in enumerate(typ))
    d1, i1 = ranked[0]
    best = typ[i1]
    tied = [
        typ[i] for d, i in ranked[1:] if d - d1 <= cfg.TIE_PT and typ[i].canonical != best.canonical
    ]
    if tied:
        return Link(None, None, None, f"two TYP labels tie ({best.canonical}, {tied[0].canonical})")
    others = {lb.canonical for lb in typ if lb.canonical != best.canonical}
    why = "the nearest TYP label of the view" + (
        f" ({len(typ)} TYP labels, {len(others)} other profile{'s' if len(others) != 1 else ''})"
        if len(typ) > 1
        else ""
    )
    return Link(best, "typical", "medium", why, sorted(others)[0] if others else None)


def resolve_profile(
    point: Pt,
    labels: list[PageLabel],
    example_profile: str | None,
    example_raw: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    """The profile of a column at `point` for Find similar / a hand-placed column (the Python twin
    of api/src/review/profile-link.ts `resolveProfile`): its own label (source label), else a TYP
    label (typical), else the example's profile (example). A label that is not in the AISC catalog
    is never used silently: the example stays and the link says why."""
    scope = scope or cfg.TYP_SCOPE

    def fallback(note: dict[str, Any] | None = None) -> dict[str, Any]:
        if example_profile:
            link = {"reason": "no label for this column: the example's profile", **(note or {})}
            return {"profile": example_profile, "profile_raw": example_raw or example_profile,
                    "source": "example", "link": link, "label": None}  # fmt: skip
        link = {"reason": "no usable label", **note} if note else None
        return {"profile": None, "profile_raw": None, "source": None, "link": link, "label": None}

    got = link_point(point, None, labels)
    if got.label is None and scope == "view_family":
        got = typical_for(point, labels, "column")
    if got.label is None:
        return fallback()
    lb = got.label
    info = got.evidence()
    if not lb.valid:
        return fallback({**info, "note": f"label {lb.raw} is not in the AISC catalog: not used"})
    if example_profile and example_profile != lb.canonical:
        info["note"] = f"label {lb.canonical}, example {example_profile}"
    return {"profile": lb.canonical, "profile_raw": lb.raw,
            "source": "typical" if got.method == "typical" else "label",
            "link": info, "label": lb}  # fmt: skip
