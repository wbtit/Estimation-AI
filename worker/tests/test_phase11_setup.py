"""Phase 11 setup harness: the owner's pixel inputs (pure helpers; synthetic values only)."""

import pytest

from src.linking.lines import Line
from tools.takeoff.phase11_setup import (
    LONG_SIDE_PX,
    PEN_POINT_MAX_PX,
    nearest_line,
    px_box_to_pt,
    px_per_pt,
)


def test_pixels_per_point_follow_the_long_side():
    assert px_per_pt(2000, 1000) == LONG_SIDE_PX / 2000
    assert px_per_pt(1000, 2000) == LONG_SIDE_PX / 2000


def test_crop_px_converts_to_points_in_any_corner_order_and_clips():
    zoom = 1.5
    assert px_box_to_pt([150, 300, 1500, 900], zoom, (2000, 1000)) == (100, 200, 1000, 600)
    assert px_box_to_pt([1500, 900, 150, 300], zoom, (2000, 1000)) == (100, 200, 1000, 600)
    assert px_box_to_pt([-1, 0, 3000, 1500], zoom, (2000, 1000)) == (0, 0, 2000, 1000)


@pytest.mark.parametrize(
    "bad", [[1, 2, 3], [10, 10, 10.5, 400], [0, 0, 9000, 100], "100,200,300,400"]
)
def test_bad_crop_px_is_refused(bad):
    with pytest.raises(ValueError):
        px_box_to_pt(bad, 1.5, (2000, 1000))


def _line(x0, y0, x1, y1, width=2.0, colour="black"):
    return Line(x0, y0, x1, y1, width, colour, False, 1)


def test_beam_point_picks_the_nearest_line_within_10_px():
    zoom = 2.0
    heavy = _line(100, 100, 500, 100)
    thin = _line(100, 104, 500, 104, width=0.3)
    got = nearest_line([thin, heavy], [600, 205], zoom)  # (300, 102.5) pt: 5 px to heavy, 3 to thin
    assert got is not None and got[0] is thin and got[1] == pytest.approx(3.0)
    got = nearest_line([thin, heavy], [600, 199], zoom)  # 1 px from heavy
    assert got[0] is heavy and got[0].klass == "1.5-2.5|black|solid"
    assert nearest_line([heavy], [600, 200 + 2 * PEN_POINT_MAX_PX + 2], zoom) is None


def test_ties_go_to_the_longer_line_and_bad_points_are_refused():
    zoom = 1.0
    short = _line(0, 10, 50, 10, width=0.3)
    long_ = _line(0, -10, 500, -10)
    got = nearest_line([short, long_], [20, 0], zoom)
    assert got[0] is long_
    with pytest.raises(ValueError):
        nearest_line([long_], [1], zoom)
