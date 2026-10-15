"""Shear studs and camber written next to a beam size (Phase 11). Pure, raw string kept.

Studs: a count in angle brackets, `<12>` (spaces allowed inside). Camber: `C=` followed by a
number of inches with an optional inch mark, `C=3/4"`, `C = 1 1/2"`, `C=1.25`. A camber written in
feet or with any other unit is not read (no value guessed). Both are found anywhere in a line, the
first one wins; a line with two different stud counts or cambers gives none (ambiguous).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction

from src.text_layer.parsers.numbers import NUM, to_fraction

_STUDS = re.compile(r"<\s*(\d{1,3})\s*>")
_CAMBER = re.compile(
    rf"(?<![A-Za-z0-9])C\s*=\s*(?P<v>{NUM})(?![\d./])\s*(?P<unit>\"|''|IN\.?)?(?!\s*')",
    re.IGNORECASE,
)
MM_PER_INCH = Fraction(254, 10)


@dataclass(frozen=True)
class Studs:
    raw: str
    count: int


@dataclass(frozen=True)
class Camber:
    raw: str
    inches: Fraction

    @property
    def mm(self) -> float:
        return float(self.inches * MM_PER_INCH)


def find_studs(text: str) -> Studs | None:
    found = {(m.group(0), int(m.group(1))) for m in _STUDS.finditer(text)}
    counts = {c for _, c in found}
    if len(counts) != 1:
        return None
    raw, count = min(found)
    return Studs(raw=raw, count=count)


def find_camber(text: str) -> Camber | None:
    out: dict[Fraction, str] = {}
    for m in _CAMBER.finditer(text):
        v = to_fraction(m.group("v"))
        if v is not None and v > 0:
            out.setdefault(v, re.sub(r"\s+", " ", m.group(0)).strip())
    if len(out) != 1:
        return None
    inches, raw = next(iter(out.items()))
    return Camber(raw=raw, inches=inches)
