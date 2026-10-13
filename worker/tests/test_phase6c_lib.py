"""Synthetic tests for the Phase 6c census helpers (no real drawing)."""

import math

import pymupdf

from tools.takeoff import phase6c_lib as L


def test_segment_and_polygon_distances():
    assert L.seg_distance(5, 5, (0, 0), (10, 0)) == 5
    assert L.seg_distance(-3, 4, (0, 0), (10, 0)) == 5  # beyond the end: distance to the end point
    sq = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert L.polyline_distance(5, 5, sq, closed=True, filled=True) == 0.0  # inside a filled shape
    assert L.polyline_distance(5, 5, sq, closed=True, filled=False) == 5.0  # stroke: to the edge
    assert math.isclose(L.polyline_distance(13, 14, sq, closed=True, filled=True), 5.0)


def test_bezier_points_end_and_midpoint():
    pts = L.bezier_points((0, 0), (0, 10), (10, 10), (10, 0))
    assert pts[0] == (0, 0) and pts[-1] == (10, 0) and len(pts) == L.CURVE_SAMPLES + 1
    assert math.isclose(pts[len(pts) // 2][0], 5.0) and math.isclose(pts[len(pts) // 2][1], 7.5)


def test_classify_primitive_follows_the_extractor_rule():
    box = (0, 0, 100, 100)
    assert L.classify_primitive("s", "l", box, 10) == L.KEPT
    assert L.classify_primitive("fs", "re", box, 10) == L.KEPT
    assert L.classify_primitive("s", "c", box, 10) == "curve"
    assert L.classify_primitive("s", "qu", box, 10) == "quad"
    assert L.classify_primitive("f", "l", box, 10) == "filled shape"  # a filled non-thin shape
    thin = (0, 0, 40, 2)  # long side 40, thin 2, aspect 20
    assert L.classify_primitive("f", "re", thin, 40) == L.KEPT
    assert L.classify_primitive("f", "re", (0, 0, 40, 10), 40) == "filled shape"  # aspect 4
    assert L.classify_primitive("s", "l", box, 0.01) == "short stroked line"


def test_buckets():
    assert L.width_bucket(0.05) == "<0.1" and L.width_bucket(0.3) == "0.25-0.5"
    assert L.width_bucket(3.0) == ">2.5"
    assert [L.path_size_bucket(n) for n in (1, 3, 10, 50)] == ["1", "2-4", "5-20", ">20"]


def test_census_category_precedence():
    f = L.census_category
    assert f(other_class_line=True, dropped=True, in_image=True, text_near=True) == L.CATEGORIES[0]
    assert f(other_class_line=False, dropped=True, in_image=True, text_near=True) == L.CATEGORIES[1]
    assert (
        f(other_class_line=False, dropped=False, in_image=True, text_near=True) == L.CATEGORIES[2]
    )
    assert (
        f(other_class_line=False, dropped=False, in_image=False, text_near=True) == L.CATEGORIES[3]
    )
    assert (
        f(other_class_line=False, dropped=False, in_image=False, text_near=False) == L.CATEGORIES[4]
    )


def test_stream_scan_tracks_ctm_and_ignores_strings():
    data = (
        b"q 1 0 0 1 100 50 cm (a Do inside (a string) /X Do) Tj /F1 Do Q "
        b"BI /W 1 ID xx Do EI q 2 0 0 2 0 0 cm /F2 Do Q"
    )
    calls = L.form_calls(data)
    assert [n for n, _ in calls] == ["F1", "F2"]
    assert calls[0][1] == (1.0, 0.0, 0.0, 1.0, 100.0, 50.0)
    assert calls[1][1] == (2.0, 0.0, 0.0, 2.0, 0.0, 0.0)


def test_stream_scan_survives_stray_tokens():
    data = b"q 1 0 0 1 5 5 cm 0* 12 -.5 +3. foo* /F1 Do Q"
    assert [n for n, _ in L.form_calls(data)] == ["F1"]


def test_matrix_product_order_is_translate_then_scale():
    # a point is moved by the first matrix, then by the second
    assert L.mat_mul((1, 0, 0, 1, 10, 0), (2, 0, 0, 2, 0, 0)) == (2, 0, 0, 2, 20, 0)


def _form_page(rotation: int) -> tuple[pymupdf.Document, pymupdf.Page]:
    src = pymupdf.open()
    sp = src.new_page(width=100, height=100)
    sp.draw_rect(pymupdf.Rect(10, 10, 90, 90), color=(0, 0, 0))
    doc = pymupdf.open()
    page = doc.new_page(width=400, height=300)
    page.show_pdf_page(pymupdf.Rect(200, 100, 300, 200), src, 0)
    if rotation:
        page.set_rotation(rotation)
    return doc, page


def test_form_quads_cover_the_drawing_inside_the_form_on_plain_and_rotated_pages():
    for rotation in (0, 90, 270):
        doc, page = _form_page(rotation)
        quads = L.form_quads(doc, page)
        assert quads, rotation
        m = page.rotation_matrix
        found = 0
        for d in page.get_drawings():
            r = pymupdf.Rect(d["rect"]) * m
            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            found += any(L.inside_polygon(cx, cy, q) for q in quads)
        assert found >= 1, rotation
        # a point far from the form is not inside any quad
        far = pymupdf.Point(20, 20) * m
        assert not any(L.inside_polygon(far.x, far.y, q) for q in quads)


def test_sample_selection_is_fixed_and_capped_per_job():
    pop = [(f"job-{j:03d}", p, i) for j in range(8) for p in range(3) for i in range(10)]
    a = L.select_sample(pop)
    assert a == L.select_sample(list(reversed(pop)))  # the order of the input does not matter
    assert len(a) == 48  # 8 jobs x 6 per job: fewer than 60 are available under the cap
    assert max(sum(1 for x in a if x[0] == j) for j in {x[0] for x in a}) == 6
    b = L.select_sample(pop, seed=1)
    assert a != b  # another seed gives another sample
