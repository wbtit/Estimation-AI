"""Phase 12c-A (docs/PHASE12C_PLAN.md): the estimators' markups in drawing-page coordinates.

Per job: for every drawing page that a marked-up page maps to (inventory page map + the Phase 6c
frame offset and shift), their count symbols with tag prefix, their measurement lines and the
markup scale. Read-only; nothing here prints page text.
"""

from __future__ import annotations

import collections
import json
import math
from dataclasses import dataclass, field

import pymupdf

from src.text_layer.parsers.dimension import find_dimensions
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.geometry_study import (
    MIN_MARKUP_PT,
    measure_scale,
    poly_length,
    ratio_from_measure,
    vertices_of,
)
from tools.takeoff.prefix_inventory import prefix_of
from tools.takeoff.tag_study import RADIUS

JOBS = ["job-003", "job-004", "job-005", "job-006", "job-008", "job-010", "job-011", "job-012",
        "job-013", "job-014", "job-015", "job-017", "job-018", "job-019", "job-020"]  # fmt: skip
SEEN = {"job-015", "job-018", "job-020"}
DEV = {"job-003", "job-005", "job-006", "job-010", "job-011", "job-012", "job-013", "job-014"}
STRICT = {"job-004", "job-008", "job-017", "job-019"}
BEAM, COLUMN = "B", "C"
RATIO_MERGE = 0.01  # markup ratios within 1% are one value (Phase 5v)


def group(job: str) -> str:
    return "seen" if job in SEEN else "dev" if job in DEV else "strict"


@dataclass
class Symbol:
    x: float
    y: float
    prefix: str


@dataclass
class Measure:
    points: list[tuple[float, float]]
    ratio: float  # their markup ratio (real length / drawn length)
    value_mm: float | None  # the value written in the markup, if it parses


@dataclass
class TheirPage:
    takeoff: list[tuple[str, int]] = field(default_factory=list)  # (file, page index)
    shift: tuple[float, float] = (0.0, 0.0)
    symbols: list[Symbol] = field(default_factory=list)
    measures: list[Measure] = field(default_factory=list)
    ratios: list[float] = field(default_factory=list)  # one per annotation with a measurement

    def count(self, prefix: str) -> int:
        return sum(s.prefix == prefix for s in self.symbols)

    def markup_ratio(self) -> float | None:
        """The ratio carried by the most annotations (merged within 1%); None on a tie."""
        groups: list[list[float]] = []
        for r in sorted(self.ratios):
            if groups and abs(r - groups[-1][0]) / groups[-1][0] <= RATIO_MERGE:
                groups[-1].append(r)
            else:
                groups.append([r])
        if not groups:
            return None
        groups.sort(key=len, reverse=True)
        if len(groups) > 1 and len(groups[0]) == len(groups[1]):
            return None
        g = groups[0]
        return sorted(g)[len(g) // 2]


def _frames() -> dict[tuple[str, int], tuple[int, float, float]]:
    """(job, takeoff page) -> (page offset, dx, dy) from the Phase 6c frame check."""
    out = {}
    fr = json.loads((TAKEOFFS / "phase6c_frame_all.json").read_text())
    for job, pages in fr.items():
        for p in pages:
            off = p.get("best_offset") or 0
            al = p["by_offset"].get(str(off)) or {}
            out[(job, int(p["takeoff_page"]))] = (off, al.get("dx") or 0.0, al.get("dy") or 0.0)
    return out


def their_pages(job: str) -> dict[int, TheirPage]:
    """Drawing page index -> their markup on it."""
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    frames = _frames()
    out: dict[int, TheirPage] = collections.defaultdict(TheirPage)
    for name, info in sorted(inv.items()):
        if info.get("match") != job:
            continue
        with pymupdf.open(TAKEOFFS / name) as tdoc:
            for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
                off, dx, dy = frames.get((job, tp), (0, 0.0, 0.0))
                page = tdoc[tp]
                tp_out = out[dp + off]
                tp_out.takeoff.append((name, tp))
                tp_out.shift = (dx, dy)
                m = page.rotation_matrix
                syms, texts = [], []
                for a in page.annots() or []:
                    kind = a.type[1]
                    if kind == "Polygon" and len(a.vertices or []) in (3, 8):
                        pts = [pymupdf.Point(p) * m for p in a.vertices]
                        r = a.rect
                        syms.append(
                            (sum(p.x for p in pts) / len(pts) + dx,
                             sum(p.y for p in pts) / len(pts) + dy,
                             ((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
                        )  # fmt: skip
                    elif kind == "FreeText" and (a.info.get("content") or "").strip():
                        r = a.rect
                        texts.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, a.info["content"]))
                    obj = tdoc.xref_object(a.xref, compressed=False)
                    if "/Measure" not in obj:
                        continue
                    try:
                        ms = measure_scale(obj, tdoc)
                    except (AttributeError, KeyError, ValueError):
                        ms = None  # a measurement entry the Phase 5v reader cannot read
                    if ms is None:
                        continue
                    ratio = ratio_from_measure(ms)
                    tp_out.ratios.append(ratio)
                    if kind in ("Line", "PolyLine"):
                        v = vertices_of(a, page)
                        if len(v) >= 2 and poly_length(v) >= MIN_MARKUP_PT:
                            text = " ".join(
                                [(a.info.get("content") or ""), (a.info.get("subject") or "")]
                            )
                            dims = find_dimensions(text)
                            tp_out.measures.append(
                                Measure([(x + dx, y + dy) for x, y in v], ratio,
                                        dims[0].mm if dims else None)
                            )  # fmt: skip
                # the tag: nearest FreeText within the tag study's radius (unrotated rects, as in
                # the prefix inventory)
                for x, y, (rx, ry) in syms:
                    best = min(texts, key=lambda t: math.hypot(t[0] - rx, t[1] - ry), default=None)
                    ok = best is not None and math.hypot(best[0] - rx, best[1] - ry) <= RADIUS
                    tp_out.symbols.append(Symbol(x, y, prefix_of(best[2]) if ok else "(no tag)"))
    return dict(out)


def pages_to_build(theirs: dict[int, TheirPage]) -> dict[int, str]:
    """Drawing page -> role: column plan when C symbols and no B symbols, else framing."""
    out = {}
    for dp, t in theirs.items():
        b, c = t.count(BEAM), t.count(COLUMN)
        if b or c:
            out[dp] = "column_plan" if c and not b else "framing"
    return out
