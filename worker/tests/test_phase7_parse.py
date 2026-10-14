"""Synthetic PDFs for the Phase 7 vector parse (no drawings)."""

from __future__ import annotations

import pymupdf

from tools.takeoff import phase7_parse as P


def _doc(w=400, h=300):
    doc = pymupdf.open()
    page = doc.new_page(width=w, height=h)
    return doc, page


def test_dash_detection():
    assert P.is_dashed("[ 3 2 ] 0")
    assert not P.is_dashed("[] 0")
    assert not P.is_dashed("")
    assert not P.is_dashed(None)


def test_stroke_width_dash_and_colour_are_kept():
    doc, page = _doc()
    s = page.new_shape()
    s.draw_line((10, 10), (110, 10))
    s.finish(width=1.5, color=(1, 0, 0), dashes="[4 2] 0", closePath=False)
    s.draw_line((10, 30), (110, 30))
    s.finish(width=0.25, color=(0, 0, 0), closePath=False)
    s.commit()
    pr = P.parse_page(page)
    assert len(pr.prims) == 2 and len(pr.seg) == 2
    by_w = sorted(zip(pr.seg_w, pr.seg_dashed, strict=True))
    assert by_w[0][0] == 0.25 and not by_w[0][1]
    assert by_w[1][0] == 1.5 and by_w[1][1]
    p = next(p for p in pr.prims if p.width == 1.5)
    assert p.paint == "s" and p.stroke == (1.0, 0.0, 0.0) and p.dash


def test_filled_thin_rect_is_a_segment_but_a_square_is_not():
    doc, page = _doc()
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(20, 50, 120, 52))  # 100 x 2: a thick line drawn as a fill
    s.finish(fill=(0, 0, 0), color=None)
    s.draw_rect(pymupdf.Rect(200, 50, 212, 62))  # a 12 pt square fill: a column glyph, not a line
    s.finish(fill=(0, 0, 0), color=None)
    s.commit()
    pr = P.parse_page(page)
    assert len(pr.seg) == 1 and pr.seg_thinfill[0]
    assert abs(pr.seg_w[0] - 2.0) < 1e-6
    assert abs(pr.seg[0][1] - 51.0) < 1e-6 and abs(pr.seg[0][3] - 51.0) < 1e-6
    assert len(pr.shapes) == 2
    assert {sh.paint for sh in pr.shapes} == {"f"}


def test_closed_shapes_and_curves():
    doc, page = _doc()
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(10, 10, 22, 22))
    s.finish(color=(0, 0, 0), width=0.5)
    s.draw_polyline([(50, 10), (62, 10), (56, 22)])  # a triangle
    s.finish(color=(0, 0, 0), width=0.5, closePath=True)
    s.draw_circle((100, 100), 10)
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    pr = P.parse_page(page)
    kinds = sorted((sh.closed, sh.curved, sh.rect_item) for sh in pr.shapes)
    assert (True, False, True) in kinds  # the rectangle item
    assert (True, False, False) in kinds  # the closed polyline
    assert (True, True, False) in kinds  # the circle, sampled
    circle = next(sh for sh in pr.shapes if sh.curved)
    w = circle.bbox[2] - circle.bbox[0]
    assert 19 < w < 21
    # a curved shape adds no straight segments; the rectangle adds four edges, the triangle three
    assert len(pr.seg) == 7


def test_form_xobject_transform_stack_is_applied():
    src = pymupdf.open()
    sp = src.new_page(width=100, height=100)
    s = sp.new_shape()
    s.draw_rect(pymupdf.Rect(0, 0, 100, 10))
    s.finish(color=(0, 0, 0), width=1, fill=None)
    s.commit()
    doc, page = _doc()
    # the 100 x 100 source is shown scaled into a 50 x 50 box at (200, 100)
    page.show_pdf_page(pymupdf.Rect(200, 100, 250, 150), src, 0)
    pr = P.parse_page(page, doc)
    assert pr.prims, "the path inside the form must be found"
    x0, y0, x1, y1 = pr.prims[0].bbox
    assert abs(x0 - 200) < 0.6 and abs(x1 - 250) < 0.6  # scaled by 0.5 and moved
    assert abs(y0 - 100) < 0.6 and abs(y1 - 105) < 0.6
    assert pr.prims[0].in_form
    rep = P.forms_report(pr)
    assert rep["forms"] >= 1 and rep["prims_in_form"] == 1


def test_rotation_is_applied_by_hand():
    doc, page = _doc(400, 300)
    s = page.new_shape()
    s.draw_line((50, 40), (150, 40))  # horizontal in the stored frame
    s.finish(color=(0, 0, 0), width=1)
    s.commit()
    page.set_rotation(90)
    pr = P.parse_page(page)
    x0, y0, x1, y1 = pr.seg[0]
    assert abs(x0 - x1) < 1e-6  # vertical when displayed
    assert abs(abs(y1 - y0) - 100) < 1e-6
    # the displayed page is 300 wide and 400 high: the segment stays inside
    assert 0 <= x0 <= 300 and 0 <= min(y0, y1) and max(y0, y1) <= 400
    assert pr.size == (300.0, 400.0)
