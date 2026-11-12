"""The drawing index of a cover page and its check against the page list (Phase 0 cover details).

Rows: a sheet-number token followed by a title on one line ("S101 FOUNDATION PLAN", also title
then number with dot leaders), or a lone number cell with the title in the cell to its right. A page
is an index page when it has at least `MIN_ROWS` rows. The check only SUGGESTS: nothing is changed.
"""

from __future__ import annotations

import re

from src.details.fields import clean
from src.details.types import IndexFlag, IndexRow, PageText, union
from src.pdf_scan.pagetype import PAGE_TYPES, RULES
from src.pdf_scan.sheet_id import TITLE_BLOCK_NUMBER_RE

MIN_ROWS = 3
NAME_OK = 0.6  # title token overlap: a matched sheet whose names overlap less is a name mismatch
RENUMBERED = 0.8  # an unmatched row whose title overlaps a page this much names a renumbered page
# S101, S4.01, S-101, A40-S2300 (discipline + number + "-" + sub-sheet)
NUMBER_RE = re.compile(
    TITLE_BLOCK_NUMBER_RE.pattern + r"|^[A-Z]{1,3}\d{1,3}-[A-Z]{1,3}\d{1,5}[A-Z]?$"
)
_STOP = {"AND", "THE", "OF", "FOR", "TO", "A"}
ROLE_TYPE = {"framing": "framing_plan", "column_plan": "foundation_plan"}


def token(text: str) -> str | None:
    t = clean(text).strip(".,;:()[]").upper()
    return t if NUMBER_RE.match(t) and re.search(r"\d", t) and re.search(r"[A-Z]", t) else None


def _title(text: str) -> str | None:
    t = re.sub(r"^[\s.\-–—:|]+|[\s.\-–—:|]+$", "", re.sub(r"\.{3,}", " ", clean(text)))
    return t if len(re.findall(r"[A-Za-z]", t)) >= 3 else None


def parse_rows(page: PageText) -> list[IndexRow]:
    rows: list[IndexRow] = []
    seen: set[str] = set()

    def add(num: str, title: str, boxes, rule: str) -> None:
        if num not in seen:
            seen.add(num)
            rows.append(IndexRow(num, title, page.page_index, union(boxes), rule))

    cells = [ln for ln in page.lines if token(ln.text)]
    for ln in page.lines:
        words = ln.text.split()
        if len(words) >= 2:
            first, last = token(words[0]), token(words[-1])
            if first and (t := _title(" ".join(words[1:]))):
                add(first, t, [ln.box], "same_line")
                continue
            if last and (t := _title(" ".join(words[:-1]))):
                add(last, t, [ln.box], "same_line")
                continue
    for c in cells:
        num = token(c.text)
        if num is None or num in seen or len(c.text.split()) != 1:
            continue
        right = [
            x
            for x in page.lines
            if x is not c
            and x.box.x0 >= c.box.x1 - 1
            and min(x.box.y1, c.box.y1) - max(x.box.y0, c.box.y0)
            >= 0.5 * min(x.box.height, c.box.height)
            and not token(x.text)
        ]
        if right:
            nearest = min(right, key=lambda x: x.box.x0 - c.box.x1)
            if (t := _title(nearest.text)) and nearest.box.x0 - c.box.x1 <= 0.3 * page.width:
                add(num, t, [c.box, nearest.box], "two_cell")
    return rows if len(rows) >= MIN_ROWS else []


def num_key(n: str) -> str:
    return re.sub(r"\s+", "", n.upper())


def num_equiv(n: str) -> str:
    """Equal when only separators or leading zeros differ (S4.01 = S4-01 = S401)."""
    return re.sub(r"(?<=\D)0+(?=\d)", "", re.sub(r"[.\-_\s]", "", n.upper()))


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[A-Z0-9]+", text.upper()) if w not in _STOP}


def overlap(a: str, b: str) -> float:
    x, y = words(a), words(b)
    return len(x & y) / len(x | y) if x and y else 0.0


def title_type(title: str) -> str | None:
    """The page type the title's keywords name (first rule in the page-type preference), or None."""
    t = re.sub(r"\s+", " ", title.upper())
    hits = {pt for pt, _name, rx in RULES if rx.search(t)}
    return next((pt for pt in PAGE_TYPES if pt in hits), None)


def check_index(
    rows: list[IndexRow], pages: list[PageText], index_pages: set[int], cover_pages: set[int]
) -> list[IndexFlag]:
    """Match the rows to the pages (by sheet number) and list what does not fit."""
    by_exact = {num_key(p.sheet_number): p for p in pages if p.sheet_number}
    by_equiv: dict[str, list[PageText]] = {}
    for p in pages:
        if p.sheet_number:
            by_equiv.setdefault(num_equiv(p.sheet_number), []).append(p)
    flags: list[IndexFlag] = []
    matched: set[int] = set()
    unmatched: list[IndexRow] = []

    def flag(kind: str, detail: dict, r: IndexRow, p: PageText | None) -> None:
        flags.append(
            IndexFlag(
                kind, detail, p and p.page_index, p and p.sheet_id, r.page_index, r.number, r.title
            )
        )

    for r in rows:
        p = by_exact.get(num_key(r.number))
        r.match = "exact"
        if p is None:
            eq = by_equiv.get(num_equiv(r.number), [])
            p = eq[0] if len(eq) == 1 else None
            r.match = "equivalent" if p is not None else "none"
        if p is None:
            unmatched.append(r)
            continue
        r.matched_page, r.matched_sheet_id = p.page_index, p.sheet_id
        matched.add(p.page_index)
        if r.match == "equivalent":
            flag("number_format", {"index": r.number, "page": p.sheet_number}, r, p)
        if p.name and (o := overlap(r.title, p.name)) < NAME_OK:
            flag("name_mismatch", {"index": r.title, "page": p.name, "overlap": round(o, 2)}, r, p)
        tt, rt = title_type(r.title), ROLE_TYPE.get(p.role_behaviour or "")
        if tt in ("framing_plan", "foundation_plan") and rt and tt != rt:
            flag(
                "role_disagreement", {"index_says": tt, "role": p.role_name, "role_type": rt}, r, p
            )
    free = [p for p in pages if p.page_index not in matched and p.page_index not in index_pages
            and p.page_index not in cover_pages]  # fmt: skip
    used: set[int] = set()
    for r in unmatched:
        cands = [
            p
            for p in free
            if p.page_index not in used and p.name and overlap(r.title, p.name) >= RENUMBERED
        ]
        if len(cands) == 1:
            p = cands[0]
            used.add(p.page_index)
            r.matched_page, r.matched_sheet_id = p.page_index, p.sheet_id
            flag("number_mismatch", {"index": r.number, "page": p.sheet_number}, r, p)
        else:
            flags.append(
                IndexFlag("missing_from_pdf", {}, None, None, r.page_index, r.number, r.title)
            )
    for p in free:
        if p.page_index in used:
            continue
        kind = "not_in_index" if p.sheet_number else "page_no_number"
        flags.append(
            IndexFlag(kind, {"number": p.sheet_number, "name": p.name}, p.page_index, p.sheet_id)
        )
    return flags
