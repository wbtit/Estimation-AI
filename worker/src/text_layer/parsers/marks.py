"""Mark-like tokens as CANDIDATES only.

A token such as B1 or C12 is ambiguous: it can be a member mark, a detail or note number, a grid
or sheet reference, a channel prefix. This parser never claims a token is a member
(`claims_member` is always false); it only lists tokens of that shape and what else they could be.
"""

import re
from dataclasses import dataclass
from typing import Any

MARK_RE = re.compile(r"^[A-Z]{1,2}\d{1,3}[A-Z]?$")
_SHEET_LIKE_RE = re.compile(r"^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,3})?[A-Z]?$")
_PROFILE_PREFIXES = frozenset({"W", "M", "S", "HP", "C", "MC", "L", "WT", "MT", "ST"})
_EDGE = ".,;:()[]{}\"'"


@dataclass(frozen=True)
class MarkCandidate:
    raw: str
    also_could_be: tuple[str, ...]
    claims_member: bool = False  # never true: a mark token is not evidence of a member

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "mark_candidate",
            "raw": self.raw,
            "also_could_be": list(self.also_could_be),
            "claims_member": self.claims_member,
        }


def find_mark_candidates(
    text: str, exclude_spans: list[tuple[int, int]] | None = None
) -> list[MarkCandidate]:
    """Mark-shaped tokens of the text, skipping tokens inside `exclude_spans` (character offsets
    in the whitespace-collapsed text)."""
    clean = re.sub(r"\s+", " ", text).strip()
    out: list[MarkCandidate] = []
    for m in re.finditer(r"\S+", clean):
        if any(a <= m.start() < b for a, b in (exclude_spans or [])):
            continue
        token = m.group(0).strip(_EDGE).upper()
        if not MARK_RE.match(token):
            continue
        could = ["member_mark", "detail_or_note_reference"]
        if _SHEET_LIKE_RE.match(token) and sum(c.isdigit() for c in token) >= 2:
            could.append("sheet_number")
        letters = re.match(r"[A-Z]+", token)
        if letters and letters.group(0) in _PROFILE_PREFIXES:
            could.append("profile_prefix")
        out.append(MarkCandidate(raw=token, also_could_be=tuple(could)))
    return out
