"""Deterministic member-kind detection from drawing text (V1_UI_SPEC section 6, Phase 6a).

The keyword table is the one registered for the workbook study (docs/PHASE5U_PREREGISTRATION.md, K),
in its priority order: specific words before general ones, first match wins. A keyword matches at
the START of a word (so "beams" and "posts" match, "composite" and "aggregate" do not).

Sources, in order; the first source that says anything wins and is stored with the kind:
  1. keyword: the label's own text line, then other text lines within 150 pt (nearest first);
  2. legend: the legend or schedule row the label's mark points to;
  3. sheet_context: the sheet title.
No keyword: the kind stays EMPTY (never defaulted). A plain "brace", "rail" or "ladder" is an
ambiguous kind that a person resolves. Excluded kinds (Joist, Wall, Other trades) found only in a
NEARBY line are ignored: a neighbouring wall note must not remove a beam from the count.
Pure functions; no text is logged.
"""

import re
from dataclasses import dataclass

MAIN, MISC, EXCLUDED = "main", "misc", "excluded"
NEAR_RADIUS_PT = 150.0  # the frozen linking rule's candidate radius

# (kind, scope, keywords) in the registered priority order
TABLE: list[tuple[str, str, tuple[str, ...]]] = [
    ("Dock Stair", MISC, ("dock stair",)),
    ("Stair", MISC, ("stair",)),
    ("Roof Ladder", MISC, ("roof ladder",)),
    ("Pit Ladder", MISC, ("pit ladder",)),
    ("Ship Ladder/Cage Ladder", MISC, ("ship ladder", "cage")),
    ("Guardrail", MISC, ("guardrail", "guard rail")),
    ("Handrail/Wallrails", MISC, ("handrail", "hand rail", "wallrail", "wall rail")),
    ("Landing Frame", MISC, ("landing",)),
    ("Bollard", MISC, ("bollard",)),
    ("Gates", MISC, ("gate",)),
    ("Grating", MISC, ("grating",)),
    ("Bike Rack", MISC, ("bike",)),
    ("Curved Beam/Rolled Beam", MAIN, ("curved", "rolled")),
    ("Truss", MAIN, ("truss",)),
    ("Girt & Purlin", MAIN, ("girt", "purlin")),
    ("Lintel/Brick Veneer Supports", MAIN, ("lintel", "brick", "veneer")),
    ("Deck edge Angle / Bent plate", MAIN, ("deck edge", "edge angle", "bent plate")),
    ("Kicker/Knee Brace", MAIN, ("kicker", "knee")),
    ("Horizontal Brace", MAIN, ("horizontal brace", "horiz")),
    ("Vertical Brace", MAIN, ("vertical brace", "x-brace", "chevron")),
    ("Embeds Angle", MAIN, ("embed angle", "embeds angle")),
    ("Embed Plate/Bearing Plates", MAIN, ("embed", "bearing plate", "bearing")),
    ("RTU Frame/Roof Hatch Frame", MAIN, ("rtu", "hatch")),
    ("Roof Drain Frame", MAIN, ("drain",)),
    ("Dock Levellers", MAIN, ("dock level", "leveller", "leveler")),
    ("Sag rod", MAIN, ("sag",)),
    ("Turn Buckle", MAIN, ("turn buckle", "turnbuckle")),
    ("Outriggers", MAIN, ("outrigger",)),
    ("Hangers", MAIN, ("hanger",)),
    ("Misc. Attachments", MAIN, ("attachment",)),
    ("Posts/Pipe", MAIN, ("post", "pipe")),
    ("Column", MAIN, ("column",)),
    ("Beams", MAIN, ("beam",)),
    ("Joist", EXCLUDED, ("joist",)),
    ("Wall", EXCLUDED, ("wall",)),
]
# a bare word that names a family of kinds: the person chooses (keyword -> the kinds it could be)
AMBIGUOUS: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("brace", "bracing"), ("Horizontal Brace", "Vertical Brace", "Kicker/Knee Brace")),
    (("rail",), ("Guardrail", "Handrail/Wallrails")),
    (("ladder",), ("Roof Ladder", "Ship Ladder/Cage Ladder", "Pit Ladder")),
]
SCOPE = {kind: scope for kind, scope, _ in TABLE} | {"Other trades": EXCLUDED}
JOIST = "Joist"


@dataclass(frozen=True)
class KindResult:
    kind: str | None  # None = missing or ambiguous
    status: str  # "set" | "ambiguous" | "missing"
    source: str | None  # "keyword" | "legend" | "sheet_context"
    keyword: str | None
    where: str | None  # "same_line" | "legend" | "designation"
    candidates: tuple[str, ...] = ()
    # a kind word seen only nearby or in the sheet title: (kind, keyword, "near" | "sheet_title")
    hint: tuple[str, str, str] | None = None

    def evidence(self) -> dict[str, object]:
        """What the screen shows; the matched keyword and where it was found, never page text."""
        return {
            "status": self.status,
            "source": self.source,
            "keyword": self.keyword,
            "where": self.where,
            "candidates": list(self.candidates),
            "hint": None
            if self.hint is None
            else {"kind": self.hint[0], "keyword": self.hint[1], "where": self.hint[2]},
        }


MISSING = KindResult(None, "missing", None, None, None)


def _has(text: str, keyword: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(keyword), text) is not None


def match_text(text: str | None, allow_excluded: bool = True) -> KindResult | None:
    """The kind a piece of text names, or an ambiguous result, or None. Lower-cases the text."""
    t = re.sub(r"\s+", " ", (text or "").lower())
    if not t.strip():
        return None
    for kind, scope, keywords in TABLE:
        if scope == EXCLUDED and not allow_excluded:
            continue
        for kw in keywords:
            if _has(t, kw):
                return KindResult(kind, "set", None, kw, None)
    for keywords, candidates in AMBIGUOUS:
        for kw in keywords:
            if _has(t, kw):
                return KindResult(None, "ambiguous", None, kw, None, candidates)
    return None


def _tag(res: KindResult, source: str, where: str) -> KindResult:
    return KindResult(res.kind, res.status, source, res.keyword, where, res.candidates)


def detect_kind(
    same_line: str | None,
    near_lines: list[str] | None = None,
    legend_text: str | None = None,
    sheet_text: str | None = None,
) -> KindResult:
    """The own line, then the legend row. Nearby lines and the sheet title give a hint only."""
    res = match_text(same_line)
    if res is not None:
        return _tag(res, "keyword", "same_line")
    res = match_text(legend_text)
    if res is not None:
        return _tag(res, "legend", "legend")
    hint = None
    for line in near_lines or []:
        res = match_text(line, allow_excluded=False)
        if res is not None and res.status == "set" and res.kind is not None:
            hint = (res.kind, res.keyword or "", "near")
            break
    if hint is None:
        res = match_text(sheet_text, allow_excluded=False)
        if res is not None and res.status == "set" and res.kind is not None:
            hint = (res.kind, res.keyword or "", "sheet_title")
    return KindResult(None, "missing", None, None, None, hint=hint)


def joist_kind() -> KindResult:
    """A K, LH or DLH designation is a joist by its parsed designation (no keyword needed)."""
    return KindResult(JOIST, "set", "keyword", "joist designation", "designation")
