"""The build of one page, steps 2 to 10 in order, without the database (the job stores the result).

Inputs: the page, the person's setup (crop, confirmed scale ratio, T.O.S. in mm, beam pen class,
page role), the page's text lines, the legend, and for a framing page the built column plan (its
grid lines, scale and column points). A framing page with no column plan, or whose grids do not
register, is built from its own glyphs and the girders (notes say so); grids are never required.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pymupdf

from src.build import RULES_VERSION
from src.build.beam_lines import BeamLine, beam_lines
from src.build.clean import Cleaned, clean
from src.build.columns import Glyph, column_plan_columns, find_glyphs
from src.build.geom import Box, Pt, in_box
from src.build.grids import Bubble, Crossing, GridLine, crossings, find_bubbles, find_grid_lines
from src.build.labels import Attached, Label, attach_to_columns, attach_to_pieces, find_labels
from src.build.register import Registration, project_columns, register
from src.build.segments import PageSegments, TextLine, crop, page_text_lines, parse_page
from src.build.supports import SupportResult, build

MIN_CROSSINGS = 4  # a page "has a grid" with at least this many crossings


@dataclass
class Setup:
    crop: Box
    ratio: float
    tos_mm: float | None
    pen_class: str | None
    role: str  # column_plan or framing
    crossing_rule: str = "family"  # "direction" only for the reported Phase 11 deviation


@dataclass
class ColumnPlanRef:
    grid_lines: list[GridLine]
    ratio: float
    columns: list[tuple[Pt, dict]]  # page points of the column plan, evidence


@dataclass
class PageBuild:
    setup: Setup
    rules_version: str
    segments: PageSegments
    cleaned: Cleaned
    bubbles: list[Bubble]
    grid_lines: list[GridLine]
    crossings: list[Crossing]
    glyphs: list[Glyph]
    registration: Registration | None
    columns: list[Glyph]  # column plan only: the glyphs that are columns
    column_rule: str | None
    column_labels: list[Attached]
    supports: SupportResult
    piece_labels: list[Attached]
    labels: list[Label]
    notes: list[str] = field(default_factory=list)

    @property
    def lines(self) -> list[BeamLine]:
        return self.supports.lines

    def counts(self) -> dict[str, int]:
        c: dict[str, int] = {
            "segments": len(self.segments),
            "removed_hatch": self.cleaned.removed.get("hatch", 0),
            "removed_dimension": self.cleaned.removed.get("dimension", 0),
            "removed_text": self.cleaned.removed.get("text", 0),
            "bubbles": len(self.bubbles),
            "grid_lines": len(self.grid_lines),
            "grid_lines_labelled": sum(1 for g in self.grid_lines if g.label),
            "grid_crossings": len(self.crossings),
            "grid_matched_for_registration": len(self.registration.matched)
            if self.registration
            else 0,
            "glyphs": len(self.glyphs),
            "columns": len(self.columns),
            "beam_lines": len(self.lines),
            "labels": len(self.labels),
        }
        c.update(self.supports.counts)
        for state in ("sized", "inferred", "undefined"):
            c[f"pieces_{state}"] = sum(a.size_state == state for a in self.piece_labels)
            c[f"columns_{state}"] = sum(a.size_state == state for a in self.column_labels)
        return c


def build_page(
    page: pymupdf.Page,
    setup: Setup,
    text: list[TextLine] | None = None,
    legend: dict[str, list[tuple[str, str | None]]] | None = None,
    column_plan: ColumnPlanRef | None = None,
) -> PageBuild:
    notes: list[str] = []
    text = page_text_lines(page) if text is None else text
    text = [t for t in text if in_box(t.centre, setup.crop)]
    ps = crop(parse_page(page), setup.crop)
    cleaned = clean(ps, text)
    bubbles = find_bubbles(ps, text, setup.crop)
    grid, _ = find_grid_lines(ps, cleaned.keep, bubbles)
    cross = crossings(grid, setup.crossing_rule)
    if setup.crossing_rule != "family":
        notes.append(f"crossing_rule_{setup.crossing_rule}")
    has_grid = len(cross) >= MIN_CROSSINGS
    if not grid:
        notes.append("no_grid")
    glyphs = find_glyphs(ps, setup.crop, bubbles, text, cross)
    lines = beam_lines(ps, cleaned.keep, setup.pen_class) if setup.pen_class else []
    if setup.role == "framing" and not setup.pen_class:
        notes.append("no_pen_class")

    reg: Registration | None = None
    projected: list[tuple[Pt, dict]] = []
    columns: list[Glyph] = []
    column_rule: str | None = None
    if setup.role == "column_plan":
        columns, column_rule = column_plan_columns(glyphs, has_grid)
        notes.append(f"columns_by_{column_rule}")
    elif column_plan is None:
        notes.append("no_column_plan")
    else:
        reg = register(grid, setup.ratio, column_plan.grid_lines, column_plan.ratio)
        if reg.ok:
            pts = project_columns(
                [p for p, _ in column_plan.columns], column_plan.ratio, reg, setup.ratio
            )
            projected = [
                (p, {**ev, "rule": "projected"})
                for p, (_, ev) in zip(pts, column_plan.columns, strict=True)
                if in_box(p, setup.crop)
            ]
        else:
            notes.append(f"no_registration:{reg.reason}")

    # on the column plan, the columns found there are the column supports
    support_glyphs = glyphs
    if setup.role == "column_plan":
        keep = {id(g) for g in columns}
        support_glyphs = [g for g in glyphs if id(g) in keep]
    sup = build(lines, support_glyphs, projected)
    labels = find_labels(text, legend or {})
    piece_labels = attach_to_pieces([(p.a, p.b) for p in sup.pieces], labels)
    column_labels = attach_to_columns([g.centre for g in columns], labels)
    return PageBuild(
        setup=setup,
        rules_version=RULES_VERSION,
        segments=ps,
        cleaned=cleaned,
        bubbles=bubbles,
        grid_lines=grid,
        crossings=cross,
        glyphs=glyphs,
        registration=reg,
        columns=columns,
        column_rule=column_rule,
        column_labels=column_labels,
        supports=sup,
        piece_labels=piece_labels,
        labels=labels,
        notes=notes,
    )


__all__ = ["ColumnPlanRef", "PageBuild", "Setup", "build_page"]
