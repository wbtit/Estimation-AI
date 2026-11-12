"""Patterns that need no label: street addresses, dates, issue status words (Phase 0 cover details).

Every hit keeps its page and box. Addresses are US forms only (street, city, two-letter state,
ZIP); anything else stays empty. A date or a status word is a candidate, never a guess about which
one is "the" date.
"""

from __future__ import annotations

import re

from src.details.fields import _DATE_RE, clean
from src.details.types import Cand, PageText, union

STATES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split()
_SUFFIX = (
    r"ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PKWY|PARKWAY|HWY|"
    r"HIGHWAY|PL|PLACE|CIR|CIRCLE|TRL|TRAIL|SQ|SQUARE|TER|TERRACE"
)
STREET_RE = re.compile(
    rf"\b\d{{1,6}}\s+(?:[NSEW]\.?\s+)?[A-Z0-9][A-Z0-9 .'#-]{{1,40}}?\s+(?:{_SUFFIX})\b\.?"
    r"(?:\s*(?:#|SUITE|STE|UNIT)\s*[A-Z0-9-]+)?",
    re.IGNORECASE,
)
CITY_RE = re.compile(
    rf"\b[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){{0,3}},?\s+(?:{'|'.join(STATES)})\s+\d{{5}}(?:-\d{{4}})?\b"
)
CITY_STATE_RE = re.compile(
    rf"^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){{0,3}},\s*(?:{'|'.join(STATES)})\.?$"
)
STATUS_RE = re.compile(
    r"\b(?:ISSUED\s+)?FOR\s+(CONSTRUCTION|BID(?:DING)?|PERMIT|REVIEW|PRICING|APPROVAL|"
    r"COORDINATION|RECORD)\b",
    re.IGNORECASE,
)
_ROW_GAP = 1.6  # line heights: two lines this close belong to one address


def find_addresses(page: PageText) -> list[Cand]:
    """Street line and the city / state / ZIP line under it (or on it)."""
    out: list[Cand] = []
    lines = page.lines
    for k, ln in enumerate(lines):
        text = clean(ln.text)
        street = STREET_RE.search(text)
        if not street:
            continue
        city = CITY_RE.search(text, street.end())
        if city:
            out.append(
                Cand("address", f"{street.group(0).strip()} {city.group(0)}", page.page_index,
                     union([ln.box]), "address_one_line", "high")
            )  # fmt: skip
            continue
        h = max(ln.box.height, 1.0)
        for nxt in lines[k + 1 : k + 6]:
            if 0 <= nxt.box.y0 - ln.box.y1 <= _ROW_GAP * h and abs(nxt.box.x0 - ln.box.x0) < 4 * h:
                c = CITY_RE.search(clean(nxt.text))
                if c:
                    out.append(
                        Cand("address", f"{street.group(0).strip()} {c.group(0)}", page.page_index,
                             union([ln.box, nxt.box]), "address_two_lines", "high")
                    )  # fmt: skip
                    break
    return out


def find_dates(page: PageText) -> list[Cand]:
    out = []
    for ln in page.lines:
        for m in _DATE_RE.finditer(clean(ln.text)):
            out.append(
                Cand("date", m.group(0), page.page_index, union([ln.box]), "date_pattern", "medium")
            )
    return out


def find_status(page: PageText) -> list[Cand]:
    out = []
    for ln in page.lines:
        m = STATUS_RE.search(clean(ln.text))
        if m:
            word = m.group(1).upper().replace("BIDDING", "BID")
            out.append(
                Cand("issue_status", f"ISSUED FOR {word}", page.page_index, union([ln.box]),
                     "status_word", "high")
            )  # fmt: skip
    return out
