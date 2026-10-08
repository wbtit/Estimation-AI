"""Steel joist designations of the Steel Joist Institute series: K, LH and DLH.

Examples: 24K7, 28LH10, 40DLH15, 18LH02 (spacing variants such as "24 K 7" and "24-K-7" read the
same). Pure functions; the raw string is kept beside the canonical form (depth, series and number
digits as written, uppercase, no spaces: 24K7).

A joist is NEVER matched to the AISC shape catalog. This parser only says "this text is a joist
designation"; it does not know which depths or series numbers exist (no table is invented), so it
checks the form only. Python and TypeScript parsers share fixtures/synthetic/joist-cases.json.
"""

import re
from dataclasses import dataclass

# Not part of a longer word or a profile like W12X26 K1 (a letter, digit, dot, slash or hyphen
# before the depth means the digits belong to something else).
_START = r"(?<![A-Za-z0-9./-])"
_END = r"(?![A-Za-z0-9])"
_SEP = r"[\s-]*"
_JOIST = rf"(?P<depth>\d{{1,3}}){_SEP}(?P<series>DLH|LH|K){_SEP}(?P<number>\d{{1,2}})"
_RE_FIND = re.compile(rf"{_START}{_JOIST}{_END}", re.IGNORECASE)
_RE_WHOLE = re.compile(rf"^\s*{_JOIST}\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class Joist:
    raw: str
    canonical: str
    series: str  # "K" | "LH" | "DLH"
    depth: str  # digits as written
    number: str  # digits as written
    span: tuple[int, int]


def _make(m: re.Match[str], offset: int = 0) -> Joist:
    depth, series, number = m.group("depth"), m.group("series").upper(), m.group("number")
    return Joist(
        raw=m.group(0).strip(),
        canonical=f"{depth}{series}{number}",
        series=series,
        depth=depth,
        number=number,
        span=(m.start() + offset, m.end() + offset),
    )


def find_joists(text: str) -> list[Joist]:
    """Every joist designation in a line, in order."""
    return [_make(m) for m in _RE_FIND.finditer(text)]


def parse_joist(text: str) -> Joist | None:
    """The joist if the whole text is exactly one designation, else None."""
    m = _RE_WHOLE.match(text)
    return _make(m) if m else None
