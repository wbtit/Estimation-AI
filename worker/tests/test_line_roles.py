"""Line roles for the snap: hatch, dimension lines, thin / medium / heavy (synthetic pages)."""

import numpy as np
from pdf_factory import new_doc

from src.linking.lines import page_lines
from src.review import line_roles as R
from src.review.sheet_lines_job import lines_payload


def seg(*rows):
    return np.array(rows, dtype=float)


def test_a_stack_of_parallel_short_lines_is_hatch_and_a_lone_line_is_not():
    hatch = [[10 + 3 * k, 0, 10 + 3 * k + 20, 20] for k in range(10)]
    lone = [[200, 200, 400, 200]]
    arr = seg(*hatch, *lone)
    length = np.hypot(arr[:, 2] - arr[:, 0], arr[:, 3] - arr[:, 1])
    mask = R.hatch_mask(arr, length)
    assert mask[:10].all()
    assert not mask[10]


def test_fewer_than_five_parallel_lines_are_not_hatch():
    arr = seg(*[[0, 3 * k, 50, 3 * k] for k in range(4)])
    length = np.full(4, 50.0)
    assert not R.hatch_mask(arr, length).any()


def test_roles_follow_the_pages_own_width_histogram():
    # length-weighted: 60% at 0.25, 25% at 1.0, 15% at 2.0 -> thin, medium, heavy
    arr = seg(
        [0, 0, 600, 0],
        [0, 50, 250, 50],
        [0, 100, 150, 100],
    )
    width = np.array([0.25, 1.0, 2.0])
    assert list(R.assign_roles(arr, width)) == [R.THIN, R.MEDIUM, R.HEAVY]


def test_a_short_line_that_is_not_hatch_keeps_its_width_role():
    arr = seg([0, 0, 600, 0], [0, 50, 250, 50], [0, 100, 150, 100], [300, 300, 308, 300])
    width = np.array([0.25, 1.0, 2.0, 2.0])
    assert R.assign_roles(arr, width)[3] == R.HEAVY


def test_a_dimension_line_has_terminators_at_both_ends_and_a_number_beside_it():
    # a 100 pt thin line with a 45 degree tick at each end and a number 6 pt above the middle
    arr = seg([0, 0, 100, 0], [-2, 2, 2, -2], [98, 2, 102, -2])
    roles = np.array([R.THIN, R.THIN, R.THIN])
    flag = R.dimension_lines(arr, roles, [], [(50, -6)])
    assert flag.tolist() == [True, True, True]
    no_number = R.dimension_lines(arr, roles, [], [(50, -40)])
    assert not no_number.any()
    one_end = R.dimension_lines(seg([0, 0, 100, 0], [-2, 2, 2, -2]), roles[:2], [], [(50, -6)])
    assert not one_end.any()


def test_arrow_heads_are_terminators():
    arr = seg([0, 0, 100, 0])
    arrows = [[(0, 0), (6, 2), (6, -2)], [(100, 0), (94, 2), (94, -2)]]
    assert R.dimension_lines(arr, np.array([R.THIN]), arrows, [(50, 5)]).tolist() == [True]


def test_a_heavy_line_is_never_a_dimension_line():
    arr = seg([0, 0, 100, 0], [-2, 2, 2, -2], [98, 2, 102, -2])
    assert not R.dimension_lines(arr, np.array([R.HEAVY, R.THIN, R.THIN]), [], [(50, -6)]).any()


def test_payload_with_a_page_has_role_and_dimension_columns():
    doc = new_doc()
    page = doc.new_page(width=600, height=400)
    page.draw_line((50, 300), (550, 300), width=2.5)  # a beam
    for k in range(10):  # hatch
        page.draw_line((100 + 3 * k, 50), (120 + 3 * k, 70), width=0.25)
    for k in range(5):  # plenty of thin line length, so the beam is the page's heavier class
        page.draw_line((20, 100 + 12 * k), (580, 100 + 12 * k), width=0.25)
    page.draw_line((50, 200), (350, 200), width=0.25)  # a dimension line
    page.draw_line((48, 202), (52, 198), width=0.25)
    page.draw_line((348, 202), (352, 198), width=0.25)
    page.insert_text((180, 194), "12'-0\"", fontsize=8)
    classes, rows, version = lines_payload(page_lines(page), page)
    assert all(len(r) == 8 for r in rows) and len(classes) >= 2 and len(version) == 16
    by_y = {}
    for r in rows:
        by_y.setdefault(round(r[1]), []).append(r)
    beam = by_y[300][0]
    assert beam[7] == 0 and beam[6] in (R.MEDIUM, R.HEAVY)
    hatch_rows = [r for r in rows if 50 <= r[1] <= 70 and r[5] < 0.5 and r[2] - r[0] < 25]
    assert len(hatch_rows) == 10 and all(r[6] == R.HATCH for r in hatch_rows)
    dim = by_y[200][0]
    assert dim[7] == 1
