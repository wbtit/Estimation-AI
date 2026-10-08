"""Sheet numbers (forms like S4.1, S-101, S001) and title strips.

Sheet numbers: pure token parsing here. The title-strip rules (labels, title-block region, size
rules) are the Phase 2 rules in `pdf_scan.sheet_id`, reused unchanged.
"""

import re
from dataclasses import dataclass
from typing import Any

from src.pdf_scan.scale import normalize as normalize_typography
from src.pdf_scan.sheet_id import SHEET_NUMBER_RE, SheetId, find_sheet_id
from src.pdf_scan.textlines import Line, Word

__all__ = ["SheetNumber", "find_sheet_numbers", "parse_sheet_number", "title_strip"]

_EDGE = ".,;:()[]{}\"'"


@dataclass(frozen=True)
class SheetNumber:
    raw: str
    canonical: str  # uppercase, ASCII hyphen, no inner spaces
    form: str  # "dotted" (S4.1) | "hyphenated" (S-101) | "plain" (S001, S101A)
    flags: tuple[str, ...]

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "sheet_number",
            "raw": self.raw,
            "canonical": self.canonical,
            "form": self.form,
            "flags": list(self.flags),
        }


def parse_sheet_number(text: str) -> SheetNumber | None:
    raw = text.strip()
    t = normalize_typography(raw).strip(_EDGE + " ").upper()
    flags: list[str] = []
    if re.fullmatch(r"[A-Z]{1,3}\s+-?\d.*", t):
        t = re.sub(r"\s+", "", t)
        flags.append("space_removed")
    if not SHEET_NUMBER_RE.match(t):
        return None
    form = "dotted" if "." in t else "hyphenated" if "-" in t else "plain"
    return SheetNumber(raw=raw, canonical=t, form=form, flags=tuple(flags))


def find_sheet_numbers(text: str, strict: bool = True) -> list[SheetNumber]:
    """Sheet-number-shaped tokens of a line of text.

    `strict` keeps only forms that are unlikely to be anything else: a dot (S4.1), a hyphen
    (S-101) or at least three digits (S001, S101A). A short token such as B1 is a mark candidate,
    not a sheet number, unless it sits in the title block (which the page scan decides).
    """
    out = []
    for token in re.findall(r"\S+", text):
        sn = parse_sheet_number(token)
        if sn is None:
            continue
        if strict and not (
            "." in sn.canonical
            or "-" in sn.canonical
            or sum(c.isdigit() for c in sn.canonical) >= 3
        ):
            continue
        out.append(sn)
    return out


def title_strip(words: list[Word], lines: list[Line], page_w: float, page_h: float) -> SheetId:
    """Sheet number and title of a page (Phase 2 rules, reused)."""
    return find_sheet_id(words, lines, page_w, page_h)
