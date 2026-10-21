"""Phase 12c-A check: the estimators' Bluebeam calibration stored as /BBMeasure.

Bluebeam keeps the scale of some markups (area and perimeter shapes) in its own /BBMeasure
dictionary, a PDF measure dictionary (/Type /Measure /Subtype /RL) with a number format array /X
whose /C is the real units per drawn point and /U the unit. Used only to CHECK the scale our runs
used; nothing is built from it. Pure apart from `resolve` (an xref -> object text lookup).
"""

from __future__ import annotations

import re
from collections.abc import Callable

UNIT_INCH = {"in": 1.0, "ft": 12.0, "mm": 1 / 25.4, "cm": 10 / 25.4, "m": 1000 / 25.4, "yd": 36.0}
UNIT_ALIASES = {"'": "ft", '"': "in", "inch": "in", "inches": "in", "foot": "ft", "feet": "ft"}

_REF = re.compile(r"\s*(\d+)\s+0\s+R")


def _dict_at(text: str, start: int) -> str | None:
    """The balanced << ... >> beginning at `start` (whitespace allowed before it)."""
    i = text.find("<<", start)
    if i < 0 or text[start:i].strip():
        return None
    depth, k = 0, i
    while k < len(text) - 1:
        if text.startswith("<<", k):
            depth += 1
            k += 2
        elif text.startswith(">>", k):
            depth -= 1
            k += 2
            if depth == 0:
                return text[i:k]
        else:
            k += 1
    return None


def _value(text: str, start: int, resolve: Callable[[int], str]) -> str | None:
    """An inline dictionary at `start`, or the object a reference there points to."""
    d = _dict_at(text, start)
    if d is not None:
        return d
    m = _REF.match(text, start)
    return resolve(int(m.group(1))) if m else None


def bb_measure_ratio(obj: str, resolve: Callable[[int], str]) -> float | None:
    """Real length / drawn length from an annotation's /BBMeasure, or None."""
    i = obj.find("/BBMeasure")
    if i < 0:
        return None
    measure = _value(obj, i + len("/BBMeasure"), resolve)
    if not measure or "/Measure" not in measure:
        return None
    x = re.search(r"/X\s*\[", measure)
    if not x:
        return None
    fmt = _value(measure, x.end(), resolve)
    if not fmt:
        return None
    c = re.search(r"/C\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", fmt)
    u = re.search(r"/U\s*\(([^)]*)\)", fmt)
    if not c or not u:
        return None
    unit = u.group(1).strip().lower().rstrip(".")
    unit = UNIT_ALIASES.get(unit, unit)
    if unit not in UNIT_INCH or float(c.group(1)) <= 0:
        return None
    return float(c.group(1)) * UNIT_INCH[unit] * 72.0
