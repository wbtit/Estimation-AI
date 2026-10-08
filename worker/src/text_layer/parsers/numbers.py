"""Shared number grammar: integers, decimals, fractions and mixed numbers, as exact Fractions."""

import re
from fractions import Fraction

# Mixed ("3 1/2" or "3-1/2"), fraction ("1/4"), decimal (".25", "0.25", "6.5") or integer.
NUM = r"(?:\d+\s+\d+\s*/\s*\d+|\d+\s*-\s*\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d*\.\d+|\d+)"

_MIXED_RE = re.compile(r"^(\d+)\s*[-\s]\s*(\d+)\s*/\s*(\d+)$")
_FRAC_RE = re.compile(r"^(\d+)\s*/\s*(\d+)$")


def to_fraction(text: str) -> Fraction | None:
    """Exact value of a number in the NUM grammar (None if invalid, e.g. a zero denominator)."""
    t = text.strip()
    try:
        m = _MIXED_RE.match(t)
        if m:
            whole, n, d = (int(g) for g in m.groups())
            return Fraction(whole) + Fraction(n, d)
        m = _FRAC_RE.match(t)
        if m:
            return Fraction(int(m.group(1)), int(m.group(2)))
        return Fraction(t)
    except (ZeroDivisionError, ValueError):
        return None


def canonical_number(text: str) -> str:
    """The number as written, normalized: "n/d", mixed "a-n/d", decimals with a leading 0."""
    t = text.strip()
    m = _MIXED_RE.match(t)
    if m:
        return f"{m.group(1)}-{m.group(2)}/{m.group(3)}"
    m = _FRAC_RE.match(t)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    return "0" + t if t.startswith(".") else t


def fraction_text(value: Fraction) -> str:
    """JSON-friendly exact text of a Fraction."""
    return str(value)
