"""Page type and level guesses for the review screen. Deterministic keyword rules; always a guess.

Page types: framing_plan, foundation_plan, elevation, detail, schedule_legend, general_notes, other.
The sheet title and the large view titles on the page are matched against keyword rules; profile
counts only break ties and give a weak fallback (the Phase 4e study found that profile counts alone
picked a real framing plan only 17 times in 31). The reason names the rules that matched, never the
page text (titles can contain client names). The level is a short generic phrase (Level 6, Roof,
Second floor) taken from the title or view titles.
"""

import re
from dataclasses import dataclass

PAGE_TYPES = (
    "framing_plan",
    "foundation_plan",
    "elevation",
    "detail",
    "schedule_legend",
    "general_notes",
    "other",
)
# When several types match (a sheet with a foundation view and a framing view), the first wins.
PREFERENCE = PAGE_TYPES

RULES: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("framing_plan", "FRAMING", re.compile(r"\bFRAMING\b")),
    (
        "framing_plan",
        "FLOOR/ROOF PLAN",
        re.compile(r"\b(?:FLOOR|ROOF|LEVEL|MEZZANINE|CANOPY)\b.*\bPLANS?\b"),
    ),
    ("foundation_plan", "FOUNDATION", re.compile(r"\b(?:FOUNDATIONS?|FOOTINGS?|PILES?)\b")),
    ("elevation", "ELEVATION", re.compile(r"\bELEVATIONS?\b")),
    ("detail", "DETAIL", re.compile(r"\bDETAILS?\b")),
    ("detail", "SECTION", re.compile(r"\bSECTIONS?\b")),
    ("detail", "CONNECTION", re.compile(r"\bCONNECTIONS?\b")),
    ("schedule_legend", "SCHEDULE", re.compile(r"\bSCHEDULES?\b")),
    ("schedule_legend", "LEGEND", re.compile(r"\bLEGENDS?\b")),
    ("general_notes", "NOTES", re.compile(r"\bNOTES?\b")),
    ("general_notes", "SPECIFICATIONS", re.compile(r"\bSPECIFICATIONS?\b")),
    ("general_notes", "ABBREVIATIONS", re.compile(r"\bABBREVIATIONS?\b")),
    ("general_notes", "COVER/INDEX", re.compile(r"\b(?:COVER|INDEX|DRAWING\s+LIST)\b")),
)

FALLBACK_MIN_PROFILES = 8  # a plan-like sheet with this many profile strings and no title keyword
NOTES_MIN_CHARS = 8000  # a text-heavy page with few drawing paths is probably a notes page
NOTES_MAX_PATHS = 3000

_ORDINALS = {
    "FIRST": "First floor",
    "SECOND": "Second floor",
    "THIRD": "Third floor",
    "FOURTH": "Fourth floor",
    "FIFTH": "Fifth floor",
    "SIXTH": "Sixth floor",
    "SEVENTH": "Seventh floor",
    "EIGHTH": "Eighth floor",
    "NINTH": "Ninth floor",
    "TENTH": "Tenth floor",
}
_NAMED = {
    "GROUND": "Ground floor",
    "MAIN": "Main floor",
    "MEZZANINE": "Mezzanine",
    "ROOF": "Roof",
    "PENTHOUSE": "Penthouse",
    "BASEMENT": "Basement",
    "CELLAR": "Cellar",
    "CANOPY": "Canopy",
}
_LEVEL_NUM = re.compile(r"\b(?:LEVEL|LVL)\s*([A-Z]?\d{1,2}[A-Z]?)\b")
_FLOOR_NUM = re.compile(r"\bFLOOR\s*(\d{1,2})\b")
_ORDINAL = re.compile(r"\b(" + "|".join(_ORDINALS) + r")\s*(?:LEVEL|FLOOR)\b")
_NAMED_RE = re.compile(r"\b(" + "|".join(_NAMED) + r")\b")


@dataclass
class PageTypeGuess:
    page_type: str
    reason: str
    level: str | None


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).upper()


def _matches(texts: list[str]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for text in texts:
        t = _norm(text)
        for page_type, name, pattern in RULES:
            if pattern.search(t) and name not in found.setdefault(page_type, []):
                found[page_type].append(name)
    return found


def guess_level(texts: list[str]) -> str | None:
    """A short generic level phrase from the title and view titles, or None."""
    for text in texts:
        t = _norm(text)
        m = _LEVEL_NUM.search(t)
        if m:
            return f"Level {m.group(1)}"
        m = _FLOOR_NUM.search(t)
        if m:
            return f"Floor {m.group(1)}"
        m = _ORDINAL.search(t)
        if m:
            return _ORDINALS[m.group(1)]
        m = _NAMED_RE.search(t)
        if m:
            return _NAMED[m.group(1)]
    return None


def guess_page_type(
    title: str | None,
    view_titles: list[str],
    profile_count: int,
    plan_kind: str = "other",
    text_chars: int = 0,
    vector_paths: int = 0,
) -> PageTypeGuess:
    """The page type, the rules behind it, and the level. `plan_kind` is the Phase 2 kind."""
    title_hits = _matches([title] if title else [])
    view_hits = _matches(view_titles)
    texts = ([title] if title else []) + view_titles
    level = guess_level(texts)

    source = None
    hits: dict[str, list[str]] = {}
    if title_hits:
        hits, source = title_hits, "title"
        # a title naming only a generic kind still defers to a clear framing view title
        if (
            "framing_plan" in view_hits
            and "framing_plan" not in title_hits
            and set(title_hits) <= {"detail"}
        ):
            hits, source = {**title_hits, **view_hits}, "title and view titles"
    elif view_hits:
        hits, source = view_hits, "view titles"

    if hits:
        chosen = next(t for t in PREFERENCE if t in hits)
        rules = ", ".join(sorted(hits[chosen]))
        reason = f"{source} match {rules.lower()}"
        others = [t for t in PREFERENCE if t in hits and t != chosen]
        if others:
            reason += f"; also {', '.join(others)}"
        return PageTypeGuess(chosen, reason, level)

    if text_chars >= NOTES_MIN_CHARS and vector_paths < NOTES_MAX_PATHS:
        return PageTypeGuess(
            "general_notes",
            f"no title keyword; text-heavy page, {text_chars} characters (weak guess)",
            level,
        )
    if profile_count >= FALLBACK_MIN_PROFILES and plan_kind == "plan":
        return PageTypeGuess(
            "framing_plan", f"no title keyword; {profile_count} profile strings (weak guess)", level
        )
    return PageTypeGuess("other", "no title keyword matched", level)
