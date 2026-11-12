"""Labelled fields of a cover page or a title block (Phase 0 cover details).

A label word starts a text line ("PROJECT:", "OWNER", "JOB NO."). Its value is, in this order:
  same_line  the text after the label on the same line                       (high)
  below      the 1 to 3 lines under the label, same cell, up to the next label (high / medium)
  above      (only when nothing is below or right) the line right above the label    (medium)
  right      the nearest text to the right in the same y-band (a table row)    (medium / low)
When both a cell below and a cell to the right exist, the NEARER one is the value and the other is
kept as an alternative. A value that is itself a label, is empty, or is longer than 200
characters is refused. Nothing is guessed: no label, no value.
"""

from __future__ import annotations

import re

from src.details.types import Cand, PageText, box_t, union
from src.pdf_scan.textlines import Line

MAX_VALUE = 200
BELOW_GAP = 1.5  # line heights between the label (or the line above) and the next value line
BELOW_LINES = 3
RIGHT_GAP_PAGE = 0.25  # of the page width
RIGHT_MEDIUM_PAGE = 0.12  # a right cell this near the label is medium, farther is low
X_LEFT_SLACK = 0.02  # of the page width: a cell below may start this far left of the label
X_RIGHT_SLACK = 0.12  # ... or this far right of the label's right edge

# (field, label regex, strict, keep_label). strict = the label needs a ":" or stands alone on its
# line (short, common words); keep_label = the label belongs to the value ("ISSUED FOR BID").
LABELS: tuple[tuple[str, str, bool, bool], ...] = (
    (
        "project_number",
        r"(?:PROJECT|JOB|COMMISSION|CONTRACT)\s*(?:NO|NUM|NUMBER|#)\b\.?",
        False,
        False,
    ),
    ("project_name", r"PROJECT\s+(?:NAME|TITLE)\b", False, False),
    ("project_name", r"PROJECT\b", True, False),
    ("owner", r"DESIGNED\s*\(\s*CLIENT\s*\)|OWNER\b|CLIENT\b", False, False),
    ("owner", r"PREPARED\s+FOR\b", True, False),
    (
        "location",
        r"(?:PROJECT|SITE)\s+(?:LOCATION|ADDRESS)\b|LOCATION\b",
        False,
        False,
    ),
    ("location", r"SITE\b|PLANT\b", True, False),
    ("architect", r"ARCHITECT(?:\s+OF\s+RECORD)?\b", False, False),
    (
        "engineer",
        r"STRUCTURAL\s+ENGINEER(?:\s+OF\s+RECORD)?\b|ENGINEER\s+OF\s+RECORD\b|SEOR\b",
        False,
        False,
    ),
    ("engineer", r"ENGINEER\b", True, False),
    ("contractor", r"(?:GENERAL\s+)?CONTRACTOR\b|CONSTRUCTION\s+MANAGER\b", False, False),
    ("contractor", r"GC\b|CM\b", True, False),
    ("date", r"ISSUE\s+DATE\b|DATE\s+ISSUED\b", False, False),
    ("date", r"DATE\b", True, False),
    ("issue", r"ISSUED\s+FOR\b", False, True),
    ("issue", r"ISSUE\b|REVISION\b|REV\b", True, False),
    ("building_code", r"BUILDING\s+CODES?\b", False, False),
    ("building_code", r"CODE\b", True, False),
    ("building_code", r"IBC\b", False, True),
    ("risk_category", r"RISK\s+CATEGORY\b", False, False),
    ("load_ground_snow", r"GROUND\s+SNOW\s+LOAD\b(?:\s*\(?PG\)?)?", False, False),
    ("load_roof_snow", r"ROOF\s+SNOW\s+LOAD\b", False, False),
    ("load_wind_speed", r"(?:BASIC|ULTIMATE|DESIGN)\s+WIND\s+SPEED\b|WIND\s+SPEED\b", False, False),
    ("load_seismic_category", r"SEISMIC\s+DESIGN\s+CATEGORY\b", False, False),
    ("load_site_class", r"SITE\s+CLASS\b", False, False),
    ("load_live", r"LIVE\s+LOAD\b", False, False),
    ("load_dead", r"DEAD\s+LOAD\b", False, False),
)
_COMPILED = [
    (f, re.compile(rf"^(?P<label>{rx})\s*(?P<sep>[:#.\-–]*)\s*(?P<rest>.*)$", re.IGNORECASE), s, k)
    for f, rx, s, k in LABELS
]
_REJECT_REST = re.compile(
    r"^(?:MANAGER|ENGINEER|DIRECTOR|REP\b|REPRESENTATIVE|'S\b|’S\b)", re.IGNORECASE
)
_DATE_RE = re.compile(
    r"\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})"
    r"|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+\d{1,2},?\s+\d{4}"
    r"|\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?,?\s+\d{4}"
    r"|\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)
_RISK_RE = re.compile(r"\b(IV|III|II|I|[1-4])\b")


# Fields whose value is a name (a firm, a person, a project): a function word or a verb at the start
# means the label sits inside a sentence ("CONTRACTOR TO FIELD VERIFY ..."), not before a value.
NAME_LIKE = ("project_name", "owner", "architect", "engineer", "contractor", "location")
_SENTENCE_START = re.compile(
    r"^(?:TO|OF|FOR|AND|OR|THE|BY|WITH|IN|ON|AT|AS|IS|ARE|BE|SHALL|WILL|MUST|SHOULD|MAY|CAN|THAT|"
    r"WHICH|VERIFY|PROVIDE|COORDINATE|REFER|SEE|NOTE|CONFIRM|CHECK|INSTALL|SUBMIT|FURNISH)\b",
    re.IGNORECASE,
)
SHORT_WORD = 3  # a name-like value that is one word of this many letters or fewer is a fragment


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def match_label(text: str) -> tuple[str, str, bool, bool] | None:
    """(field, rest, keep_label, alone) for a line that starts with a label, else None."""
    t = clean(text)
    best = None
    for f, rx, strict, keep in _COMPILED:
        m = rx.match(t)
        if not m:
            continue
        rest, sep = m.group("rest").strip(), m.group("sep")
        if strict and rest and ":" not in sep:
            continue
        if rest and _REJECT_REST.match(rest):
            continue
        if best is None or len(m.group("label")) > best[0]:
            best = (len(m.group("label")), (f, rest, keep, rest == ""))
    return None if best is None else best[1]


def is_label(text: str) -> bool:
    got = match_label(text)
    return got is not None and got[3]  # the whole line is just a label


def valid_value(field: str, value: str) -> str | None:
    """The cleaned value of the field, or None when it is not acceptable (never guessed)."""
    v = clean(value).strip(" :;,-")
    if not v or len(v) > MAX_VALUE or not re.search(r"[A-Za-z0-9]", v) or is_label(v):
        return None
    if field in NAME_LIKE:
        if _SENTENCE_START.match(v):
            return None  # a fragment of a sentence, not a name
        if len(v.split()) == 1 and len(v) <= SHORT_WORD:
            return None  # one very short word is not a name
    if field == "project_number":
        return v[:40] if re.search(r"\d", v) else None
    if field == "date":
        m = _DATE_RE.search(v)
        return m.group(0) if m else None
    if field == "risk_category":
        m = _RISK_RE.search(v.upper())
        return m.group(1) if m else None
    if field.startswith("load_"):
        return v[:60] if re.search(r"\d|[A-F]\b", v) else None
    return v


def _below(label: Line, lines: list[Line], pw: float) -> list[Line]:
    h = max(label.box.height, 1.0)
    out: list[Line] = []
    prev = label.box
    for ln in sorted((x for x in lines if x is not label), key=lambda x: x.box.y0):
        if ln.box.y0 < label.box.y1 - 0.3 * h:
            continue
        if not (label.box.x0 - X_LEFT_SLACK * pw <= ln.box.x0 <= label.box.x1 + X_RIGHT_SLACK * pw):
            continue
        if ln.box.y0 - prev.y1 > BELOW_GAP * h:
            break
        if is_label(ln.text) or match_label(ln.text) is not None:
            break
        out.append(ln)
        prev = ln.box
        if len(out) == BELOW_LINES:
            break
    return out


def _above(label: Line, lines: list[Line], pw: float) -> Line | None:
    """The single line right above a label (a title block that puts the label under its value)."""
    h = max(label.box.height, 1.0)
    best = None
    for ln in lines:
        if ln is label or ln.box.y1 > label.box.y0 + 0.3 * h:
            continue
        if not (label.box.x0 - X_LEFT_SLACK * pw <= ln.box.x0 <= label.box.x1 + X_RIGHT_SLACK * pw):
            continue
        gap = label.box.y0 - ln.box.y1
        if gap > BELOW_GAP * h:
            continue
        if best is None or gap < best[0]:
            best = (gap, ln)
    if best is None or is_label(best[1].text) or match_label(best[1].text) is not None:
        return None
    return best[1]


def _right(label: Line, lines: list[Line], pw: float) -> Line | None:
    best = None
    for ln in lines:
        if ln is label or ln.box.x0 < label.box.x1 - 1.0:
            continue
        overlap = min(ln.box.y1, label.box.y1) - max(ln.box.y0, label.box.y0)
        if overlap < 0.5 * min(ln.box.height, label.box.height):
            continue
        gap = ln.box.x0 - label.box.x1
        if gap > RIGHT_GAP_PAGE * pw or is_label(ln.text) or match_label(ln.text) is not None:
            continue
        if best is None or gap < best[0]:
            best = (gap, ln)
    return None if best is None else best[1]


def _cap(c: Cand) -> Cand:
    """A one-word name is weak evidence (a fragment of a phrase is likelier than a one-word firm):
    never high, never medium."""
    if c.field in NAME_LIKE and len(c.value.split()) == 1:
        c.confidence = "low"
    return c


def find_label_fields(page: PageText, lines: list[Line] | None = None) -> list[Cand]:
    """Every labelled value on a page (the lines given, default all). Several per field possible."""
    lines = page.lines if lines is None else lines
    out: list[Cand] = []
    claimed: set[int] = set()  # lines that are the value below some label: not a value above one
    for label in lines:
        got = match_label(label.text)
        if got is not None and got[3]:
            claimed.update(id(b) for b in _below(label, lines, page.width))
    for label in lines:
        got = match_label(label.text)
        if got is None:
            continue
        fld, rest, keep, alone = got
        if not alone:
            text = clean(label.text) if keep else rest
            value = valid_value(fld, text)
            if value:
                out.append(
                    _cap(Cand(fld, value, page.page_index, box_t(label.box), "same_line", "high"))
                )
            continue
        cells: list[tuple[float, str, list[Line], str, str]] = []
        below = _below(label, lines, page.width)
        if below:
            gap = below[0].box.y0 - label.box.y1
            conf = "high" if len(below) == 1 else "medium"
            cells.append((max(gap, 0.0), "below", below, conf, " ".join(b.text for b in below)))
        right = _right(label, lines, page.width)
        if right is not None:
            gap = right.box.x0 - label.box.x1
            conf = "medium" if gap <= RIGHT_MEDIUM_PAGE * page.width else "low"
            cells.append((max(gap, 0.0), "right", [right], conf, right.text))
        if not cells:  # value above the label: only when nothing is below or to the right
            above = _above(label, lines, page.width)
            if above is not None and id(above) not in claimed:
                gap = label.box.y0 - above.box.y1
                cells.append((max(gap, 0.0), "above", [above], "medium", above.text))
        cells.sort(key=lambda c: c[0])
        for k, (_gap, rule, ls, conf, text) in enumerate(cells):
            value = valid_value(fld, (keep and clean(label.text) + " " or "") + text)
            if not value:
                continue
            cand = _cap(Cand(fld, value, page.page_index, union([x.box for x in ls]), rule, conf))
            if k > 0:
                cand.flags.append("second_cell")  # the nearer cell won; this is its alternative
            out.append(cand)
    return out
