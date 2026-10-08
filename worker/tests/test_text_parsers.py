"""Pure parsers for text read from drawings. All strings here are made up."""

import pytest

from src.text_layer.parsers.dimension import find_dimensions, parse_dimension
from src.text_layer.parsers.elevation import find_elevations, parse_elevation
from src.text_layer.parsers.marks import find_mark_candidates
from src.text_layer.parsers.profile import (
    CatalogMatcher,
    find_profiles,
    normalize_name,
    parse_profile,
)
from src.text_layer.parsers.sheet import find_sheet_numbers, parse_sheet_number


# --- profiles ----------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "family", "canonical"),
    [
        ("W12x26", "W", "W12X26"),
        ("W 12 X 26", "W", "W12X26"),
        ("w12x26", "W", "W12X26"),
        ("W12×26", "W", "W12X26"),  # multiplication sign
        ("W14X90", "W", "W14X90"),
        ("M10x9", "M", "M10X9"),
        ("S12x31.8", "S", "S12X31.8"),
        ("HP12x53", "HP", "HP12X53"),
        ("C10x15.3", "C", "C10X15.3"),
        ("MC12 x 31", "MC", "MC12X31"),
        ("L4x4x1/4", "L", "L4X4X1/4"),
        ("L6X4X3/8", "L", "L6X4X3/8"),
        ("L3-1/2x3x1/4", "L", "L3-1/2X3X1/4"),
        ("L 3 1/2 x 3 x .25", "L", "L3-1/2X3X0.25"),
        ("L3x3x0.25", "L", "L3X3X0.25"),
        ("WT6x20", "WT", "WT6X20"),
        ("MT4x9.25", "MT", "MT4X9.25"),
        ("ST5x10", "ST", "ST5X10"),
        ("HSS6x4x1/4", "HSS", "HSS6X4X1/4"),
        ("HSS 6 X 4 X 1/4", "HSS", "HSS6X4X1/4"),
        ("HSS4x4x1/4", "HSS", "HSS4X4X1/4"),
        ("HSS4.500x0.237", "HSS", "HSS4.500X0.237"),
        ("PIPE4STD", "PIPE", "PIPE4STD"),
        ("PIPE 4 STD", "PIPE", "PIPE4STD"),
        ("PIPE 6 XS", "PIPE", "PIPE6XS"),
        ("PIPE 3-1/2 XXS", "PIPE", "PIPE3-1/2XXS"),
        ("PL1/2x8", "PL", "PL1/2X8"),
        ("PL 3/4 X 10", "PL", "PL3/4X10"),
        ('PL 1/2"x8"', "PL", "PL1/2X8"),
        ("PL.5x6", "PL", "PL0.5X6"),
        ("ROD3/4", "ROD", "ROD3/4"),
        ('3/4" ROD', "ROD", "ROD3/4"),
        ('5/8" DIA THREADED ROD', "ROD", "ROD5/8"),
        ("1 ALL THREAD ROD", "ROD", "ROD1"),
    ],
)
def test_profiles_parse_to_the_canonical_form_and_keep_the_raw_string(
    text: str, family: str, canonical: str
) -> None:
    p = parse_profile(text)
    assert p is not None, text
    assert (p.family, p.canonical) == (family, canonical)
    assert p.raw.replace(" ", "").upper() == " ".join(text.split()).replace(" ", "").upper()


def test_profile_variants_and_flags() -> None:
    assert parse_profile("HSS6x4x1/4").variant == "rectangular"
    assert parse_profile("HSS4x4x1/4").variant == "square"
    assert parse_profile("HSS4.500x0.237").variant == "round"
    assert parse_profile("L4x4x1/4").variant == "equal"
    assert parse_profile("L6x4x3/8").variant == "unequal"
    assert parse_profile("PIPE 4").flags == ("pipe_weight_class_missing",)
    plate = parse_profile("PL1/2x8x1'-6\"")
    assert plate is not None and plate.canonical == "PL1/2X8" and plate.length_mm == 457.2
    assert parse_profile("PL1/2x8x12").flags == ("plate_length_assumed_inches",)


@pytest.mark.parametrize(
    "text", ["WALL", "W12", "12x26", "L3x3", "BEAM", "TYP", "X26", "W12x", "HSS", "PIPE", "ROD", ""]
)
def test_things_that_are_not_profiles_do_not_parse(text: str) -> None:
    assert parse_profile(text) is None


def test_profiles_are_found_inside_a_line_but_not_inside_words() -> None:
    found = find_profiles("(2) W12x26 BEAMS, L3x3x1/4 ANGLE, SHOW12X26 AND HSS6x4x3/8 COL")
    assert [p.canonical for p in found] == ["W12X26", "L3X3X1/4", "HSS6X4X3/8"]
    assert parse_profile("TYP W12x26") is None  # parse_profile wants the whole text


def test_a_trailing_length_is_not_part_of_the_profile() -> None:
    assert [p.canonical for p in find_profiles("HSS6x4x1/4x12")] == ["HSS6X4X1/4"]
    assert [p.canonical for p in find_profiles("L3x3x1/4 x 12'-0\"")] == ["L3X3X1/4"]
    assert parse_profile("W12x26.5").canonical == "W12X26.5"


# --- catalog validation ------------------------------------------------------------------------
def test_without_a_catalog_everything_is_unvalidated() -> None:
    v = CatalogMatcher(None).validate(parse_profile("W12x26"))
    assert (v.status, v.reason) == ("unvalidated", "catalog_not_loaded")


def test_exact_and_numeric_equivalence_matches_are_recorded_differently() -> None:
    m = CatalogMatcher(["W12X26", "L3X3X0.25", "HSS6X4X1/4", "C10X15.3"])
    assert m.validate(parse_profile("W12x26")).status == "matched_exact"
    assert m.validate(parse_profile("w 12 x 26")).status == "matched_exact"
    for text in ("L3x3x1/4", "L3x3x.250", "L3X3X0.25"):
        v = m.validate(parse_profile(text))
        assert v.catalog_name == "L3X3X0.25"
        assert v.status in ("matched_exact", "matched_by_numeric_equivalence")
    assert m.validate(parse_profile("L3x3x1/4")).status == "matched_by_numeric_equivalence"
    assert m.validate(parse_profile("HSS6x4x.250")).status == "matched_by_numeric_equivalence"
    assert m.validate(parse_profile("HSS6x4x1/4")).status == "matched_exact"


def test_no_fuzzy_matching_beyond_exact_numeric_equality() -> None:
    m = CatalogMatcher(["W12X26", "L3X3X1/4"])
    for text in ("W12x27", "W14x26", "L3x3x5/16", "L3x3x0.26", "HSS6x4x1/4", "WT12x26"):
        v = m.validate(parse_profile(text))
        assert (v.status, v.reason) == ("unvalidated", "no_catalog_match"), text


def test_pipe_plate_and_rod_match_only_by_exact_normalized_name() -> None:
    m = CatalogMatcher(["PIPE4STD", "PL1/2X8", "ROD3/4"])
    assert m.validate(parse_profile("PIPE 4 STD")).status == "matched_exact"
    assert m.validate(parse_profile("PL 1/2 x 8")).status == "matched_exact"
    # numeric equality does not apply to these families
    assert m.validate(parse_profile("PL.5x8")).status == "unvalidated"
    assert m.validate(parse_profile("ROD 0.75")).status == "unvalidated"
    assert CatalogMatcher(["W12X26"]).validate(parse_profile("PL1/2x8")).status == "unvalidated"


def test_an_ambiguous_catalog_is_not_guessed() -> None:
    m = CatalogMatcher(["L3X3X0.25", "L3X3X.250"])
    assert m.validate(parse_profile("L3x3x1/4")).reason == "catalog_ambiguous"


def test_catalog_names_are_normalized_like_the_text() -> None:
    assert normalize_name("w12 x 26") == "W12X26"
    assert normalize_name("TEST-001") == "TEST-001"  # not a profile: just upper case, no spaces
    assert CatalogMatcher(["w 12 x 26"]).validate(parse_profile("W12X26")).status == "matched_exact"


# --- dimensions --------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "mm"),
    [
        ("12'-6 1/2\"", 3822.7),
        ("12'-6\"", 3810.0),
        ("12'6\"", 3810.0),
        ("12' - 6\"", 3810.0),
        ("3'-0\"", 914.4),
        ("0'-6\"", 152.4),
        ("12'", 3657.6),
        ('6"', 152.4),
        ('1/2"', 12.7),
        ('3 1/4"', 82.55),
        ('6.5"', 165.1),
        ("3'-6-1/2\"", 1079.5),
        ("12’-6”", 3810.0),  # curly quotes
        ("12′-6″", 3810.0),  # prime and double prime
        ("12’–12”", 3962.4),  # en dash
        ("12''", 304.8),  # two apostrophes mean inches
    ],
)
def test_dimension_strings_become_millimetres(text: str, mm: float) -> None:
    d = parse_dimension(text)
    assert d is not None, text
    assert d.mm == pytest.approx(mm, abs=0.001)


def test_dimension_details_and_flags() -> None:
    d = parse_dimension("12'-6 1/2\"")
    assert (str(d.feet), str(d.inches), d.flags) == ("12", "13/2", ())
    assert parse_dimension("12'-6").flags == ("inch_mark_missing",)
    assert "inches_ge_12" in parse_dimension("1'-14\"").flags
    assert parse_dimension("10") is None and parse_dimension("W12") is None
    assert parse_dimension("") is None


def test_dimensions_are_found_in_a_line_without_swallowing_other_numbers() -> None:
    found = find_dimensions('SPAN 12\'-6" AT 3\'-0" O.C. (6" SLAB) 2 EA')
    assert [d.raw for d in found] == ["12'-6\"", "3'-0\"", '6"']
    assert find_dimensions("W12x26 AT 24 O.C.") == []


# --- elevations --------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "reference", "relative", "mm"),
    [
        ("T.O.S. EL. 100'-0\"", "top_of_steel", False, 30480.0),
        ("T/STL EL 12'-6\"", "top_of_steel", False, 3810.0),
        ("T/STL +4'-0\"", "top_of_steel", True, 1219.2),
        ("TOS = 99'-6 1/2\"", "top_of_steel", False, 30340.3),
        ("T.O.B. = -2'-6\"", "top_of_beam", True, -762.0),
        ("B.O.S. EL. 98'-0\"", "bottom_of_steel", False, 29870.4),
        ("EL. +12'-0\"", None, True, 3657.6),
        ("EL. 100'-0\"", None, False, 30480.0),
        ("+4'-0\"", None, True, 1219.2),
        ("-2'-6\"", None, True, -762.0),
        ("−2'-6\"", None, True, -762.0),  # minus sign
        ("–2'-6\"", None, True, -762.0),  # en dash
        ("TOP OF STEEL EL. 20'-0\"", "top_of_steel", False, 6096.0),
    ],
)
def test_elevation_notes(text: str, reference: str | None, relative: bool, mm: float) -> None:
    e = parse_elevation(text)
    assert e is not None, text
    assert (e.reference, e.is_relative) == (reference, relative)
    assert e.value_mm == pytest.approx(mm, abs=0.01)
    assert e.datum_unknown is True  # always: the text never names the datum


def test_plus_minus_zero_and_unitless_decimals_are_flagged_not_converted() -> None:
    e = parse_elevation("T.O.S. ±0'-0\"")
    assert e.sign == "+/-" and e.value_mm == 0.0 and "sign_ambiguous" in e.flags
    assert parse_elevation("T.O.S. +/-0'-0\"").sign == "+/-"
    d = find_elevations("EL. 100.50")[0]
    assert d.value_mm is None and d.flags == ("unit_unclear",) and d.datum_unknown


def test_a_bare_dimension_is_not_an_elevation() -> None:
    assert find_elevations("SPAN 12'-6\" TYP") == []
    assert find_elevations("") == []


def test_elevations_are_never_combined_or_assigned() -> None:
    found = find_elevations("T.O.S. EL. 100'-0\" (+4'-0\" AT DECK)")
    assert [e.is_relative for e in found] == [False, True]
    assert all(not hasattr(e, "member") and e.datum_unknown for e in found)


# --- marks and sheet numbers -------------------------------------------------------------------
def test_marks_are_candidates_only_and_never_claim_a_member() -> None:
    found = find_mark_candidates("B1 B2, C12 AND S101 SEE W12 NOTE 3")
    assert [m.raw for m in found] == ["B1", "B2", "C12", "S101", "W12"]
    assert all(m.claims_member is False for m in found)
    assert "sheet_number" in found[3].also_could_be and "profile_prefix" in found[4].also_could_be
    assert all("member_mark" in m.also_could_be for m in found)  # one possibility among others


def test_mark_candidates_skip_excluded_spans() -> None:
    text = "B1 W12x26"
    assert [m.raw for m in find_mark_candidates(text, exclude_spans=[(3, 9)])] == ["B1"]


@pytest.mark.parametrize(
    ("text", "canonical", "form"),
    [
        ("S4.1", "S4.1", "dotted"),
        ("s4.1", "S4.1", "dotted"),
        ("S-101", "S-101", "hyphenated"),
        ("S–101", "S-101", "hyphenated"),
        ("S001", "S001", "plain"),
        ("S101A", "S101A", "plain"),
        ("S2.01", "S2.01", "dotted"),
        ("(S4.1)", "S4.1", "dotted"),
    ],
)
def test_sheet_number_forms(text: str, canonical: str, form: str) -> None:
    sn = parse_sheet_number(text)
    assert sn is not None and (sn.canonical, sn.form) == (canonical, form)
    assert sn.raw == text.strip()


def test_sheet_numbers_in_a_line_and_non_numbers() -> None:
    assert [s.canonical for s in find_sheet_numbers("SEE S4.1 AND S-101 FOR BEAM")] == [
        "S4.1",
        "S-101",
    ]
    assert parse_sheet_number("BEAM") is None and parse_sheet_number("12") is None
    # a short token is a sheet number only when asked for loosely (the title block decides)
    assert find_sheet_numbers("B1 B2 S4.1") and [
        s.canonical for s in find_sheet_numbers("B1 S4.1")
    ] == ["S4.1"]
    assert [s.canonical for s in find_sheet_numbers("B1", strict=False)] == ["B1"]
