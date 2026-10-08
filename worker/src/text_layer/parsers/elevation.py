"""Elevation notes: T.O.S., T/STL, T.O.B., B.O.S., EL., and signed offsets such as +4'-0".

The datum is never known from the text: `datum_unknown` is always true. Notes with an explicit sign
are offsets (`is_relative`); they are not combined with any other value and not assigned to
members. A decimal elevation without a unit ("EL. 100.50") is not converted (`unit_unclear`).
A dimension with neither a sign, an EL token nor a reference keyword is not an elevation.
"""

import re
from dataclasses import dataclass
from typing import Any

from src.pdf_scan.scale import normalize as normalize_typography
from src.text_layer.parsers.dimension import find_dimensions

_REFERENCES = (
    (
        "top_of_steel",
        r"T\.?\s?O\.?\s?S\.?|T\s?/\s?STL|T\s?/\s?S|T\.?\s?O\.?\s?STL\.?|TOP\s+OF\s+STEEL",
    ),
    ("top_of_beam", r"T\.?\s?O\.?\s?B\.?|T\s?/\s?B|TOP\s+OF\s+BEAM"),
    ("bottom_of_steel", r"B\.?\s?O\.?\s?S\.?|B\s?/\s?STL|B\s?/\s?S|BOTTOM\s+OF\s+STEEL"),
    ("bottom_of_beam", r"B\.?\s?O\.?\s?B\.?|BOTTOM\s+OF\s+BEAM"),
    ("top_of_concrete", r"T\.?\s?O\.?\s?C\.?|TOP\s+OF\s+CONCRETE"),
    ("top_of_wall", r"T\.?\s?O\.?\s?W\.?|TOP\s+OF\s+WALL"),
)
_REF_END = [
    (name, re.compile(rf"(?<![A-Za-z0-9])(?:{rx})$", re.IGNORECASE)) for name, rx in _REFERENCES
]
_EL = r"EL(?:EV(?:ATION)?)?\.?"
_EL_END = re.compile(rf"(?<![A-Za-z0-9]){_EL}$", re.IGNORECASE)
_SIGN_END = re.compile(r"(?:^|(?<=[\s(=:]))(?P<sign>\+\s*/\s*-|±|[+\-])\s*$")
_DECIMAL_EL = re.compile(
    rf"(?<![A-Za-z0-9])(?:{_EL})\s*=?\s*(?P<v>[+-]?\d+\.\d+)(?![\d'\"])", re.IGNORECASE
)
_GLUE = " =:("


@dataclass(frozen=True)
class Elevation:
    raw: str
    reference: str | None  # "top_of_steel", "top_of_beam", ... or None
    is_relative: bool
    sign: str | None  # "+", "-", "+/-" or None
    value_mm: float | None
    datum_unknown: bool
    flags: tuple[str, ...]
    span: tuple[int, int]

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "elevation",
            "raw": self.raw,
            "reference": self.reference,
            "is_relative": self.is_relative,
            "sign": self.sign,
            "value_mm": self.value_mm,
            "datum_unknown": self.datum_unknown,
            "flags": list(self.flags),
        }


def _clean(text: str) -> str:
    # normalize_typography maps en/em dashes and the minus sign to "-"; the plus-minus sign stays
    return re.sub(r"\s+", " ", normalize_typography(text)).strip()


def find_elevations(text: str) -> list[Elevation]:
    clean = _clean(text)
    out: list[Elevation] = []
    for dim in find_dimensions(clean):
        pre = clean[: dim.span[0]]
        pos = dim.span[0]
        sign = None
        m = _SIGN_END.search(pre)
        if m:
            raw_sign = m.group("sign")
            sign = "+/-" if raw_sign == "±" or "/" in raw_sign else raw_sign
            pos = m.start("sign")
            pre = pre[:pos]
        pre = pre.rstrip(_GLUE)
        has_el = False
        m = _EL_END.search(pre)
        if m:
            has_el = True
            pos = m.start()
            pre = pre[: m.start()].rstrip(_GLUE)
        reference = None
        for name, rx in _REF_END:
            m = rx.search(pre)
            if m:
                reference, pos = name, m.start()
                break
        if reference is None and not has_el and sign is None:
            continue  # a bare dimension is not an elevation
        flags = list(dim.flags)
        value = dim.mm
        if sign == "-":
            value = -value
        if sign == "+/-":
            flags.append("sign_ambiguous")
        out.append(
            Elevation(
                raw=re.sub(r"\s+", " ", clean[pos : dim.span[1]]).strip(),
                reference=reference,
                is_relative=sign is not None,
                sign=sign,
                value_mm=value,
                datum_unknown=True,
                flags=tuple(flags),
                span=(pos, dim.span[1]),
            )
        )
    for m in _DECIMAL_EL.finditer(clean):
        if not any(e.span[0] <= m.start() < e.span[1] for e in out):
            out.append(
                Elevation(
                    raw=m.group(0).strip(),
                    reference=None,
                    is_relative=False,
                    sign=None,
                    value_mm=None,
                    datum_unknown=True,
                    flags=("unit_unclear",),
                    span=(m.start(), m.end()),
                )
            )
    out.sort(key=lambda e: e.span[0])
    return out


def parse_elevation(text: str) -> Elevation | None:
    """The elevation note if the whole text is exactly one, else None."""
    clean = _clean(text)
    found = find_elevations(clean)
    return found[0] if len(found) == 1 and found[0].span == (0, len(clean)) else None
