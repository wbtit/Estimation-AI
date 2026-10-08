"""Feet-inch dimension strings to millimetres, with exact fractions.

Accepted: 12'-6 1/2", 12'-6", 12'6", 12' - 6", 3'-0", 12' (feet only), 6", 1/2", 3 1/4", 6.5"
and the mixed hyphen form 12'-6-1/2". Typographic quotes (prime, double prime, curly quotes), en
and em dashes and the minus sign are accepted as their ASCII forms; two apostrophes mean inches.
A string with neither a foot nor an inch mark is not a dimension. Inches are exact fractions; the
result is millimetres (25.4 mm per inch) rounded to 0.001 mm.
"""

import re
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from src.pdf_scan.scale import normalize as normalize_typography
from src.text_layer.parsers.numbers import fraction_text, to_fraction

_FRAC_OR_DEC = r"\d+\s*/\s*\d+|\d*\.\d+"
# inches value: "6", "6 1/2", "6-1/2", "1/2", "6.5"
_INCH_VALUE = rf"(?:\d+\s*[-\s]\s*\d+\s*/\s*\d+|{_FRAC_OR_DEC}|\d+)"
_BEFORE = r"(?<![\d/.'\"])"
_AFTER = r"(?![\d/]|\.\d)"

_FEET_INCHES = re.compile(
    rf"{_BEFORE}(?P<ft>\d+(?:\.\d+)?)\s*'\s*-?\s*(?P<in>{_INCH_VALUE})\s*(?P<mark>\")?{_AFTER}"
)
_FEET_ONLY = re.compile(rf"{_BEFORE}(?P<ft>\d+(?:\.\d+)?)\s*'(?!\s*-?\s*\d)")
_INCHES_ONLY = re.compile(rf"{_BEFORE}(?P<in>{_INCH_VALUE})\s*\"")

MM_PER_INCH = Fraction(254, 10)


@dataclass(frozen=True)
class Dimension:
    raw: str
    feet: Fraction
    inches: Fraction  # the inches part as written (0 for feet only)
    mm: float
    flags: tuple[str, ...]
    span: tuple[int, int]

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "dimension",
            "raw": self.raw,
            "feet": fraction_text(self.feet),
            "inches": fraction_text(self.inches),
            "mm": self.mm,
            "flags": list(self.flags),
        }


def _clean(text: str) -> str:
    t = normalize_typography(text).replace("''", '"')
    return re.sub(r"\s+", " ", t).strip()


def _build(m: re.Match[str], feet: Fraction, inches: Fraction, flags: list[str]) -> Dimension:
    total = feet * 12 + inches
    return Dimension(
        raw=re.sub(r"\s+", " ", m.group(0)).strip(),
        feet=feet,
        inches=inches,
        mm=round(float(total * MM_PER_INCH), 3),
        flags=tuple(flags),
        span=(m.start(), m.end()),
    )


def find_dimensions(text: str) -> list[Dimension]:
    """Every feet-inch dimension in a line of text, in order of appearance."""
    clean = _clean(text)
    found: list[Dimension] = []
    for m in _FEET_INCHES.finditer(clean):
        ft, inch = to_fraction(m.group("ft")), to_fraction(m.group("in"))
        if ft is None or inch is None:
            continue
        flags = []
        if m.group("mark") is None:
            flags.append("inch_mark_missing")
        if inch >= 12:
            flags.append("inches_ge_12")
        found.append(_build(m, ft, inch, flags))
    for m in _FEET_ONLY.finditer(clean):
        ft = to_fraction(m.group("ft"))
        if ft is not None and not any(d.span[0] <= m.start() < d.span[1] for d in found):
            found.append(_build(m, ft, Fraction(0), []))
    for m in _INCHES_ONLY.finditer(clean):
        inch = to_fraction(m.group("in"))
        if inch is not None and not any(d.span[0] <= m.start() < d.span[1] for d in found):
            flags = ["inches_ge_12"] if inch >= 12 else []
            found.append(_build(m, Fraction(0), inch, flags))
    found.sort(key=lambda d: d.span[0])
    return found


def parse_dimension(text: str) -> Dimension | None:
    """The dimension if the whole text is exactly one dimension, else None."""
    clean = _clean(text)
    found = find_dimensions(clean)
    if len(found) == 1 and found[0].span == (0, len(clean)):
        return found[0]
    return None
