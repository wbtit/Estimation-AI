"""Building type SUGGESTION from words (Phase 0 cover details). Fixed keyword list, no labels.

Only a suggestion: confidence is always low, the rule says where the words were, and the person
confirms. No keyword (or, in the notes, keywords of two types) means no suggestion.
"""

from __future__ import annotations

import re

TYPES: tuple[tuple[str, str], ...] = (
    ("Warehouse", r"warehouse|distribution\s+cent(?:er|re)|storage\s+facility"),
    (
        "Industrial",
        r"plant|ethanol|process(?:ing)?|refinery|manufacturing|factory|industrial|mill",
    ),
    ("School", r"school|university|college|academy|classrooms?"),
    ("Hospital", r"hospital|medical\s+cent(?:er|re)|clinic|healthcare"),
    ("Office", r"offices?|headquarters"),
    ("Retail", r"retail|store|shopping|mall"),
    ("Parking", r"parking|garage"),
    (
        "Residential",
        r"residential|apartments?|condominiums?|townhomes?|housing|multi-?family|dwellings?",
    ),
)
_RX = [(t, re.compile(rf"\b(?:{k})\b", re.IGNORECASE)) for t, k in TYPES]


def keyword_hits(text: str) -> list[tuple[int, str]]:
    found = []
    for t, rx in _RX:
        m = rx.search(text)
        if m:
            found.append((m.start(), t))
    return sorted(found)


def suggest_from_name(name: str) -> tuple[str, list[str]] | None:
    """(type, other types in the name): the type whose keyword comes first in the name."""
    hits = keyword_hits(name)
    return (hits[0][1], [t for _, t in hits[1:]]) if hits else None


def suggest_from_notes(lines: list[str]) -> str | None:
    """A type only when the cover text names exactly one type."""
    types = {t for ln in lines for _, t in keyword_hits(ln)}
    return next(iter(types)) if len(types) == 1 else None
