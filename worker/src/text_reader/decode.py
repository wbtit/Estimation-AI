"""Decode an upright line with confirmed glyph labels and the fixed small-mark rules.

Unknown shapes (no entry within tolerance, or an entry that is not confirmed) decode to '?' and are
counted. Nothing is guessed.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from src.text_reader import rules
from src.text_reader.library import Entry
from src.text_reader.lines import Line, typical_height
from src.text_reader.strokes import Cluster

_CAP_RE = re.compile(r"^[A-Z0-9]$")


@dataclass
class _El:
    c: Cluster
    label: str | None  # None = unknown shape
    kind: str  # "glyph" | "dot"
    drop: bool = False


@dataclass
class DecodedLine:
    text: str
    unknown_count: int
    char_count: int


def decode_line(line: Line, lookup: Callable[[Cluster], Entry | None]) -> DecodedLine:
    r = typical_height(line)
    els: list[_El] = []
    for c in line.members + line.marks:
        if c.w < rules.DOT_MAX_PT and c.h < rules.DOT_MAX_PT:
            els.append(_El(c, ".", "dot"))
            continue
        e = lookup(c)
        els.append(_El(c, e.label if e is not None and e.decodes else None, "glyph"))
    els.sort(key=lambda el: (el.c.x0, el.c.y0))

    # '-' bars: a long one is an underline (dropped); two stacked equal bars form '='.
    bars = [el for el in els if el.kind == "glyph" and el.label == "-"]
    for el in bars:
        if el.c.w > rules.UNDERLINE_WIDTH_R * r:
            el.drop = True
    live = [el for el in bars if not el.drop]
    for a in live:
        if a.drop:
            continue
        for b in live:
            dy = abs(a.c.cy - b.c.cy)
            if (
                b is not a
                and not b.drop
                and abs(a.c.x0 - b.c.x0) <= rules.EQUALS_EDGE_TOL_PT
                and abs(a.c.x1 - b.c.x1) <= rules.EQUALS_EDGE_TOL_PT
                and rules.EQUALS_MIN_DY_R * r <= dy <= rules.EQUALS_MAX_DY_R * r
            ):
                a.label = "="
                b.drop = True
                break

    # two stacked dots form ':'
    dots = [el for el in els if el.kind == "dot" and not el.drop]
    for a in dots:
        if a.drop:
            continue
        for b in dots:
            if (
                b is not a
                and not b.drop
                and abs(a.c.cx - b.c.cx) <= rules.COLON_DX_PT
                and abs(a.c.cy - b.c.cy) >= rules.COLON_MIN_DY_PT
            ):
                a.label = ":"
                b.drop = True
                break

    kept = [el for el in els if not el.drop]
    cap_heights = [
        el.c.h for el in kept if el.kind == "glyph" and el.label and _CAP_RE.match(el.label)
    ]
    cap = max(cap_heights) if cap_heights else None
    out: list[str] = []
    unknown = 0
    prev: _El | None = None
    for el in kept:
        if prev is not None and el.c.x0 - prev.c.x1 > rules.WORD_SPACE_R * r:
            out.append(" ")
        label = el.label
        if label is None:
            label = "?"
            unknown += 1
        elif (
            cap is not None
            and label.isalpha()
            and len(label) == 1
            and el.c.h < rules.LOWERCASE_BELOW_C * cap
        ):
            label = label.lower()
        out.append(label)
        prev = el
    text = "".join(out)
    return DecodedLine(text=text, unknown_count=unknown, char_count=len(text.replace(" ", "")))
