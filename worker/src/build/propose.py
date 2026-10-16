"""Auto mode proposals: the setup the system would use for a page (Phase 11b).

Every rule here is an existing one (docs/PHASE11_PREREGISTRATION.md section 3, docs/PHASE11B_PLAN.md
section 2); nothing is tuned on a job:
  - role: the page type guess (foundation plan -> column plan, framing plan -> framing, else skip);
  - crop: the box around the bubbles that anchor grid lines, grown by CROP_MARGIN_PT beyond each
    bubble's radius and clipped to the page; with no anchored grid line, the whole-sheet box;
  - pen class: the line class suggester inside the crop (src/linking/structural.py);
  - scale: the sheet's stored effective ratio (a person's override, else the parsed one);
  - T.O.S.: the T.O.S. notes parsed inside the crop (src/text_layer/parsers/elevation.py, reference
    top of steel, not a signed offset, with a value): the most frequent value, a tie gives none;
  - column plan of a framing page: the only built column plan, else the one with the most grid
    labels in common with the page, a tie gives none.
Pure functions over a page and its text; no database access.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import pymupdf

from src.build.clean import clean
from src.build.geom import Box
from src.build.grids import GridLine, find_bubbles, find_grid_lines
from src.build.segments import TextLine, crop, parse_page
from src.linking.lines import Line, page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.text_layer.parsers.elevation import find_elevations

CROP_MARGIN_PT = 36.0
WHOLE_MARGIN, WHOLE_RIGHT = 0.025, 0.14  # Phase 5b whole-sheet view box
ROLE_OF_GUESS = {"foundation_plan": "column_plan", "framing_plan": "framing"}


@dataclass
class CropProposal:
    box: Box
    rule: str  # "grid_bubbles" | "fallback_whole_sheet"
    grid: list[GridLine] = field(default_factory=list)
    bubbles: list = field(default_factory=list)


@dataclass
class TosProposal:
    mm: float | None
    raw: str | None
    rule: str  # "single_note" | "most_frequent" | "tie" | "none"
    notes: int  # T.O.S. notes with a value inside the crop


def displayed_size(page: pymupdf.Page) -> tuple[float, float]:
    w, h = page.rect.width, page.rect.height
    return (h, w) if page.rotation in (90, 270) else (w, h)


def whole_sheet_box(w: float, h: float) -> Box:
    return (w * WHOLE_MARGIN, h * WHOLE_MARGIN, w * (1 - WHOLE_RIGHT), h * (1 - WHOLE_MARGIN))


def propose_role(page_type_guess: str | None) -> str | None:
    """'column_plan', 'framing' or None (skip)."""
    return ROLE_OF_GUESS.get(page_type_guess or "")


def propose_crop(page: pymupdf.Page, text: list[TextLine]) -> CropProposal:
    w, h = displayed_size(page)
    full = (0.0, 0.0, w, h)
    ps = crop(parse_page(page), full)
    cl = clean(ps, text)
    bubbles = find_bubbles(ps, text, full)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    anchors = [b for g in grid for b in g.bubbles]
    if not anchors:
        return CropProposal(whole_sheet_box(w, h), "fallback_whole_sheet", grid, bubbles)
    box = (
        max(0.0, min(b.centre[0] - b.radius for b in anchors) - CROP_MARGIN_PT),
        max(0.0, min(b.centre[1] - b.radius for b in anchors) - CROP_MARGIN_PT),
        min(w, max(b.centre[0] + b.radius for b in anchors) + CROP_MARGIN_PT),
        min(h, max(b.centre[1] + b.radius for b in anchors) + CROP_MARGIN_PT),
    )
    return CropProposal(box, "grid_bubbles", grid, bubbles)


def propose_pen(
    page: pymupdf.Page, box: Box, lines: list[Line] | None = None
) -> tuple[str | None, list[Line]]:
    """(the suggested beam pen class or None, the extracted lines inside the box)."""
    in_crop = lines_in_box(page_lines(page) if lines is None else lines, box, displayed_size(page))
    pen = suggest_classes(class_table(in_crop))
    return (pen[0] if pen else None), in_crop


def propose_scale(sheet: dict[str, Any]) -> tuple[float | None, str | None]:
    """The stored effective scale: a person's override, else the parsed one."""
    if sheet.get("scale_override_ratio") is not None:
        return float(sheet["scale_override_ratio"]), sheet.get("scale_override")
    if sheet.get("scale_parsed_ratio") is not None:
        return float(sheet["scale_parsed_ratio"]), sheet.get("scale_parsed")
    return None, None


def _inside(t: TextLine, box: Box) -> bool:
    cx, cy = t.centre
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def propose_tos(text: list[TextLine], box: Box) -> TosProposal:
    values: Counter[float] = Counter()
    first_raw: dict[float, str] = {}
    for t in text:
        if not _inside(t, box):
            continue
        for e in find_elevations(t.text):
            if e.reference != "top_of_steel" or e.is_relative or e.value_mm is None:
                continue
            v = round(e.value_mm, 1)
            values[v] += 1
            first_raw.setdefault(v, e.raw)
    if not values:
        return TosProposal(None, None, "none", 0)
    notes = sum(values.values())
    ranked = values.most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return TosProposal(None, None, "tie", notes)
    v = ranked[0][0]
    rule = "single_note" if len(ranked) == 1 else "most_frequent"
    return TosProposal(v, first_raw[v], rule, notes)


def choose_column_plan(
    page_labels: set[tuple[str, str]], plans: dict[str, set[tuple[str, str]]]
) -> tuple[str | None, str]:
    """(column plan sheet id or None, rule). `plans` maps each BUILT column plan page to its grid
    labels as (family, label); `page_labels` are the framing page's."""
    if not plans:
        return None, "no_column_plan_built"
    if len(plans) == 1:
        return next(iter(plans)), "only_column_plan"
    shared = sorted(((len(page_labels & lab), sid) for sid, lab in plans.items()), reverse=True)
    if shared[0][0] == 0 or shared[0][0] == shared[1][0]:
        return None, "no_clear_column_plan"
    return shared[0][1], "most_grid_labels_shared"


def grid_labels(grid: list[GridLine]) -> set[tuple[str, str]]:
    return {(g.family or "", g.label) for g in grid if g.label}


__all__ = [
    "CROP_MARGIN_PT",
    "CropProposal",
    "TosProposal",
    "choose_column_plan",
    "displayed_size",
    "grid_labels",
    "propose_crop",
    "propose_pen",
    "propose_role",
    "propose_scale",
    "propose_tos",
    "whole_sheet_box",
]
