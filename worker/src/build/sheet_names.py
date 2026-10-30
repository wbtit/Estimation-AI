"""Phase 14a: the name of a page, read from its stored text (deterministic, no LLM).

Rules (RULES_VERSION; v1 fixed before the first run on the demo, v2 adds the REPEATED rule after
that run found a stamp named as the title-block name on 22 of 23 pages and a border header taken
as a view title on 23 of 23):
  REPEATED: an all-caps text on at least half of a project's pages (and at least 3) is sheet
  furniture (a stamp, a firm or project name, a border note): never a view title or a name. Scale
  lines are still read from all lines.
  Text lines: the stored horizontal text lines of the page (text_items level 'line', angle within
  5 degrees of 0), in displayed page points.
  Title block: the bottom-right corner, x >= 75% and y >= 60% of the page.
  VIEW TITLE: a line outside the title block with no lower-case letter, 6-80 characters, a word of
  at least 3 letters, not itself a scale line, at least 1.25 x the page's median line height, and
    - a SCALE line just below: top within 2.5 line heights under it, overlapping it horizontally,
      text with SCALE, N.T.S., 1:n or a 1/8" = 1'-0" pattern; and/or
    - an UNDERLINE: a stored horizontal drawn line (|dy| <= 0.5 pt) from 0.2 line heights above
      its bottom to 0.6 below, covering >= 60% of its width.
  All view titles are kept, top to bottom; the main one has both, then the larger text, then the
  wider line.
  TITLE-BLOCK NAME: in the title block, the lines with no lower-case letter, a word of at least 3
  letters and not a label (a line ending ':' or naming SHEET, DRAWING NO, DWG, DATE, SCALE,
  PROJECT NO, JOB, DRAWN, CHECKED, APPROVED, DESIGNED, REV, ISSUE, SEAL, NO.). Rule 'label': the
  first such line under a SHEET TITLE / DRAWING TITLE label (within 4 label heights, overlapping);
  else rule 'largest': the tallest such line (then the widest). A line of the same height
  (+-15%) directly above or below (gap under 0.8 line heights, overlapping) is joined, up to 3.
The card shows the main view title, else the title-block name.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from statistics import median

RULES_VERSION = "sheet-names-2"
REPEAT_SHARE = 0.5
REPEAT_MIN_PAGES = 3

TB_X = 0.75
TB_Y = 0.60
MIN_CHARS, MAX_CHARS = 6, 80
HEIGHT_FACTOR = 1.25
SCALE_BELOW = 2.5
UNDER_ABOVE, UNDER_BELOW = 0.2, 0.6
UNDER_COVER = 0.6
FLAT_PT = 0.5
LABEL_WINDOW = 4.0
JOIN_GAP = 0.8
JOIN_HEIGHT = 0.15
JOIN_MAX = 3
ANGLE_TOL = 5.0

SCALE_RE = re.compile(
    r"\bSCALE\b|\bN\.?\s?T\.?\s?S\.?\b|\b1\s*:\s*\d+\b|\d+\s*/\s*\d+\s*\"?\s*=\s*1\s*'|\b1\s*\"\s*=",
    re.IGNORECASE,
)
WORD3 = re.compile(r"[A-Z]{3,}")
LABEL_RE = re.compile(
    r"\b(?:SHEET|DRAWING\s+NO|DWG|DATE|SCALE|PROJECT\s+NO|JOB|DRAWN|CHECKED|APPROVED|DESIGNED"
    r"|REV|REVISION|ISSUE|SEAL|NO\.)",
)
TITLE_LABEL_RE = re.compile(r"\b(?:SHEET|DRAWING)\s+TITLE\b")

Box = tuple[float, float, float, float]


@dataclass
class Line:
    text: str
    box: Box

    @property
    def h(self) -> float:
        return self.box[3] - self.box[1]

    @property
    def w(self) -> float:
        return self.box[2] - self.box[0]


@dataclass
class ViewTitle:
    text: str
    box: Box
    scale: bool
    underlined: bool


@dataclass
class SheetNames:
    view_title: str | None
    view_titles: list[ViewTitle] = field(default_factory=list)
    title_block_name: str | None = None
    title_block_rule: str | None = None  # label | largest


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _caps(text: str) -> bool:
    return not re.search(r"[a-z]", text) and bool(WORD3.search(text))


def _overlap(a: Box, b: Box) -> float:
    return min(a[2], b[2]) - max(a[0], b[0])


def in_title_block(box: Box, width: float, height: float) -> bool:
    return box[0] >= TB_X * width and box[1] >= TB_Y * height


def _scale_below(c: Line, lines: list[Line]) -> bool:
    for o in lines:
        if o is c or not SCALE_RE.search(o.text):
            continue
        top = o.box[1]
        if (
            c.box[3] - 0.25 * c.h <= top <= c.box[3] + SCALE_BELOW * c.h
            and _overlap(c.box, o.box) > 0
        ):
            return True
    return False


def _underlined(c: Line, segments: list[Box]) -> bool:
    lo, hi = c.box[3] - UNDER_ABOVE * c.h, c.box[3] + UNDER_BELOW * c.h
    for x0, y0, x1, y1 in segments:
        if abs(y1 - y0) > FLAT_PT or not (lo <= (y0 + y1) / 2 <= hi):
            continue
        a, b = min(x0, x1), max(x0, x1)
        cover = min(b, c.box[2]) - max(a, c.box[0])
        if c.w > 0 and cover >= UNDER_COVER * c.w:
            return True
    return False


def view_titles(
    lines: list[Line],
    segments: list[Box],
    width: float,
    height: float,
    exclude: frozenset[str] = frozenset(),
):
    if not lines:
        return []
    typical = median(ln.h for ln in lines)
    out = []
    for c in lines:
        t = c.text
        if (
            t in exclude
            or not (MIN_CHARS <= len(t) <= MAX_CHARS)
            or not _caps(t)
            or SCALE_RE.search(t)
        ):
            continue
        if c.h < HEIGHT_FACTOR * typical or in_title_block(c.box, width, height):
            continue
        scale, under = _scale_below(c, lines), _underlined(c, segments)
        if scale or under:
            out.append(ViewTitle(t, c.box, scale, under))
    return sorted(out, key=lambda v: (v.box[1], v.box[0]))


def main_view_title(found: list[ViewTitle]) -> ViewTitle | None:
    if not found:
        return None
    return max(
        found,
        key=lambda v: (v.scale and v.underlined, v.box[3] - v.box[1], v.box[2] - v.box[0]),
    )


def _join(first: Line, pool: list[Line]) -> str:
    parts = [first]
    for _ in range(JOIN_MAX - 1):
        top, bottom = min(p.box[1] for p in parts), max(p.box[3] for p in parts)
        nxt = None
        for o in pool:
            if o in parts or abs(o.h - first.h) > JOIN_HEIGHT * first.h:
                continue
            if _overlap(o.box, first.box) <= 0:
                continue
            gap = o.box[1] - bottom if o.box[1] >= bottom else top - o.box[3]
            if 0 <= gap <= JOIN_GAP * first.h:
                nxt = o
                break
        if nxt is None:
            break
        parts.append(nxt)
    return " ".join(p.text for p in sorted(parts, key=lambda p: p.box[1]))


def title_block_name(
    lines: list[Line],
    width: float,
    height: float,
    sheet_number: str | None = None,
    exclude: frozenset[str] = frozenset(),
) -> tuple[str | None, str | None]:
    region = [ln for ln in lines if in_title_block(ln.box, width, height)]
    number = _norm(sheet_number or "").upper()
    names = [
        ln
        for ln in region
        if _caps(ln.text)
        and ln.text not in exclude
        and not ln.text.endswith(":")
        and not LABEL_RE.search(ln.text)
        and (not number or ln.text.upper() != number)
    ]
    if not names:
        return None, None
    for label in sorted(region, key=lambda ln: (ln.box[1], ln.box[0])):
        if not TITLE_LABEL_RE.search(label.text.upper()):
            continue
        below = [
            n
            for n in names
            if label.box[1] < n.box[1] <= label.box[3] + LABEL_WINDOW * label.h
            and _overlap(n.box, label.box) > 0
        ]
        if below:
            first = min(below, key=lambda n: n.box[1])
            return _join(first, names), "label"
    first = max(names, key=lambda n: (n.h, n.w))
    return _join(first, names), "largest"


def read_names(
    lines: list[Line],
    segments: list[Box],
    width: float,
    height: float,
    sheet_number: str | None = None,
    exclude: frozenset[str] = frozenset(),
) -> SheetNames:
    lines = clean(lines)
    found = view_titles(lines, segments, width, height, exclude)
    main = main_view_title(found)
    name, rule = title_block_name(lines, width, height, sheet_number, exclude)
    return SheetNames(main.text if main else None, found, name, rule)


def clean(lines: list[Line]) -> list[Line]:
    return [Line(_norm(ln.text), ln.box) for ln in lines if _norm(ln.text)]


def repeated_texts(pages: list[list[Line]]) -> frozenset[str]:
    """Rule REPEATED: all-caps texts on at least half of the pages (and at least 3)."""
    on: Counter[str] = Counter()
    for lines in pages:
        on.update({ln.text for ln in clean(lines) if _caps(ln.text)})
    need = max(REPEAT_MIN_PAGES, math.ceil(REPEAT_SHARE * len(pages)))
    return frozenset(t for t, n in on.items() if n >= need)


def load_page(conn, sheet: dict) -> tuple[list[Line], list[Box], float, float]:
    """A sheet's stored horizontal text lines, flat drawn lines and displayed size."""
    sid = str(sheet["id"])
    lines = [
        Line(r["text"], (float(r["x0"]), float(r["y0"]), float(r["x1"]), float(r["y1"])))
        for r in conn.execute(
            "SELECT x0, y0, x1, y1, text, angle_deg, orientation FROM text_items"
            " WHERE sheet_id = %s AND level = 'line' AND text IS NOT NULL ORDER BY y0, x0",
            (sid,),
        )
        if (r["orientation"] == "horizontal" if r["angle_deg"] is None else
            min(float(r["angle_deg"]) % 180, 180 - float(r["angle_deg"]) % 180) <= ANGLE_TOL)
    ]  # fmt: skip
    row = conn.execute("SELECT lines FROM sheet_lines WHERE sheet_id = %s", (sid,)).fetchone()
    segments = [
        (float(a[0]), float(a[1]), float(a[2]), float(a[3]))
        for a in (row["lines"] if row else [])
        if abs(float(a[3]) - float(a[1])) <= FLAT_PT
    ]
    w, h = _displayed_size(sheet)
    return lines, segments, w, h


def read_project(conn, sheets: list[dict]) -> dict[str, SheetNames]:
    """The names of a project's pages (rule REPEATED needs all of them)."""
    loaded = {str(s["id"]): load_page(conn, s) for s in sheets}
    exclude = repeated_texts([v[0] for v in loaded.values()])
    return {
        str(s["id"]): read_names(*loaded[str(s["id"])], s.get("sheet_number"), exclude)
        for s in sheets
    }


def _displayed_size(sheet: dict) -> tuple[float, float]:
    w = float(sheet["width_pt"] or 0)
    h = float(sheet["height_pt"] or 0)
    return (h, w) if (sheet.get("rotation") or 0) in (90, 270) else (w, h)


def store(conn, sheet_id: str, names: SheetNames) -> None:
    from psycopg.types.json import Jsonb

    conn.execute(
        "UPDATE sheets SET view_title = %s, view_titles = %s, title_block_name = %s,"
        " title_block_rule = %s, names_rules_version = %s, names_read_at = now() WHERE id = %s",
        (
            names.view_title,
            Jsonb(
                [
                    {
                        "text": v.text,
                        "box": list(v.box),
                        "scale": v.scale,
                        "underlined": v.underlined,
                    }
                    for v in names.view_titles
                ]
            ),
            names.title_block_name,
            names.title_block_rule,
            RULES_VERSION,
            sheet_id,
        ),
    )
