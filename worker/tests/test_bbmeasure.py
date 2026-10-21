"""The /BBMeasure calibration reader on SYNTHETIC annotation text only."""

from __future__ import annotations

import math

from tools.bbmeasure import bb_measure_ratio

FMT = "<< /Type /NumberFormat /U ({u}) /C {c} /F /F /D 4 /FD true /SS () >>"
MEASURE = "<< /Type /Measure /Subtype /RL /R (scale) /X [ {x} ] /D [ ] >>"


def _none(_: int) -> str:
    raise AssertionError("no reference expected")


def test_inline_quarter_inch_scale_in_feet():
    obj = "<< /Subtype /Polygon /BBMeasure " + MEASURE.format(x=FMT.format(u="'", c=".05555556"))
    assert math.isclose(bb_measure_ratio(obj, _none), 48.0, rel_tol=1e-6)


def test_measure_and_number_format_by_reference():
    objs = {12: MEASURE.format(x="13 0 R"), 13: FMT.format(u="'", c=".2222222")}
    obj = "<< /Subtype /Polygon /BBMeasure 12 0 R /Vertices [ 0 0 1 1 ] >>"
    assert math.isclose(bb_measure_ratio(obj, objs.__getitem__), 192.0, rel_tol=1e-6)


def test_inches_unit_and_a_plain_measure_is_not_read_here():
    obj = "<< /BBMeasure " + MEASURE.format(x=FMT.format(u='"', c="0.6666667")) + " >>"
    assert math.isclose(bb_measure_ratio(obj, _none), 48.0, rel_tol=1e-6)
    assert bb_measure_ratio("<< /Measure " + MEASURE.format(x="") + " >>", _none) is None


def test_missing_or_unknown_parts_give_none():
    assert bb_measure_ratio("<< /BBMeasure << /Type /Measure >> >>", _none) is None
    bad_unit = "<< /BBMeasure " + MEASURE.format(x=FMT.format(u="furlong", c="1")) + " >>"
    assert bb_measure_ratio(bad_unit, _none) is None
    zero = "<< /BBMeasure " + MEASURE.format(x=FMT.format(u="'", c="0")) + " >>"
    assert bb_measure_ratio(zero, _none) is None
