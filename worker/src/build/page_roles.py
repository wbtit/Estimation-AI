"""Phase 12b: which pages auto mode builds, and pile plans (docs/PHASE12B_PLAN.md rules 2 and 3).

Rule "plan_only_roles": a page is built only when it is a plan. The texts are the sheet title and
the view titles (large all-caps lines, the scan's own rule: src/pdf_scan/classify.view_titles). A
text is a PLAN TEXT when it has the word PLAN(S) not followed by DETAIL, SECTION or NOTES, or one of
FRAMING / FOUNDATION / FOOTING / PILE / PILING and none of the non-plan words (DETAIL, SECTION,
ELEVATION, SCHEDULE, NOTES, CONNECTION, LEGEND, DIAGRAM). When the sheet title has a non-plan word
and is not a plan text, the page is not built ("title_not_a_plan"). Otherwise it is built when any
text is a plan text ("plan_text"), else not ("no_plan_text"). The role of a built page is the page
type guess (foundation -> column plan, framing -> framing); when the guess is neither, the plan
texts decide (a foundation, footing, pile, column or anchor word -> column plan, else framing).

Rule "pile_plan": a built column-plan page whose title or one of its plan view titles names piles
(PILE, PILES, PILING) is a pile plan: role "Pile plan", its glyphs are stored as kind "Piles".
Pure functions; the reason names the rule, never the page text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.build.segments import TextLine
from src.pdf_scan.classify import view_titles
from src.pdf_scan.textlines import Box, Line

NON_PLAN = re.compile(
    r"\b(?:DETAILS?|SECTIONS?|ELEVATIONS?|SCHEDULES?|NOTES?|CONNECTIONS?|LEGENDS?|DIAGRAMS?)\b"
)
PLAN_WORD = re.compile(r"\bPLANS?\b(?!\s*(?:DETAILS?|SECTIONS?|NOTES?)\b)")
PLAN_KIND = re.compile(r"\b(?:FRAMING|FOUNDATIONS?|FOOTINGS?|PILES?|PILING)\b")
COLUMN_PLAN_WORDS = re.compile(r"\b(?:FOUNDATIONS?|FOOTINGS?|PILES?|PILING|COLUMNS?|ANCHOR)\b")
PILE_WORDS = re.compile(r"\b(?:PILES?|PILING)\b")
ROLE_OF_GUESS = {"foundation_plan": "column_plan", "framing_plan": "framing"}


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").upper()


def is_plan_text(text: str | None) -> bool:
    t = _norm(text)
    return bool(PLAN_WORD.search(t)) or bool(PLAN_KIND.search(t) and not NON_PLAN.search(t))


def stored_view_titles(text: list[TextLine]) -> list[str]:
    """View titles from the page's text lines, by the scan's own rule."""
    lines = [Line(t.text, Box(*t.box), ()) for t in text if t.text]
    return view_titles(lines)


@dataclass
class PageRole:
    role: str | None  # column_plan, framing or None (not built)
    rule: str  # plan_text, title_not_a_plan, no_plan_text
    pile: bool = False


SKIP_NAMES = (
    ("SECTION", "Section"),
    ("DETAIL", "Detail"),
    ("CONNECTION", "Detail"),
    ("ELEVATION", "Elevation"),
    ("SCHEDULE", "Schedule"),
    ("LEGEND", "Schedule"),
    ("NOTE", "Notes"),
)


def skip_role_name(title: str | None) -> str | None:
    """The built-in "Don't build" role named by a title that is not a plan, else None."""
    t = _norm(title)
    return next((name for word, name in SKIP_NAMES if word in t), None)


def page_role(title: str | None, views: list[str], page_type_guess: str | None) -> PageRole:
    """Rules "plan_only_roles" and "pile_plan" (module note)."""
    t = _norm(title)
    if title and NON_PLAN.search(t) and not is_plan_text(title):
        return PageRole(None, "title_not_a_plan")
    plans = [x for x in ([title] if title else []) + views if is_plan_text(x)]
    if not plans:
        return PageRole(None, "no_plan_text")
    role = ROLE_OF_GUESS.get(page_type_guess or "")
    if role is None:
        role = (
            "column_plan" if any(COLUMN_PLAN_WORDS.search(_norm(x)) for x in plans) else "framing"
        )
    pile = role == "column_plan" and any(PILE_WORDS.search(_norm(x)) for x in plans)
    return PageRole(role, "plan_text", pile)
