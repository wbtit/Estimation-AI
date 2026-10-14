"""Sheet number and title from title-block text.

Never guesses: not found or ambiguous -> None + a review flag.

Sheet number:
  1. Label-anchored: a "SHEET NO" / "DWG NO" / ... label, with the number on the same line or
     right of / below the label. Several different numbers near labels -> ambiguous.
  2. Otherwise, in the title-block region (bottom-right corner or far-right strip), a token that
     looks like a sheet number and is clearly larger than the other text there. If two different
     candidates are too close in size -> ambiguous.
Title: only when it sits on, right of, or under a "SHEET TITLE" / "DRAWING TITLE" / "TITLE" label.

Phase 9 (`title_block=True`): the title-block reading. The number pattern also accepts the common
`S4-01` form (letter, digit, hyphen, digits) that the earlier pattern could not match, so the
earlier
reading picked another token in the corner; and a label's number may sit below and to the right of
the label (a right-aligned cell), up to NUMBER_BELOW_RIGHT_MAX of the page width. The earlier
reading (`title_block=False`) is kept unchanged as the fallback.
"""

import re
from dataclasses import dataclass, field
from statistics import median

from src.pdf_scan.textlines import Line, Word

# Letters, optional hyphen, digits, optional decimal part, optional trailing letter:
# S001, S030, S4.1, S-101, S2.01, S101A, SD1.2.
SHEET_NUMBER_RE = re.compile(r"^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,3})?[A-Z]?$")
# Phase 9: also S4-01, S1.01-A, A-101.2 (letters, digits, then any run of "-nn" or ".nn" groups).
TITLE_BLOCK_NUMBER_RE = re.compile(r"^[A-Z]{1,3}-?\d{1,4}(?:[.-]\d{1,3})*[A-Z]?$")
NUMBER_BELOW_RIGHT_MAX = (
    0.05  # of page width: a number below a label may start this far right of it
)

_NUMBER_LABEL = r"(?:SHEET|SHT|DWG|DRAWING)\s*(?:NO|NUM|NUMBER|#)\.?"
_NUMBER_LABEL_ALONE_RE = re.compile(rf"^{_NUMBER_LABEL}\s*:?$")
_NUMBER_LABEL_INLINE_RE = re.compile(rf"^{_NUMBER_LABEL}\s*:?\s*(?P<value>\S.*)$")
_TITLE_LABEL = r"(?:(?:SHEET|DRAWING|DWG)\s+)?TITLE"
_TITLE_LABEL_ALONE_RE = re.compile(rf"^{_TITLE_LABEL}\s*:?$")
_TITLE_LABEL_INLINE_RE = re.compile(rf"^{_TITLE_LABEL}\s*:\s*(?P<value>\S.*)$")
# Any label that ends a multi-line title.
_ANY_LABEL_RE = re.compile(
    r"^(?:DATE|DRAWN|CHECKED|APPROVED|PROJECT|JOB|SCALE|REV|REVISIONS?|SHEET|DWG|DRAWING|TITLE|"
    r"ENGINEER|CLIENT|ISSUE|SEAL)\b"
)

NUMBER_LABEL_MAX_DISTANCE = 0.15  # of page width: how far a label's value may sit from it
TITLE_BLOCK_CORNER = (0.70, 0.70)  # bottom-right corner: x >= 0.70 W and y >= 0.70 H
TITLE_BLOCK_STRIP = 0.88  # far-right strip: x >= 0.88 W
REGION_SIZE_FACTOR = 1.3  # a region candidate must be this much taller than the median text there
REGION_UNIQUE_FACTOR = 1.15  # and this much taller than the next-best different candidate
MAX_TITLE_LINES = 4


@dataclass
class SheetId:
    number: str | None = None
    number_source: str | None = None  # "label" | "title_block_region"
    title: str | None = None
    flags: list[str] = field(default_factory=list)
    alternatives: list[str] = field(default_factory=list)  # other candidates that conflict


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().upper()


def _candidate(text: str, title_block: bool = False) -> str | None:
    token = _clean(text).strip(".,;:()[]")
    rx = TITLE_BLOCK_NUMBER_RE if title_block else SHEET_NUMBER_RE
    return token if rx.match(token) else None


def _in_title_block_region(word: Word, page_w: float, page_h: float) -> bool:
    cx, cy = word.box.cx, word.box.cy
    corner = cx >= TITLE_BLOCK_CORNER[0] * page_w and cy >= TITLE_BLOCK_CORNER[1] * page_h
    return corner or cx >= TITLE_BLOCK_STRIP * page_w


def _numbers_near_label(
    label: Line, words: list[Word], page_w: float, title_block: bool = False
) -> list[tuple[float, str]]:
    """(distance, number) for number-like words right of or below a label line."""
    found: list[tuple[float, str]] = []
    lb = label.box
    max_dx = NUMBER_LABEL_MAX_DISTANCE * page_w
    slack = lb.width * 0.5
    if title_block:
        slack = max(slack, NUMBER_BELOW_RIGHT_MAX * page_w)
    for w in words:
        token = _candidate(w.text, title_block)
        if token is None:
            continue
        b = w.box
        right_of = abs(b.cy - lb.cy) <= lb.height and 0 <= b.x0 - lb.x1 <= max_dx
        below = (
            b.cy > lb.cy
            and b.y0 - lb.y1 <= 4 * lb.height
            and b.x1 >= lb.x0 - lb.width * 0.5
            and b.x0 <= lb.x1 + slack
        )
        if right_of or below:
            found.append(((b.cx - lb.cx) ** 2 + (b.cy - lb.cy) ** 2, token))
    return found


def _find_number(
    words: list[Word], lines: list[Line], page_w: float, page_h: float, title_block: bool = False
) -> tuple[str | None, str | None, list[str]]:
    anchored: list[str] = []
    for line in lines:
        text = _clean(line.text)
        if _NUMBER_LABEL_ALONE_RE.match(text):
            near = sorted(_numbers_near_label(line, words, page_w, title_block))
            if near:
                nearest = near[0][0]
                # candidates at (almost) the same distance as the nearest are ties
                tied = {n for d, n in near if d <= nearest * 1.2 + 1e-6}
                anchored.extend(sorted(tied))
            continue
        inline = _NUMBER_LABEL_INLINE_RE.match(text)
        if inline:
            value = _candidate(inline.group("value"), title_block)
            if value:
                anchored.append(value)
    distinct = sorted(set(anchored))
    if len(distinct) == 1:
        return distinct[0], "label", []
    if len(distinct) > 1:
        return None, None, ["sheet_number_ambiguous"]

    number, flags = _region_number(words, page_w, page_h, title_block)
    return number, ("title_block_region" if number else None), flags


def _region_number(
    words: list[Word], page_w: float, page_h: float, title_block: bool = False
) -> tuple[str | None, list[str]]:
    """The sheet number from the title-block region alone: clearly the largest candidate."""
    region = [w for w in words if _in_title_block_region(w, page_w, page_h)]
    if not region:
        return None, ["sheet_number_not_found"]
    typical = median(w.box.height for w in region)
    sizes: dict[str, float] = {}
    for w in region:
        token = _candidate(w.text, title_block)
        if token is not None and w.box.height >= REGION_SIZE_FACTOR * typical:
            sizes[token] = max(sizes.get(token, 0.0), w.box.height)
    if not sizes:
        return None, ["sheet_number_not_found"]
    ranked = sorted(sizes.items(), key=lambda item: item[1], reverse=True)
    if len(ranked) == 1 or ranked[0][1] >= REGION_UNIQUE_FACTOR * ranked[1][1]:
        return ranked[0][0], []
    return None, ["sheet_number_ambiguous"]


def _find_title(lines: list[Line]) -> tuple[str | None, list[str]]:
    for label in lines:
        text = _clean(label.text)
        inline = _TITLE_LABEL_INLINE_RE.match(text)
        if inline:
            value = re.sub(r"\s+", " ", label.text.split(":", 1)[1]).strip()
            if value:
                return value, []
            continue
        if not _TITLE_LABEL_ALONE_RE.match(text):
            continue
        lb = label.box
        # First title line: nearest line that is right of the label on the same row, or below it.
        first: Line | None = None
        best = float("inf")
        for cand in lines:
            if cand is label or _ANY_LABEL_RE.match(_clean(cand.text)):
                continue
            b = cand.box
            right_of = abs(b.cy - lb.cy) <= lb.height and b.x0 >= lb.x1 - 1
            below = (
                b.cy > lb.cy
                and b.y0 - lb.y1 <= 3 * lb.height
                and abs(b.x0 - lb.x0) <= 2 * lb.height
            )
            if right_of or below:
                d = (b.cx - lb.cx) ** 2 + (b.cy - lb.cy) ** 2
                if d < best:
                    best, first = d, cand
        if first is None:
            continue
        parts = [first]
        while len(parts) < MAX_TITLE_LINES:
            last = parts[-1]
            nxt = None
            for cand in lines:
                if cand in parts or cand is label:
                    continue
                b = cand.box
                # Line boxes include leading and may overlap: the next line starts below the
                # middle of the previous one and is not a big gap away.
                if (
                    b.cy > last.box.cy + 0.5 * last.box.height
                    and b.y0 - last.box.y1 <= 1.8 * max(last.box.height, b.height)
                    and abs(b.x0 - last.box.x0) <= 2 * last.box.height
                    and (nxt is None or b.y0 < nxt.box.y0)
                ):
                    nxt = cand
            # The nearest line below ends the title if it is another label (for example DATE).
            if nxt is None or _ANY_LABEL_RE.match(_clean(nxt.text)):
                break
            parts.append(nxt)
        return re.sub(r"\s+", " ", " ".join(p.text for p in parts)).strip(), []
    return None, ["title_not_found"]


def find_sheet_id(
    words: list[Word],
    lines: list[Line],
    page_w: float,
    page_h: float,
    *,
    title_block: bool = False,
) -> SheetId:
    number, source, number_flags = _find_number(words, lines, page_w, page_h, title_block)
    title, title_flags = _find_title(lines)
    flags = [*number_flags, *title_flags]
    alternatives: list[str] = []
    if source == "label":
        # a label-anchored number that disagrees with a clear title-block candidate is a conflict
        other, _ = _region_number(words, page_w, page_h, title_block)
        if other is not None and other != number:
            alternatives = [other]
            flags.append("sheet_number_conflict")
    return SheetId(
        number=number,
        number_source=source,
        title=title,
        flags=flags,
        alternatives=alternatives,
    )
