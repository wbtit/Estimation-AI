"""Phase 14a: the page name from its text (synthetic lines only)."""

from src.build.sheet_names import Line, _displayed_size, read_names

W, H = 2000.0, 1000.0


def _l(text, x0, y0, x1, y1):
    return Line(text, (x0, y0, x1, y1))


NOTES = [_l(f"note {i}", 100, 600 + 10 * i, 300, 608 + 10 * i) for i in range(20)]


def test_a_view_title_with_a_scale_under_it_and_an_underline():
    lines = NOTES + [
        _l("SECOND FLOOR FRAMING PLAN", 400, 500, 700, 516),
        _l('SCALE: 1/8" = 1\'-0"', 420, 522, 600, 530),
        _l("TYPICAL BEAM NOTES", 1000, 100, 1200, 116),  # large caps, nothing under it
    ]
    names = read_names(lines, [(400, 518, 700, 518)], W, H)
    assert names.view_title == "SECOND FLOOR FRAMING PLAN"
    assert [(v.scale, v.underlined) for v in names.view_titles] == [(True, True)]


def test_an_underline_alone_counts_and_the_main_title_has_both():
    lines = NOTES + [
        _l("SECTION A-A", 100, 100, 250, 114),
        _l("ROOF FRAMING PLAN", 600, 400, 900, 420),
        _l('1/4" = 1\'-0"', 620, 425, 760, 433),
    ]
    segs = [(100, 116, 250, 116.2), (600, 422, 900, 422)]
    names = read_names(lines, segs, W, H)
    assert [v.text for v in names.view_titles] == ["SECTION A-A", "ROOF FRAMING PLAN"]
    assert names.view_title == "ROOF FRAMING PLAN"


def test_not_a_title_lower_case_small_text_or_inside_the_title_block():
    lines = NOTES + [
        _l("Second floor plan", 400, 500, 700, 516),
        _l('SCALE: 1/8" = 1\'-0"', 420, 520, 600, 528),
        _l("SMALL CAPS TEXT", 400, 300, 500, 308),
        _l('1/8" = 1\'-0"', 400, 310, 480, 318),
        _l("FOUNDATION PLAN", 1600, 800, 1900, 820),  # in the title block
        _l("SCALE: AS NOTED", 1600, 825, 1800, 833),
    ]
    names = read_names(lines, [], W, H)
    assert names.view_titles == [] and names.view_title is None


def test_title_block_name_under_its_label_joined_over_two_lines():
    lines = NOTES + [
        _l("SHEET TITLE:", 1600, 700, 1680, 706),
        _l("FOUNDATION PLAN", 1600, 712, 1800, 724),
        _l("AND DETAILS", 1600, 727, 1720, 739),
        _l("PROJECT NO. 123", 1600, 760, 1700, 766),
        _l("S-101", 1800, 900, 1950, 960),
    ]
    names = read_names(lines, [], W, H, sheet_number="S-101")
    assert names.title_block_name == "FOUNDATION PLAN AND DETAILS"
    assert names.title_block_rule == "label"


def test_title_block_name_without_a_label_is_the_largest_line():
    lines = NOTES + [
        _l("DATE: 01/02/03", 1600, 700, 1700, 706),
        _l("ROOF FRAMING PLAN", 1600, 800, 1900, 818),
        _l("DRAWN BY", 1600, 840, 1650, 846),
    ]
    names = read_names(lines, [], W, H)
    assert (names.title_block_name, names.title_block_rule) == ("ROOF FRAMING PLAN", "largest")
    assert names.view_title is None


def test_the_stored_size_is_the_displayed_size_on_every_rotation():
    # fix/crop-anywhere: width_pt / height_pt are stored from page.rect (rotation applied)
    for rotation in (0, 90, 180, 270, None):
        sheet = {"width_pt": 3024, "height_pt": 2160, "rotation": rotation}
        assert _displayed_size(sheet) == (3024.0, 2160.0)
