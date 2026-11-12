"""Phase 0 cover details on SYNTHETIC pages: label rules, patterns, title-block repeat, agreement,
the drawing index and its check. Nothing here is a real project."""

from __future__ import annotations

import pymupdf

from src.details import fields as F
from src.details import index as I  # noqa: E741
from src.details import patterns as P
from src.details import repeat as R
from src.details.read import agree, read_details
from src.details.types import PageText
from src.pdf_scan.textlines import page_words_and_lines

W, H = 792.0, 612.0


def _page(texts: list[tuple[float, float, str, float]], index: int = 0, **kw) -> PageText:
    doc = pymupdf.open()
    pg = doc.new_page(width=W, height=H)
    for x, y, t, size in texts:
        pg.insert_text((x, y), t, fontsize=size)
    _w, lines = page_words_and_lines(pg)
    return PageText(index, W, H, lines, **kw)


def _vals(cands, fld):
    return [(c.value, c.rule, c.confidence) for c in cands if c.field == fld]


# ---- labelled fields ---------------------------------------------------------------------------
def test_value_on_the_same_line_is_high():
    p = _page([(60, 100, "PROJECT: Riverside Warehouse", 11)])
    assert _vals(F.find_label_fields(p), "project_name") == [
        ("Riverside Warehouse", "same_line", "high")
    ]


def test_value_below_the_label_one_line_high_two_lines_medium():
    one = _page([(60, 100, "OWNER", 8), (60, 114, "Acme Holdings LLC", 11)])
    assert _vals(F.find_label_fields(one), "owner") == [("Acme Holdings LLC", "below", "high")]
    two = _page(
        [(60, 100, "ARCHITECT", 8), (60, 114, "Smith Partners", 11), (60, 127, "Design Group", 11)]
    )
    assert _vals(F.find_label_fields(two), "architect") == [
        ("Smith Partners Design Group", "below", "medium")
    ]


def test_value_in_the_cell_to_the_right_of_a_table_label():
    p = _page([(60, 100, "CONTRACTOR", 9), (200, 100, "Bravo Builders", 9)])
    got = _vals(F.find_label_fields(p), "contractor")
    assert got == [("Bravo Builders", "right", "medium")]
    far = _page([(60, 100, "CONTRACTOR", 9), (300, 100, "Bravo Builders", 9)])
    assert _vals(F.find_label_fields(far), "contractor") == [("Bravo Builders", "right", "low")]


def test_the_cell_below_stops_at_the_next_label_and_a_label_is_never_a_value():
    p = _page([(60, 100, "OWNER", 8), (60, 114, "ARCHITECT", 8), (60, 128, "Smith Partners", 11)])
    got = F.find_label_fields(p)
    assert _vals(got, "owner") == []  # the next line is a label: no value, nothing guessed
    assert _vals(got, "architect") == [("Smith Partners", "below", "high")]


def test_common_words_need_a_colon_and_manager_is_not_the_label():
    p = _page(
        [(60, 100, "CODE COMPLIANT DESIGN", 9), (60, 120, "PROJECT MANAGER Jane", 9),
         (60, 140, "DATE 5/12/2024", 9)]
    )  # fmt: skip
    got = F.find_label_fields(p)
    assert _vals(got, "building_code") == [] and _vals(got, "project_name") == []
    assert _vals(got, "date") == []  # "DATE" is strict: it needs a colon or to stand alone
    ok = _page([(60, 100, "DATE: 5/12/2024", 9), (60, 120, "BUILDING CODE: IBC 2018", 9)])
    assert _vals(F.find_label_fields(ok), "date") == [("5/12/2024", "same_line", "high")]
    assert _vals(F.find_label_fields(ok), "building_code")[0][0] == "IBC 2018"


def test_project_number_needs_a_digit_risk_category_is_a_numeral_and_loads_are_read():
    p = _page(
        [(60, 100, "JOB NO.: 24-0173", 9), (60, 120, "PROJECT NO: TBD", 9),
         (60, 140, "RISK CATEGORY: III", 9), (60, 160, "GROUND SNOW LOAD: 25 PSF", 9)]
    )  # fmt: skip
    got = F.find_label_fields(p)
    assert _vals(got, "project_number") == [("24-0173", "same_line", "high")]
    assert _vals(got, "risk_category") == [("III", "same_line", "high")]
    assert _vals(got, "load_ground_snow")[0][0] == "25 PSF"


def test_issued_for_keeps_its_label_in_the_value():
    p = _page([(60, 100, "ISSUED FOR BID", 10)])
    assert _vals(F.find_label_fields(p), "issue") == [("ISSUED FOR BID", "same_line", "high")]


def test_a_label_inside_a_sentence_is_not_a_value_and_one_short_word_is_not_a_name():
    # "CONTRACTOR TO FIELD VERIFY ..." is a drawing note, not the contractor (a real page 1)
    note = _page(
        [(60, 100, "CONTRACTOR TO", 9), (60, 120, "CONTRACTOR TO FIELD", 9),
         (60, 140, "OWNER SHALL PROVIDE", 9), (60, 160, "ARCHITECT BY OTHERS", 9)]
    )  # fmt: skip
    got = F.find_label_fields(note)
    assert [c for c in got if c.field in ("contractor", "owner", "architect")] == []
    short = _page([(60, 100, "OWNER: ABC", 9), (60, 120, "CONTRACTOR: Bravo", 9)])
    got = {c.field: c for c in F.find_label_fields(short)}
    assert "owner" not in got  # three letters, one word
    assert (
        got["contractor"].value == "Bravo" and got["contractor"].confidence == "low"
    )  # never high
    full = _page([(60, 100, "CONTRACTOR: Bravo Builders Inc", 9)])
    assert _vals(F.find_label_fields(full), "contractor")[0][2] == "high"  # a real name stays high


# ---- patterns ----------------------------------------------------------------------------------
def test_address_two_lines_one_line_and_near_misses():
    two = _page([(60, 100, "1200 Harbor Blvd", 10), (60, 114, "Portland, OR 97201", 10)])
    assert [c.value for c in P.find_addresses(two)] == ["1200 Harbor Blvd Portland, OR 97201"]
    one = _page([(60, 100, "45 Main St Austin, TX 78701", 10)])
    assert [c.value for c in P.find_addresses(one)] == ["45 Main St Austin, TX 78701"]
    miss = _page([(60, 100, "1200 Harbor", 10), (60, 114, "Portland, OR", 10)])
    assert P.find_addresses(miss) == []  # no street suffix, no ZIP: nothing guessed
    far = _page([(60, 100, "1200 Harbor Blvd", 10), (60, 300, "Portland, OR 97201", 10)])
    assert P.find_addresses(far) == []


def test_dates_and_status_words():
    p = _page(
        [(60, 100, "Issued 03/14/2024 and 5 June 2024", 9), (60, 120, "ISSUED FOR PERMIT", 9),
         (60, 140, "FOR CONSTRUCTION", 9), (60, 160, "Revision 3", 9)]
    )  # fmt: skip
    assert [c.value for c in P.find_dates(p)] == ["03/14/2024", "5 June 2024"]
    assert [c.value for c in P.find_status(p)] == ["ISSUED FOR PERMIT", "ISSUED FOR CONSTRUCTION"]


# ---- repeat in the title block -----------------------------------------------------------------
def _sheet(i: int, extra=()):
    return _page(
        [(600, 560, "Riverside Warehouse", 12), (600, 575, "24-0173", 9),
         (600, 590, f"S10{i}", 14), (60, 300, f"plan {i}", 9), *extra],
        index=i, sheet_number=f"S10{i}",
    )  # fmt: skip


def test_text_repeated_in_the_same_cell_is_found_the_sheet_number_is_not():
    rep = R.repeated_texts([_sheet(i) for i in range(1, 6)])
    norms = [r["norm"] for r in rep]
    assert "RIVERSIDE WAREHOUSE" in norms and "24 0173" in norms
    assert not any(n.startswith("S10") for n in norms) and "PLAN 1" not in norms
    assert next(r for r in rep if r["norm"] == "RIVERSIDE WAREHOUSE")["share"] == 1.0


def test_too_few_sheets_or_a_moved_text_find_nothing():
    assert R.repeated_texts([_sheet(i) for i in range(1, 3)]) == []
    moved = [_sheet(1), _sheet(2), _sheet(3)]
    moved[1] = _page([(600, 520, "Riverside Warehouse", 12)], index=2)
    moved[2] = _page([(500, 570, "Riverside Warehouse", 12)], index=3)
    assert not any(r["norm"] == "RIVERSIDE WAREHOUSE" for r in R.repeated_texts(moved))


# ---- agreement ---------------------------------------------------------------------------------
def test_agreement_and_conflict_of_name_and_number():
    assert agree("Riverside Warehouse", "RIVERSIDE WAREHOUSE - PHASE 2")
    assert not agree("Riverside Warehouse", "Harbor Offices")
    cover = _page(
        [(60, 100, "PROJECT: Riverside Warehouse", 11), (60, 130, "JOB NO.: 24-0173", 10)],
        index=0, role_name="Cover / Title page",
    )  # fmt: skip
    res = read_details([cover, *[_sheet(i) for i in range(1, 6)]])
    name, number = res.fields["project_name"], res.fields["project_number"]
    assert name.value == "Riverside Warehouse" and name.agreement["state"] == "agree"
    assert name.confidence == "high" and number.value == "24-0173"
    other = _page(
        [(60, 100, "PROJECT: Harbor Offices", 11)], index=0, role_name="Cover / Title page"
    )
    res = read_details([other, *[_sheet(i) for i in range(1, 6)]])
    d = res.fields["project_name"]
    assert d.value == "Harbor Offices" and d.agreement["state"] == "conflict"
    assert "conflict" in d.flags and d.confidence != "high"  # shown, never resolved
    assert {x["value"] for x in d.agreement["differ"]} >= {"Riverside Warehouse"}


def test_repeated_text_alone_is_medium_and_a_second_number_like_text_is_not_chosen():
    res = read_details([_page([(60, 100, "Some cover text here", 10)], index=0)]
                       + [_sheet(i) for i in range(1, 6)])  # fmt: skip
    d = res.fields["project_name"]
    assert (
        d.value == "Riverside Warehouse"
        and d.confidence == "medium"
        and d.rule.startswith("repeated")
    )
    assert res.fields["project_number"].value == "24-0173"
    assert res.fields["project_number"].confidence == "low"


def test_an_outlined_cover_has_no_fields_and_says_so():
    blank = _page([], index=0)  # no text layer
    res = read_details([blank, *[_sheet(i) for i in range(1, 3)]])
    assert res.no_text_pages == [0] and res.cover_pages == [0]
    assert "owner" not in res.fields and res.index_rows == []


# ---- the drawing index -------------------------------------------------------------------------
def _index_page(rows, two_cell=False):
    texts = []
    for k, (n, t) in enumerate(rows):
        y = 100 + 16 * k
        if two_cell:
            texts += [(60, y, n, 10), (160, y, t, 10)]
        else:
            texts.append((60, y, f"{n}  {t}", 10))
    return _page(texts, index=0, role_name="Cover / Title page")


ROWS = [
    ("S101", "FOUNDATION PLAN"),
    ("S102", "FIRST FLOOR FRAMING PLAN"),
    ("S103", "ROOF FRAMING PLAN"),
    ("A40-S2300", "TYPICAL DETAILS"),
]


def test_index_rows_same_line_two_cell_and_the_sub_sheet_form():
    for two in (False, True):
        rows = I.parse_rows(_index_page(ROWS, two))
        assert [(r.number, r.title) for r in rows] == ROWS
        assert {r.rule for r in rows} == {"two_cell" if two else "same_line"}
    assert I.parse_rows(_index_page(ROWS[:2])) == []  # fewer than 3 rows: not an index


def _pages(numbers, names, roles=None):
    return [
        PageText(i + 1, W, H, [], n, nm, (roles or {}).get(i + 1, (None, None))[0],
                 (roles or {}).get(i + 1, (None, None))[1], f"id{i}")
        for i, (n, nm) in enumerate(zip(numbers, names, strict=True))
    ]  # fmt: skip


def test_check_flags_each_kind_and_only_suggests():
    rows = I.parse_rows(_index_page(ROWS))
    pages = [
        PageText(0, W, H, [], None, "COVER", None, "Cover / Title page", "c"),
        *_pages(
            ["S101", "S102", "S9.99", "S104"],
            ["FOUNDATION PLAN", "FIRST FLOOR FRAMING PLAN", "ROOF FRAMING PLAN", "SPECIAL SHEET"],
            {1: ("framing", "Framing plan")},  # index says FOUNDATION, role says Framing
        ),
    ]
    flags = {
        (f.kind, f.number or (f.detail.get("number"))) for f in I.check_index(rows, pages, {0}, {0})
    }
    assert ("role_disagreement", "S101") in flags
    assert ("number_mismatch", "S103") in flags  # S103 on the index; the page reads S9.99
    assert ("missing_from_pdf", "A40-S2300") in flags
    assert ("not_in_index", "S104") in flags
    assert not any(k == "name_mismatch" for k, _ in flags)
    assert rows[0].match == "exact" and rows[0].matched_page == 1


def test_equivalent_numbers_and_a_name_mismatch_are_flagged_not_matched_silently():
    rows = I.parse_rows(
        _index_page([("S4.01", "ROOF PLAN"), ("S402", "STEEL DETAILS"), ("S403", "NOTES")])
    )
    pages = _pages(["S4-01", "S402", "S403"], ["ROOF PLAN", "PIER SCHEDULE", "NOTES"])
    got = I.check_index(rows, pages, {0}, {0})
    kinds = {f.kind for f in got}
    assert "number_format" in kinds and "name_mismatch" in kinds
    assert rows[0].match == "equivalent"
    assert all(
        f.page_index is not None for f in got if f.kind in ("name_mismatch", "number_format")
    )


# ---- the four shown fields: client, location, value above the label, building type ------------
def test_client_labels_and_location_labels():
    p = _page(
        [
            (60, 100, "PREPARED FOR:", 8), (60, 114, "Acme Holdings LLC", 11),
            (60, 140, "DESIGNED (CLIENT): Bravo Foods Inc", 9),
            (60, 170, "PLANT: Eastside Ethanol Facility", 9),
            (60, 190, "SITE", 8), (60, 204, "Austin, TX", 10),
        ]
    )  # fmt: skip
    got = F.find_label_fields(p)
    assert ("Acme Holdings LLC", "below", "high") in _vals(got, "owner")
    assert ("Bravo Foods Inc", "same_line", "high") in _vals(got, "owner")
    locs = [v for v, _r, _c in _vals(got, "location")]
    assert "Eastside Ethanol Facility" in locs and "Austin, TX" in locs
    # "PREPARED FOR" inside a sentence is not a label
    s = _page([(60, 100, "PREPARED FOR REVIEW ONLY BY THE ENGINEER", 9)])
    assert _vals(F.find_label_fields(s), "owner") == []


def test_value_above_the_label_only_when_nothing_else_is_near():
    p = _page([(60, 100, "24-0187", 12), (60, 114, "PROJECT NO.", 7)])
    assert _vals(F.find_label_fields(p), "project_number") == [("24-0187", "above", "medium")]
    # label above its value: the value belongs to the label above, not to the next one
    q = _page(
        [(60, 100, "OWNER", 7), (60, 114, "Acme Holdings LLC", 11), (60, 128, "ARCHITECT", 7)]
    )
    got = F.find_label_fields(q)
    assert _vals(got, "owner") == [("Acme Holdings LLC", "below", "high")]
    assert _vals(got, "architect") == []


def test_location_from_address_or_city_state_line_and_nothing_else():
    two = _page([(60, 100, "1200 Harbor Blvd", 10), (60, 114, "Portland, OR 97201", 10)])
    loc = read_details([two, _sheet(1), _sheet(2)]).fields.get("location")
    assert loc is not None and loc.value == "1200 Harbor Blvd Portland, OR 97201"
    alone = _page([(60, 100, "Austin, TX", 10), (60, 130, "SOME NOTE TEXT", 9)])
    res = read_details([alone, _sheet(1), _sheet(2)])
    assert (
        res.fields["location"].value == "Austin, TX" and res.fields["location"].rule == "city_state"
    )
    none = _page([(60, 100, "GENERAL NOTES", 10)])
    assert "location" not in read_details([none, _sheet(1), _sheet(2)]).fields


def test_building_type_is_a_low_suggestion_from_keywords_only():
    p = _page([(60, 100, "PROJECT: Eastside Ethanol Plant Expansion", 11)])
    f = read_details([p, _sheet(1), _sheet(2)]).fields["building_type"]
    assert f.value == "Industrial" and f.confidence == "low"
    assert f.rule == "keyword_in_project_name"
    w = _page([(60, 100, "PROJECT: Riverside Warehouse", 11)])
    assert read_details([w, _sheet(1), _sheet(2)]).fields["building_type"].value == "Warehouse"
    none = _page([(60, 100, "PROJECT: Riverside Crossing", 11)])
    assert "building_type" not in read_details([none, _sheet(1), _sheet(2)]).fields
    notes = _page([(60, 100, "PROJECT: Riverside Crossing", 11), (60, 130, "NEW PARKING DECK", 9)])
    assert read_details([notes, _sheet(1), _sheet(2)]).fields["building_type"].value == "Parking"
    two = _page([(60, 100, "PROJECT: Riverside Crossing", 11), (60, 130, "SCHOOL AND HOSPITAL", 9)])
    assert "building_type" not in read_details([two, _sheet(1), _sheet(2)]).fields
