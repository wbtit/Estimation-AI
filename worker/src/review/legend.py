"""Legend and schedule rows: a mark followed closely by a profile (B1: HSS6x4x1/4, B2 W12x26 ...).

Works on the words of a page (displayed boxes). Words that sit on one text row and close together
form a segment; a segment of at most MAX_TOKENS tokens with a mark-shaped token before a profile is
a legend row. The mark is the token; the designation is the profile exactly as written; whatever
follows the profile in the segment is kept as remarks. Nothing here decides what a mark means for a
member: a row is a suggestion for the mark-to-profile link.
"""

import re
from dataclasses import dataclass

from src.text_layer.parsers.marks import MARK_RE
from src.text_layer.parsers.profile import find_profiles

ROW_TOLERANCE = 0.5  # of the text height: words closer than this in y are on one row
SEGMENT_GAP = 10.0  # of the text height: a larger horizontal gap ends the segment
MAX_TOKENS = 10
MAX_BETWEEN = 2  # tokens allowed between the mark and the profile (":" "=" "-")


@dataclass(frozen=True)
class WordBox:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(frozen=True)
class LegendRow:
    mark: str
    designation_raw: str
    profile: str | None
    remarks_raw: str | None
    bbox: tuple[float, float, float, float]


def _segments(words: list[WordBox]) -> list[list[WordBox]]:
    ordered = sorted(words, key=lambda w: ((w.y0 + w.y1) / 2, w.x0))
    rows: list[list[WordBox]] = []
    for w in ordered:
        h = max(w.y1 - w.y0, 1.0)
        if (
            rows
            and abs((rows[-1][0].y0 + rows[-1][0].y1) / 2 - (w.y0 + w.y1) / 2) <= ROW_TOLERANCE * h
        ):
            rows[-1].append(w)
        else:
            rows.append([w])
    segments: list[list[WordBox]] = []
    for row in rows:
        row.sort(key=lambda w: w.x0)
        cur = [row[0]]
        for w in row[1:]:
            h = max(w.y1 - w.y0, 1.0)
            if w.x0 - cur[-1].x1 > SEGMENT_GAP * h:
                segments.append(cur)
                cur = [w]
            else:
                cur.append(w)
        segments.append(cur)
    return segments


def legend_rows(words: list[WordBox]) -> list[LegendRow]:
    out: list[LegendRow] = []
    seen: set[tuple[str, str]] = set()
    for seg in _segments(words):
        if not 2 <= len(seg) <= MAX_TOKENS:
            continue
        text = " ".join(w.text for w in seg)
        profiles = find_profiles(text)
        if not profiles:
            continue
        p = profiles[0]
        # token index where the profile starts
        before = text[: p.span[0]].split()
        marks = [(i, t.strip(",;:()[]\"'=-").upper()) for i, t in enumerate(before)]
        marks = [(i, t) for i, t in marks if MARK_RE.match(t)]
        if not marks:
            continue
        i, mark = marks[-1]  # the mark closest before the profile
        if len(before) - 1 - i > MAX_BETWEEN:
            continue
        key = (mark, p.canonical)
        if key in seen:
            continue
        seen.add(key)
        rest = re.sub(r"\s+", " ", text[p.span[1] :]).strip(" :=-,;") or None
        bbox = (
            min(w.x0 for w in seg),
            min(w.y0 for w in seg),
            max(w.x1 for w in seg),
            max(w.y1 for w in seg),
        )
        out.append(LegendRow(mark, p.raw, p.canonical, rest, bbox))
    return out
