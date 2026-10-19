"""The build of one page, steps 2 to 10 in order, without the database (the job stores the result).

Inputs: the page, the person's setup (crop, confirmed scale ratio, T.O.S. in mm, beam pen class,
page role), the page's text lines, the legend, and for a framing page the built column plan (its
grid lines, scale and column points). Phase 11c person inputs of a view (src/build/inputs.py): the
crop is the view box, several beam pens (one beam_lines call per pen, lines renumbered in pen
order), accepted exclude boxes (content inside is taken away first) and deselected lines (pen
segments on them are not beam candidates; unmatched deselections are counted). A framing page
with no column plan, or whose grids do not register, is built from its own glyphs and the girders
(notes say so); grids are never required.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import pymupdf

from src.build import RULES_VERSION
from src.build.base_plates import BasePlate, find_base_plates, in_plate, is_grid_marker, plate_glyph
from src.build.beam_lines import BeamLine, beam_lines, pen_segments
from src.build.clean import Cleaned, clean
from src.build.columns import Glyph, column_plan_columns, find_glyphs
from src.build.geom import Box, Pt, in_box
from src.build.grids import Bubble, Crossing, GridLine, crossings, find_bubbles, find_grid_lines
from src.build.inputs import deselect, drop_text, exclude
from src.build.labels import Attached, Label, attach_to_columns, attach_to_pieces, find_labels
from src.build.not_beams import not_beams
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
    # Phase 11c person inputs of the view (empty: the page as before views)
    pens: tuple[str, ...] = ()  # all beam pens in order; empty = (pen_class,) if set
    excludes: tuple[Box, ...] = ()
    deselected: tuple[tuple[float, float, float, float], ...] = ()

    def beam_pens(self) -> list[str]:
        if self.pens:
            return list(self.pens)
        return [self.pen_class] if self.pen_class else []


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
    line_pens: dict[int, str] = field(default_factory=dict)  # beam line id -> its pen class
    deselections_unmatched: int = 0
    # Phase 12a rules: what each took away (dash_pattern runs and segments, wall and column-shape
    # beam lines)
    removed: dict[str, int] = field(default_factory=dict)
    plates: list[BasePlate] = field(default_factory=list)

    def column_info(self, k: int) -> dict:
        """How column k was found: the rule, and for a base plate its section type and grid."""
        g = self.columns[k]
        p = (
            next((p for p in self.plates if p.centre == g.centre), None)
            if not g.shape_ids
            else None
        )
        if p is None:
            return {"rule": self.column_rule}
        return {"rule": "base_plate", "section_type": p.section_type, "off_grid": p.off_grid}

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
            "removed_dash_pattern_runs": self.removed.get("dash_pattern_runs", 0),
            "removed_dash_pattern_segments": self.removed.get("dash_pattern_segments", 0),
            "removed_wall_lines": self.removed.get("wall_lines", 0),
            "removed_base_plate_lines": self.removed.get("base_plate_lines", 0),
            "removed_grid_markers": self.removed.get("grid_markers", 0),
            "base_plates": len(self.plates),
            "base_plates_off_grid": sum(p.off_grid for p in self.plates),
            "base_plate_columns": sum(1 for g in self.columns if not g.shape_ids),
            "removed_column_shape_lines": self.removed.get("column_shape_lines", 0),
        }
        if self.setup.excludes or self.setup.deselected or len(self.setup.beam_pens()) > 1:
            c["beam_pens"] = len(self.setup.beam_pens())
            c["exclude_boxes"] = len(self.setup.excludes)
            c["deselections"] = len(self.setup.deselected)
            c["deselections_unmatched"] = self.deselections_unmatched
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
    if setup.excludes:
        ps = exclude(ps, list(setup.excludes))
        text = drop_text(text, list(setup.excludes))
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
    # Phase 12a rule "grid_marker": bow-tie end / break markers on grid lines are not glyphs
    removed: dict[str, int] = {}
    markers = [g for g in glyphs if is_grid_marker(g, ps, grid)]
    if markers:
        glyphs = [g for g in glyphs if not is_grid_marker(g, ps, grid)]
    removed["grid_markers"] = len(markers)
    # Phase 12a rule "base_plate": four anchor bolts at a rectangle's corners mark one column
    plates = find_base_plates(ps, setup.ratio, cross)
    pens = setup.beam_pens()
    beam_keep = cleaned.keep
    unmatched = 0
    if setup.deselected and pens:
        pen_ids = sorted({i for pen in pens for i in pen_segments(ps, cleaned.keep, pen)})
        off, unmatched = deselect(ps, pen_ids, list(setup.deselected))
        beam_keep = cleaned.keep.copy()
        beam_keep[sorted(off)] = False
    lines: list[BeamLine] = []
    line_pens: dict[int, str] = {}
    for pen in pens:
        for ln in beam_lines(ps, beam_keep, pen, removed):
            line_pens[len(lines)] = pen
            lines.append(replace(ln, id=len(lines)))
    if setup.role == "framing" and not pens:
        notes.append("no_pen_class")

    reg: Registration | None = None
    projected: list[tuple[Pt, dict]] = []
    columns: list[Glyph] = []
    column_rule: str | None = None
    if setup.role == "column_plan":
        columns, column_rule = column_plan_columns(glyphs, has_grid)
        if plates:
            # one column per base plate at its centre; a glyph column inside a plate is that column
            columns = [g for g in columns if not in_plate(plates, g.centre)] + [
                plate_glyph(p) for p in plates
            ]
            columns.sort(key=lambda g: (round(g.centre[1], 1), round(g.centre[0], 1)))
            column_rule = f"{column_rule}+base_plate" if column_rule != "none" else "base_plate"
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

    # Phase 12a: wall faces and column-shape edges are not beams (src/build/not_beams.py)
    nb = not_beams(
        lines,
        ps,
        cleaned,
        setup.ratio,
        [g.centre for g in glyphs] + [p for p, _ in projected] + [p.centre for p in plates],
        plates,
    )
    removed["wall_lines"] = len(nb.wall)
    removed["base_plate_lines"] = len(nb.base_plate)
    removed["column_shape_lines"] = len(nb.column_shape)
    if len(nb.lines) != len(lines):
        line_pens = {k: line_pens[ln.id] for k, ln in enumerate(nb.lines)}
        lines = [replace(ln, id=k) for k, ln in enumerate(nb.lines)]

    # on the column plan, the columns found there are the column supports
    # on the column plan, the columns found there (glyphs and base plates) are the column supports,
    # every one of them (Phase 12a: with no beams on a column plan, a column away from a grid
    # crossing has no lines to make it a support)
    support_glyphs = columns if setup.role == "column_plan" else glyphs
    sup = build(lines, support_glyphs, projected, all_columns=setup.role == "column_plan")
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
        line_pens=line_pens,
        deselections_unmatched=unmatched,
        removed=removed,
        plates=plates,
    )


__all__ = ["ColumnPlanRef", "PageBuild", "Setup", "build_page"]
