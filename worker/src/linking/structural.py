"""Which stroke class holds the structural member lines of a view (a suggestion for the user).

Rule: among solid, non-grey classes with at least MIN_LINES lines of 12 pt or more inside the view,
take the heaviest width bucket; ties go to the class with more lines. Sheet-border lines (spanning
most of the page width or height) are ignored. The user confirms or changes the choice.
"""

from collections import defaultdict
from dataclasses import dataclass

from src.linking.candidates import MIN_LINE_PT
from src.linking.lines import WEIGHT_ORDER, Line, width_bucket

MIN_LINES = 8
BORDER_FRACTION = 0.9
NON_STRUCTURAL_COLOURS = {"grey", "none"}


@dataclass(frozen=True)
class ClassStat:
    key: str
    lines: int  # lines of MIN_LINE_PT or more inside the view
    length_pt: float


def lines_in_box(
    lines: list[Line],
    box: tuple[float, float, float, float],
    page_size: tuple[float, float],
) -> list[Line]:
    """Lines whose bbox overlaps the box, without sheet-border lines."""
    x0, y0, x1, y1 = box
    w, h = page_size
    out = []
    for ln in lines:
        a, b, c, d = ln.bbox
        if c < x0 or a > x1 or d < y0 or b > y1:
            continue
        if (c - a) >= BORDER_FRACTION * w or (d - b) >= BORDER_FRACTION * h:
            continue  # the sheet border or a title-block rule across the page
        out.append(ln)
    return out


def class_table(in_view: list[Line]) -> list[ClassStat]:
    count: dict[str, int] = defaultdict(int)
    total: dict[str, float] = defaultdict(float)
    for ln in in_view:
        if ln.length >= MIN_LINE_PT:
            count[ln.klass] += 1
            total[ln.klass] += ln.length
    stats = [ClassStat(k, count[k], total[k]) for k in count]
    return sorted(stats, key=lambda s: (-s.lines, s.key))


def suggest_classes(table: list[ClassStat]) -> list[str]:
    """The suggested structural class as a one-element list, or [] when nothing qualifies."""
    best: tuple[int, int, str] | None = None
    for s in table:
        width, colour, style = s.key.split("|")
        if style != "solid" or colour in NON_STRUCTURAL_COLOURS or s.lines < MIN_LINES:
            continue
        rank = (len(WEIGHT_ORDER) - WEIGHT_ORDER.index(width), s.lines, s.key)
        if best is None or rank[:2] > best[:2]:
            best = rank
    return [best[2]] if best else []


__all__ = ["ClassStat", "class_table", "lines_in_box", "suggest_classes", "width_bucket"]
