"""Steel profile strings: W M S HP C MC L WT MT ST HSS PIPE PL ROD.

Pure functions. Every result keeps the raw string beside the canonical form. Canonical form:
uppercase, no spaces, "X" separator, fractions as written ("1/4"), decimals as decimals ("0.25"),
mixed numbers with a hyphen ("3-1/2"): W12X26, HSS6X4X1/4, L3-1/2X3X1/4, PIPE4STD, PL1/2X8, ROD3/4.

Catalog validation (CatalogMatcher) normalizes both sides identically. A fraction and a decimal
match ONLY by exact numeric equality (1/4 = 0.25 = .250) and are reported as
"matched_by_numeric_equivalence". There is no other fuzzy matching. Pipe, plate and rod match only
by exact normalized name. Without a catalog, or without a match: "unvalidated".
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from src.pdf_scan.scale import normalize as normalize_typography
from src.text_layer.parsers.dimension import parse_dimension
from src.text_layer.parsers.numbers import NUM, canonical_number, fraction_text, to_fraction

# Separators between dimensions: x, X, the multiplication sign, and the heavy multiplication X.
_X = r"\s*[xX×✕✖]\s*"
_DEC = r"\d+(?:\.\d+)?"
_START = r"(?<![A-Za-z0-9])"
_END = r"(?![0-9/]|\.\d)"
_INCH = r"\s*(?:\"|IN\b\.?)?\s*"

_RE_SIMPLE = re.compile(
    rf"{_START}(?P<fam>WT|MT|ST|HP|MC|W|M|S|C)\s*(?P<a>{_DEC}){_X}(?P<b>{_DEC}){_END}",
    re.IGNORECASE,
)
_RE_L = re.compile(
    rf"{_START}(?P<fam>L)\s*(?P<a>{NUM}){_X}(?P<b>{NUM}){_X}(?P<c>{NUM}){_END}",
    re.IGNORECASE,
)
_RE_HSS = re.compile(
    rf"{_START}HSS\s*(?P<a>{NUM}){_X}(?P<b>{NUM})(?:{_X}(?P<c>{NUM}))?{_END}",
    re.IGNORECASE,
)
_RE_PIPE = re.compile(
    rf"{_START}PIPE\s*(?P<a>{NUM}){_INCH}(?P<cls>XXS|XXH|STD|XS|XH|SCH\s*\d+)?(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_RE_PL = re.compile(
    rf"{_START}PL\s*(?P<a>{NUM}){_INCH}{_X}(?P<b>{NUM}){_INCH}"
    rf"(?:{_X}(?P<c>\d+\s*'(?:\s*-?\s*{NUM}\s*\")?|{NUM}\"?))?{_END}",
    re.IGNORECASE,
)
_RE_ROD_PREFIX = re.compile(rf"{_START}ROD\s*(?P<a>{NUM}){_END}", re.IGNORECASE)
_RE_ROD_SUFFIX = re.compile(
    rf"(?<![0-9/.])(?P<a>{NUM}){_INCH}(?:Ø|ø|∅|DIA(?:METER)?\.?)?\s*"
    r"(?:THREADED\s+|ALL[\s-]?THREAD(?:ED)?\s+|TIE\s+|HIGH[\s-]STRENGTH\s+)?ROD(?![A-Za-z0-9])",
    re.IGNORECASE,
)

NUMERIC_FAMILIES = frozenset({"W", "M", "S", "HP", "C", "MC", "L", "WT", "MT", "ST", "HSS"})
EXACT_ONLY_FAMILIES = frozenset({"PIPE", "PL", "ROD"})


@dataclass(frozen=True)
class Profile:
    raw: str  # as it appears in the text (typographic characters normalized, whitespace collapsed)
    family: str
    canonical: str
    dims: tuple[Fraction, ...]  # exact numeric values, in the order written
    variant: str | None  # HSS: "rectangular" | "square" | "round"; PIPE: weight class
    flags: tuple[str, ...]
    span: tuple[int, int]  # in the normalized text passed to find_profiles
    length_mm: float | None = None  # plate length when written as a third dimension

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "profile",
            "raw": self.raw,
            "family": self.family,
            "canonical": self.canonical,
            "dims": [fraction_text(d) for d in self.dims],
            "variant": self.variant,
            "flags": list(self.flags),
            "length_mm": self.length_mm,
        }


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", normalize_typography(text)).strip()


def _dims(*texts: str | None) -> tuple[tuple[Fraction, ...], list[str]] | None:
    out: list[Fraction] = []
    canon: list[str] = []
    for t in texts:
        if t is None:
            continue
        v = to_fraction(t)
        if v is None or v <= 0:
            return None
        out.append(v)
        canon.append(canonical_number(t))
    return tuple(out), canon


def _make(m: re.Match[str], family: str, canon_parts: list[str], dims, variant, flags, length=None):
    return Profile(
        raw=re.sub(r"\s+", " ", m.group(0)).strip(),
        family=family,
        canonical=family + "X".join(canon_parts),
        dims=dims,
        variant=variant,
        flags=tuple(flags),
        span=(m.start(), m.end()),
        length_mm=length,
    )


def _plate_length(text: str | None) -> tuple[float | None, list[str]]:
    if text is None:
        return None, []
    t = text.strip()
    if "'" in t or '"' in t:
        d = parse_dimension(t)
        return (d.mm, []) if d else (None, ["plate_length_unparsed"])
    v = to_fraction(t)
    return (float(v * Fraction(254, 10)), ["plate_length_assumed_inches"]) if v else (None, [])


def find_profiles(text: str) -> list[Profile]:
    """Every profile expression in a line, in order; overlaps keep the first and longest."""
    clean = _clean(text)
    found: list[Profile] = []

    for m in _RE_HSS.finditer(clean):
        got = _dims(m.group("a"), m.group("b"), m.group("c"))
        if got:
            dims, canon = got
            if m.group("c") is None:
                found.append(_make(m, "HSS", canon, dims, "round", []))
            else:
                variant = "square" if dims[0] == dims[1] else "rectangular"
                found.append(_make(m, "HSS", canon, dims, variant, []))
    for m in _RE_L.finditer(clean):
        got = _dims(m.group("a"), m.group("b"), m.group("c"))
        if got:
            dims, canon = got
            found.append(
                _make(m, "L", canon, dims, "equal" if dims[0] == dims[1] else "unequal", [])
            )
    for m in _RE_SIMPLE.finditer(clean):
        got = _dims(m.group("a"), m.group("b"))
        if got:
            dims, canon = got
            found.append(_make(m, m.group("fam").upper(), canon, dims, None, []))
    for m in _RE_PIPE.finditer(clean):
        got = _dims(m.group("a"))
        if got:
            dims, canon = got
            cls = re.sub(r"\s+", "", (m.group("cls") or "").upper())
            flags = [] if cls else ["pipe_weight_class_missing"]
            p = _make(m, "PIPE", [canon[0] + cls], dims, cls or None, flags)
            found.append(p)
    for m in _RE_PL.finditer(clean):
        got = _dims(m.group("a"), m.group("b"))
        if got:
            dims, canon = got
            length, flags = _plate_length(m.group("c"))
            found.append(_make(m, "PL", canon, dims, None, flags, length))
    for rx in (_RE_ROD_PREFIX, _RE_ROD_SUFFIX):
        for m in rx.finditer(clean):
            got = _dims(m.group("a"))
            if got:
                dims, canon = got
                found.append(_make(m, "ROD", canon, dims, None, []))

    # overlaps: keep the earliest, then the longest
    found.sort(key=lambda p: (p.span[0], -(p.span[1] - p.span[0])))
    kept: list[Profile] = []
    for p in found:
        if kept and p.span[0] < kept[-1].span[1]:
            continue
        kept.append(p)
    return kept


def parse_profile(text: str) -> Profile | None:
    """The profile if the whole text is exactly one profile expression, else None."""
    clean = _clean(text)
    found = find_profiles(clean)
    if len(found) == 1 and found[0].span == (0, len(clean)):
        return found[0]
    return None


# --- catalog validation ------------------------------------------------------------------------
def normalize_name(name: str) -> str:
    """Normalized shape name: the canonical form if it parses, else uppercase without spaces."""
    p = parse_profile(name)
    if p is not None:
        return p.canonical
    return re.sub(r"\s+", "", _clean(name).upper().replace("×", "X"))


@dataclass(frozen=True)
class Validation:
    status: str  # "matched_exact" | "matched_by_numeric_equivalence" | "unvalidated"
    catalog_name: str | None = None
    reason: str | None = None  # why unvalidated

    def to_json(self) -> dict[str, Any]:
        return {"status": self.status, "catalog_name": self.catalog_name, "reason": self.reason}


class CatalogMatcher:
    """Matches parsed profiles to catalog shape names. No catalog: everything is unvalidated."""

    def __init__(self, names: Iterable[str] | None):
        self.loaded = names is not None
        self._exact: dict[str, str] = {}
        self._numeric: dict[tuple[str, tuple[Fraction, ...]], set[str]] = {}
        for name in names or ():
            self._exact.setdefault(normalize_name(name), name)
            p = parse_profile(name)
            if p is not None and p.family in NUMERIC_FAMILIES:
                self._numeric.setdefault((p.family, p.dims), set()).add(name)

    def validate(self, profile: Profile) -> Validation:
        if not self.loaded:
            return Validation("unvalidated", reason="catalog_not_loaded")
        exact = self._exact.get(profile.canonical)
        if exact is not None:
            return Validation("matched_exact", exact)
        if profile.family in NUMERIC_FAMILIES:
            names = self._numeric.get((profile.family, profile.dims), set())
            if len(names) == 1:
                return Validation("matched_by_numeric_equivalence", next(iter(names)))
            if len(names) > 1:
                return Validation("unvalidated", reason="catalog_ambiguous")
        return Validation("unvalidated", reason="no_catalog_match")
