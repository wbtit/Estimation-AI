"""Project details from the pages of one project (Phase 0 cover details). Pure: pages in, result.

Sources, strongest first:
  * a labelled value on the cover page (fields.py)
  * the same label found in the title blocks of the sheets: the value most sheets agree on
  * a text repeated in the same title-block cell on most sheets (repeat.py)
  * the largest text of the cover (a clue for the project name only)
Patterns (patterns.py) give the address, the dates and the issue status words.

Agreement for the project name and number: every source is kept; they AGREE when the normalised
texts are equal (or one contains the other, at least 6 characters), else CONFLICT. A conflict is
shown and never resolved: the cover label's value stays, its confidence goes down to medium at
most, and the other values are listed. A confidence is HIGH only when the label's layout was clean
and no other source disagrees.
"""

from __future__ import annotations

import re
from collections import Counter

from src.details import building as B
from src.details import fields as F
from src.details import index as I  # noqa: E741
from src.details import patterns as P
from src.details import repeat as R
from src.details.types import Cand, Detail, DetailsResult, PageText, box_t

NAME_FIELD, NUMBER_FIELD = "project_name", "project_number"
COVER_WORDS = re.compile(
    r"\b(COVER|TITLE\s+SHEET|DRAWING\s+INDEX|SHEET\s+INDEX|INDEX|SHEET|DRAWINGS?|STRUCTURAL|"
    r"GENERAL\s+NOTES|NOT\s+FOR\s+CONSTRUCTION|PRELIMINARY)\b",
    re.IGNORECASE,
)
_NUMBER_LIKE = re.compile(r"^(?=.*\d)[A-Z0-9][A-Z0-9 ./_-]{2,30}$")
_SHEET_NO = re.compile(r"^[A-Z]{1,3}-?\d{1,4}(?:[.-]\d{1,3})*[A-Z]?$")
_DATEISH = re.compile(r"^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$")
LOW = {"high": "medium", "medium": "low", "low": "low"}
SINGLE = ("owner", "architect", "engineer", "contractor", "issue", "building_code", "risk_category")


def agree(a: str, b: str) -> bool:
    x, y = R.norm(a), R.norm(b)
    if not x or not y:
        return False
    return x == y or (min(len(x), len(y)) >= 6 and (x in y or y in x))


def cover_pages_of(pages: list[PageText]) -> list[int]:
    """Pages with the role "Cover / Title page" when any is set, else page 1."""
    chosen = [p.page_index for p in pages if p.role_name == "Cover / Title page"]
    return chosen or ([min(p.page_index for p in pages)] if pages else [])


def _largest_cover_text(cover: PageText, exclude: set[str]) -> Cand | None:
    best = None
    for ln in cover.lines:
        t = F.clean(ln.text)
        if R.norm(t) in exclude:  # the value of another labelled field is not the project name
            continue
        words = t.split()
        if len(words) > 1 and (I.token(words[0]) or I.token(words[-1])):
            continue  # a drawing-index row
        if len(t) < 6 or COVER_WORDS.search(t) or F.is_label(t) or F.match_label(t) is not None:
            continue
        if not re.search(r"[A-Za-z]{3}", t) or P.CITY_RE.search(t) or P.STREET_RE.search(t):
            continue
        if best is None or ln.box.height > best[0]:
            best = (ln.box.height, ln, t)
    if best is None:
        return None
    return Cand(
        NAME_FIELD, best[2], cover.page_index, box_t(best[1].box), "largest_cover_text", "low"
    )


def _title_votes(pages: list[PageText], skip: set[int]) -> dict[str, list[tuple[str, int, Cand]]]:
    """field -> [(normalised value, number of sheets, first candidate)] from the title blocks."""
    per: dict[str, dict[str, dict[int, Cand]]] = {}
    for p in pages:
        if p.page_index in skip or not p.lines:
            continue
        region = [ln for ln in p.lines if R.in_title_block(ln.box.cx, ln.box.cy, p.width, p.height)]
        for c in F.find_label_fields(p, region):
            per.setdefault(c.field, {}).setdefault(R.norm(c.value), {}).setdefault(p.page_index, c)
    out: dict[str, list[tuple[str, int, Cand]]] = {}
    for fld, vals in per.items():
        out[fld] = sorted(
            ((n, len(d), d[min(d)]) for n, d in vals.items()), key=lambda t: (-t[1], t[0])
        )
    return out


def _repeat_number(rep: list[dict], taken: set[str], sources: list[Cand]) -> dict | None:
    same = [r for r in rep if any(agree(r["text"], c.value) for c in sources)]
    if same:  # a repeated text that confirms a value already read
        return same[0]
    cands = [
        r
        for r in rep
        if _NUMBER_LIKE.match(r["text"].upper())
        and not _SHEET_NO.match(r["text"].upper().replace(" ", ""))
        and not _DATEISH.match(r["text"])
        and r["norm"] not in taken
    ]
    return cands[0] if len(cands) == 1 else None  # one number-like text: else it is not clear


def _repeat_name(rep: list[dict], taken: set[str], sources: list[Cand]) -> dict | None:
    same = [r for r in rep if any(agree(r["text"], c.value) for c in sources)]
    if same:  # a repeated text that confirms a value already read
        return same[0]
    cands = [
        r
        for r in rep
        if re.search(r"[A-Za-z]{3}", r["text"])
        and not COVER_WORDS.search(r["text"])
        and not P.CITY_RE.search(r["text"])
        and not P.STREET_RE.search(r["text"])
        and not F.is_label(r["text"])
        and r["norm"] not in taken
        and len(r["text"].split()) >= 2
    ]
    if not cands:
        return None
    top = max(c["height"] for c in cands)
    big = [c for c in cands if c["height"] >= 0.9 * top]
    return big[0] if len(big) == 1 else None


def _choose(cands: list[Cand]) -> tuple[Cand, list[Cand]]:
    order = {"high": 0, "medium": 1, "low": 2}
    ranked = sorted(cands, key=lambda c: (order[c.confidence], "second_cell" in c.flags))
    return ranked[0], ranked[1:]


def read_details(pages: list[PageText], cover_pages: list[int] | None = None) -> DetailsResult:
    res = DetailsResult()
    if not pages:
        return res
    by_index = {p.page_index: p for p in pages}
    res.cover_pages = cover_pages if cover_pages is not None else cover_pages_of(pages)
    covers = [by_index[i] for i in res.cover_pages if i in by_index]
    res.no_text_pages = [c.page_index for c in covers if not c.lines]
    covers = [c for c in covers if c.lines]
    skip = set(res.cover_pages)

    cands: dict[str, list[Cand]] = {}
    for c in covers:
        for cand in F.find_label_fields(c):
            cands.setdefault(cand.field, []).append(cand)
        for cand in [*P.find_addresses(c), *P.find_dates(c), *P.find_status(c)]:
            cands.setdefault(cand.field, []).append(cand)
    votes = _title_votes(pages, skip)
    rep = R.repeated_texts(pages, skip)
    res.repeated = [{k: r[k] for k in ("norm", "pages", "share", "page_index")} for r in rep[:20]]
    cover_label = {
        f: [c for c in cs if c.rule in ("same_line", "below", "right")] for f, cs in cands.items()
    }

    for fld in (NAME_FIELD, NUMBER_FIELD):
        sources: list[Cand] = list(cover_label.get(fld, []))
        for _n, count, first in votes.get(fld, [])[:3]:
            first.rule = f"title_block_label_x{count}"
            first.confidence = "medium"
            sources.append(first)
        taken = {R.norm(c.value) for c in sources}
        pick = (
            _repeat_name(rep, taken, sources)
            if fld == NAME_FIELD
            else _repeat_number(rep, taken, sources)
        )
        if pick is not None:
            sources.append(
                Cand(fld, pick["text"], pick["page_index"], tuple(pick["box"]),
                     f"repeated_title_block_x{pick['pages']}",
                     "medium" if fld == NAME_FIELD else "low")
            )  # fmt: skip
        if fld == NAME_FIELD and covers:
            other = {R.norm(c.value) for f2, cs2 in cands.items() if f2 != fld for c in cs2}
            big = _largest_cover_text(covers[0], other)
            if big is not None:
                sources.append(big)
        if sources:
            cands[fld] = sources

    for fld, cs in cands.items():
        if fld in ("date", "issue_status"):
            continue
        best, rest = _choose(cs)
        alts = [c.json() for c in rest if c.value != best.value][:8]
        d = Detail(fld, best.value, best.page_index, best.box, best.rule, best.confidence,
                   list(best.flags), alts)  # fmt: skip
        if fld in (NAME_FIELD, NUMBER_FIELD) and len(cs) > 1:
            others = [c for c in cs if c is not best]
            same = [c for c in others if agree(best.value, c.value)]
            rest = [c for c in others if not agree(best.value, c.value)]
            # the largest cover text is only a clue: it is reported, it never makes a conflict
            diff = [c for c in rest if c.rule != "largest_cover_text"]
            clue = [c for c in rest if c.rule == "largest_cover_text"]
            d.agreement = {
                "state": "conflict" if diff else "agree" if same else "single",
                "agree": [c.rule for c in same],
                "differ": [
                    {"rule": c.rule, "value": c.value, "page_index": c.page_index} for c in diff
                ],
                "clue_differs": [{"value": c.value, "page_index": c.page_index} for c in clue],
            }
            if diff:
                d.flags.append("conflict")
                d.confidence = LOW[d.confidence] if d.confidence == "high" else d.confidence
            elif same and d.confidence == "medium" and best.rule in ("same_line", "below", "right"):
                d.confidence = "high"  # a clean label confirmed by another source
        elif fld in (NAME_FIELD, NUMBER_FIELD):
            d.agreement = {"state": "single", "agree": [], "differ": []}
        if fld in SINGLE and len({R.norm(c.value) for c in cs}) > 1:
            d.flags.append("several_values")
        res.fields[fld] = d
    for fld in ("date", "issue_status"):
        cs = cands.get(fld, [])
        if not cs:
            continue
        labelled = [c for c in cs if c.rule in ("same_line", "below", "right")]
        best = (labelled or cs)[0]
        seen = {best.value}
        alts = []
        for c in cs:
            if c.value not in seen:
                seen.add(c.value)
                alts.append(c.json())
        res.fields[fld] = Detail(fld, best.value, best.page_index, best.box, best.rule,
                                 best.confidence, [], alts[:10])  # fmt: skip
    _location(res, cands, covers)
    _building_type(res, covers)
    if "address" in cands:
        addr = cands["address"]
        best = addr[0]
        more = [c.json() for c in addr[1:6]]
        res.fields["address"] = Detail("address", best.value, best.page_index, best.box, best.rule,
                                       best.confidence, [], more)  # fmt: skip

    # the drawing index: the cover pages and any page whose rows say it is an index
    rows = []
    index_pages: set[int] = set()
    for p in pages:
        if p.lines and (
            p.page_index in set(res.cover_pages)
            or (p.name and I.title_type(p.name) == "cover_sheet")
        ):
            got = I.parse_rows(p)
            if got:
                index_pages.add(p.page_index)
                rows.extend(got)
    res.index_rows = rows
    if rows:
        res.index_flags = I.check_index(rows, pages, index_pages, set(res.cover_pages))
    return res


def _location(res: DetailsResult, cands: dict[str, list[Cand]], covers: list[PageText]) -> None:
    """Location: a labelled value, else a street address, else a line that is just "City, ST"."""
    cs = list(cands.get("location", []))
    for a in cands.get("address", []):
        cs.append(Cand("location", a.value, a.page_index, a.box, a.rule, a.confidence))
    if not cs:
        for c in covers:
            for ln in c.lines:
                t = F.clean(ln.text)
                if P.CITY_STATE_RE.match(t):
                    cs.append(
                        Cand("location", t, c.page_index, box_t(ln.box), "city_state", "medium")
                    )
    if not cs:
        return
    best, rest = _choose(cs)
    alts = [c.json() for c in rest if c.value != best.value][:8]
    res.fields["location"] = Detail("location", best.value, best.page_index, best.box, best.rule,
                                    best.confidence, [], alts)  # fmt: skip


def _building_type(res: DetailsResult, covers: list[PageText]) -> None:
    """A suggestion from the project name, else from the cover text; always low, never certain."""
    name = res.fields.get(NAME_FIELD)
    got = B.suggest_from_name(name.value) if name is not None else None
    if name is not None and got is not None:
        rule = "keyword_in_project_name"
        alts = [
            {"value": t, "page_index": name.page_index, "box": list(name.box),
             "rule": rule, "confidence": "low"}
            for t in got[1]
        ]  # fmt: skip
        res.fields["building_type"] = Detail(
            "building_type", got[0], name.page_index, name.box, rule, "low", [], alts
        )
        return
    for c in covers:
        t = B.suggest_from_notes([F.clean(ln.text) for ln in c.lines])
        if t is not None:
            first = next(ln for ln in c.lines if B.keyword_hits(F.clean(ln.text)))
            res.fields["building_type"] = Detail(
                "building_type", t, c.page_index, box_t(first.box), "keyword_in_cover_text",
                "low", [], [],
            )  # fmt: skip
            return


def common_values(values: list[str]) -> Counter:
    return Counter(R.norm(v) for v in values)
