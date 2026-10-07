"""Target categories for reporting (owner decision 3). Used by the harness only; nothing is parsed.

Deterministic regular expressions on a text line, first match wins.
"""

import re

from src.pdf_scan.scale import find_scales_in_line
from src.pdf_scan.sheet_id import SHEET_NUMBER_RE

_DESIGNATION = re.compile(r"^[A-Z]{1,4}\d+(?:\.\d+)?(?:[Xx]\d+(?:/\d+|\.\d+)?)+$")
_DIMENSION = re.compile(r"^\d+'-\d+(?: \d+/\d+)?\"?$|^\d+(?:\.\d+)?\"$|^\d+'-?$")
_MARK = re.compile(r"^[A-Z]{1,2}\d{1,3}[A-Z]?(?: [A-Z.'/]+)?$")

CATEGORIES = ("designation", "dimension", "scale", "sheet_number", "mark", "other")


def categorize(text: str) -> str:
    t = " ".join(text.split())
    if _DESIGNATION.match(t):
        return "designation"
    if _DIMENSION.match(t):
        return "dimension"
    if find_scales_in_line(t):
        return "scale"
    if SHEET_NUMBER_RE.match(t.upper()) and ("." in t or sum(ch.isdigit() for ch in t) >= 3):
        return "sheet_number"
    if _MARK.match(t):
        return "mark"
    return "other"
