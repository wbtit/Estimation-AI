"""Drawing scale parsing.

A scale is stored as the matched text plus a numeric ratio = real length / drawn length, so
1/8" = 1'-0" is 96, 1" = 20' is 240 and 1:50 is 50. "Not to scale" has no ratio.

Two entry points share one grammar:
  * parse_scale_exact: the whole text must be a scale expression (used for manual overrides).
  * find_scales_in_line: scale expressions inside a longer line of drawing text.
The TypeScript override validator (api/src/scale) implements the exact form; both are tested
against fixtures/synthetic/scale-cases.json.
"""

import re
from dataclasses import dataclass
from fractions import Fraction

# Typographic characters seen in CAD text, mapped to ASCII. Written as code points so this file
# stays ASCII.
_TRANSLATION = {
    0x201D: '"',  # right double quote
    0x201C: '"',  # left double quote
    0x2033: '"',  # double prime
    0x02BA: '"',  # modifier letter double prime
    0x2019: "'",  # right single quote
    0x2018: "'",  # left single quote
    0x2032: "'",  # prime
    0x02B9: "'",  # modifier letter prime
    0x2013: "-",  # en dash
    0x2014: "-",  # em dash
    0x2212: "-",  # minus sign
    0x00A0: " ",  # no-break space
}

_NUM = r"\d+(?:\.\d+)?"
_FRAC = r"\d+\s*/\s*\d+"
_MIXED = r"\d+\s+\d+\s*/\s*\d+"
_VALUE = rf"(?:{_MIXED}|{_FRAC}|{_NUM})"
_INCH = r'(?:"|IN(?:CH(?:ES)?)?\.?)'
_FOOT = r"(?:'|FT\.?|FEET|FOOT)"

_IMPERIAL = (
    rf"(?P<left>{_VALUE})\s*{_INCH}\s*=\s*(?P<feet>{_NUM})\s*{_FOOT}"
    rf"(?:\s*-\s*(?P<inches>{_VALUE})\s*(?:{_INCH})?)?"
)
_RATIO = rf"1\s*:\s*(?P<n>{_NUM})"
_NTS = r"(?:N\.?\s?T\.?\s?S\.?|NOT\s+TO\s+SCALE)"
_PREFIX = r"(?:SCALE\s*:?\s*)?"

_IMPERIAL_RE = re.compile(_IMPERIAL, re.IGNORECASE)
_EXACT_RE = re.compile(
    rf"^{_PREFIX}(?:(?P<imperial>{_IMPERIAL})|(?P<ratio>{_RATIO})|(?P<nts>{_NTS}))$",
    re.IGNORECASE,
)
# In running text a bare "1:50" is too ambiguous (note numbers, times): require the word SCALE.
_RATIO_IN_LINE_RE = re.compile(rf"\bSCALE\s*:?\s*{_RATIO}", re.IGNORECASE)
_NTS_IN_LINE_RE = re.compile(rf"(?<![A-Z0-9]){_NTS}(?![A-Z0-9])", re.IGNORECASE)


@dataclass(frozen=True)
class Scale:
    raw: str  # matched text, whitespace collapsed, typographic quotes/dashes as ASCII
    kind: str  # "ratio" | "nts"
    ratio: float | None


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_TRANSLATION)).strip()


def _value(text: str) -> Fraction:
    parts = text.split()
    if len(parts) == 2:  # mixed number "1 1/2"
        return Fraction(parts[0]) + Fraction(parts[1].replace(" ", ""))
    return Fraction(text.replace(" ", ""))


def _imperial_ratio(match: re.Match[str]) -> float | None:
    try:
        left = _value(match.group("left"))
        feet = _value(match.group("feet"))
        inches = _value(match.group("inches")) if match.group("inches") else Fraction(0)
    except ZeroDivisionError:
        return None
    real = feet * 12 + inches
    if left <= 0 or real <= 0:
        return None
    return float(real / left)


def _ratio_from_n(match: re.Match[str]) -> float | None:
    n = float(match.group("n"))
    return n if n > 0 else None


def parse_scale_exact(text: str) -> Scale | None:
    """Parse text that is entirely one scale expression (optional "SCALE:" prefix)."""
    clean = normalize(text)
    match = _EXACT_RE.match(clean)
    if not match:
        return None
    if match.group("nts"):
        return Scale(raw=clean, kind="nts", ratio=None)
    if match.group("ratio"):
        ratio = _ratio_from_n(match)
    else:
        ratio = _imperial_ratio(match)
    return None if ratio is None else Scale(raw=clean, kind="ratio", ratio=ratio)


def find_scales_in_line(line: str) -> list[Scale]:
    """Every scale expression inside one line of text, in order of appearance."""
    clean = normalize(line)
    found: list[tuple[int, Scale]] = []
    for m in _IMPERIAL_RE.finditer(clean):
        ratio = _imperial_ratio(m)
        if ratio is not None:
            found.append((m.start(), Scale(raw=m.group(0), kind="ratio", ratio=ratio)))
    for m in _RATIO_IN_LINE_RE.finditer(clean):
        ratio = _ratio_from_n(m)
        if ratio is not None:
            found.append((m.start(), Scale(raw=m.group(0), kind="ratio", ratio=ratio)))
    for m in _NTS_IN_LINE_RE.finditer(clean):
        found.append((m.start(), Scale(raw=m.group(0), kind="nts", ratio=None)))
    return [s for _, s in sorted(found, key=lambda item: item[0])]


def distinct_scales(lines: list[str]) -> list[dict[str, object]]:
    """Scales found across lines, de-duplicated by (kind, ratio), with how often each occurs.

    The raw text of the first occurrence is kept. Order of first appearance is preserved.
    """
    seen: dict[tuple[str, float | None], dict[str, object]] = {}
    for line in lines:
        for s in find_scales_in_line(line):
            key = (s.kind, s.ratio)
            if key in seen:
                seen[key]["count"] = int(seen[key]["count"]) + 1  # type: ignore[call-overload]
            else:
                seen[key] = {"raw": s.raw, "kind": s.kind, "ratio": s.ratio, "count": 1}
    return list(seen.values())
