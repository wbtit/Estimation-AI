"""Deterministic sheet classification by keyword rules, with a confidence and a reason.

Kinds: plan (framing plan), schedule, detail, notes, other. Evidence, strongest first:
  1. the sheet title from the title block (confidence 0.9 when it points to one kind);
  2. large all-caps "view titles" elsewhere on the page (0.6 for one, 0.75 for two or more);
  3. nothing: kind "other", confidence 0, flagged.
Several different kinds in one source -> highest priority kind, confidence 0.5, flagged.
Reasons name the rules that matched, never the page text (titles can contain client names).
"""

import re
from dataclasses import dataclass, field
from statistics import median

from src.pdf_scan.textlines import Line

KINDS_BY_PRIORITY = ("schedule", "plan", "detail", "notes", "other")
LOW_CONFIDENCE = 0.7

CONF_TITLE_SINGLE = 0.9
CONF_VIEW_SINGLE = 0.6
CONF_VIEW_MULTI = 0.75
CONF_AMBIGUOUS = 0.5

# (kind, rule name, regex). Matched against upper-case text.
RULES: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("schedule", "SCHEDULE", re.compile(r"\bSCHEDULES?\b")),
    ("schedule", "MEMBER/BEAM/COLUMN LIST", re.compile(r"\b(?:MEMBER|BEAM|COLUMN)\s+LISTS?\b")),
    (
        "plan",
        "FRAMING/TRELLIS PLAN",
        re.compile(r"\b(?:FRAMING|TRELLIS)\b.*\bPLANS?\b|\bPLANS?\b.*\b(?:FRAMING|TRELLIS)\b"),
    ),
    ("detail", "DETAIL", re.compile(r"\bDETAILS?\b")),
    ("detail", "SECTION", re.compile(r"\bSECTIONS?\b")),
    ("detail", "CONNECTION", re.compile(r"\bCONNECTIONS?\b")),
    ("notes", "NOTES", re.compile(r"\bNOTES?\b")),
    ("notes", "SPECIFICATIONS", re.compile(r"\bSPECIFICATIONS?\b")),
    ("notes", "ABBREVIATIONS", re.compile(r"\bABBREVIATIONS?\b")),
    ("notes", "LEGEND", re.compile(r"\bLEGENDS?\b")),
    ("notes", "SYMBOLS", re.compile(r"\bSYMBOLS?\b")),
    ("notes", "COVER", re.compile(r"\bCOVER\b")),
    ("notes", "INDEX", re.compile(r"\bINDEX\b")),
    ("notes", "DRAWING LIST", re.compile(r"\bDRAWING\s+LIST\b")),
    ("other", "PLAN (not framing)", re.compile(r"\bPLANS?\b")),
    ("other", "ELEVATION", re.compile(r"\bELEVATIONS?\b")),
)

VIEW_TITLE_MIN_HEIGHT_FACTOR = 1.25  # of the page's median line height
VIEW_TITLE_MAX_CHARS = 80
VIEW_TITLE_MIN_CHARS = 6


@dataclass
class Classification:
    kind: str
    confidence: float
    reason: str
    flags: list[str] = field(default_factory=list)


def _evidence(text: str) -> dict[str, list[str]]:
    """Rule names that match the text, per kind."""
    upper = re.sub(r"\s+", " ", text).upper()
    found: dict[str, list[str]] = {}
    for kind, name, pattern in RULES:
        if pattern.search(upper):
            found.setdefault(kind, []).append(name)
    if "plan" in found and "other" in found:  # a framing plan is not also "some other plan"
        found["other"] = [n for n in found["other"] if n != "PLAN (not framing)"]
        if not found["other"]:
            del found["other"]
    return found


def _pick(kinds: set[str]) -> str:
    return next(k for k in KINDS_BY_PRIORITY if k in kinds)


def view_titles(lines: list[Line]) -> list[str]:
    """Large all-caps lines that read like drawing view titles."""
    if not lines:
        return []
    typical = median(ln.box.height for ln in lines)
    found = []
    for ln in lines:
        text = re.sub(r"\s+", " ", ln.text).strip()
        if (
            VIEW_TITLE_MIN_CHARS <= len(text) <= VIEW_TITLE_MAX_CHARS
            and text == text.upper()
            and ln.box.height >= VIEW_TITLE_MIN_HEIGHT_FACTOR * typical
        ):
            found.append(text)
    return found


def classify(title: str | None, views: list[str]) -> Classification:
    title_evidence = _evidence(title) if title else {}
    if title_evidence:
        kinds = set(title_evidence)
        rules = sorted({n for names in title_evidence.values() for n in names})
        if len(kinds) == 1:
            kind = next(iter(kinds))
            return Classification(
                kind, CONF_TITLE_SINGLE, f"sheet title matches {kind} rule(s): {', '.join(rules)}"
            )
        kind = _pick(kinds)
        return Classification(
            kind,
            CONF_AMBIGUOUS,
            f"sheet title matches several kinds ({', '.join(sorted(kinds))}); "
            f"chose {kind} by priority",
            ["classification_ambiguous"],
        )

    counts: dict[str, int] = {}
    rule_names: set[str] = set()
    for text in views:
        for kind, names in _evidence(text).items():
            counts[kind] = counts.get(kind, 0) + 1
            rule_names.update(names)
    if counts:
        if len(counts) == 1:
            kind, n = next(iter(counts.items()))
            confidence = CONF_VIEW_MULTI if n >= 2 else CONF_VIEW_SINGLE
            flags = [] if confidence >= LOW_CONFIDENCE else ["low_confidence_classification"]
            return Classification(
                kind,
                confidence,
                f"{n} view title(s) on the page match {kind} rule(s): "
                f"{', '.join(sorted(rule_names))}",
                flags,
            )
        kind = _pick(set(counts))
        return Classification(
            kind,
            CONF_AMBIGUOUS,
            f"view titles match several kinds ({', '.join(sorted(counts))}); "
            f"chose {kind} by priority",
            ["classification_ambiguous"],
        )

    return Classification(
        "other", 0.0, "no title or view-title keyword evidence", ["classification_no_evidence"]
    )
