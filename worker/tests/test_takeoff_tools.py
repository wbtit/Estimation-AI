"""Phase 5t study tools on SYNTHETIC annotated PDFs generated here (no real takeoff data)."""

import sys
from pathlib import Path

import numpy as np
import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.takeoff.common import page_hash, page_signature  # noqa: E402
from tools.takeoff.geometry_study import (  # noqa: E402
    band,
    dist_points_segments,
    measure_scale,
    poly_length,
    ratio_from_measure,
    samples_along,
    vertices_of,
)
from tools.takeoff.structure import study_file  # noqa: E402


def make_pdf(path: Path, rotate: int = 0) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.insert_text((50, 60), "W12x26 PLAN NOTE TEXT HERE", fontsize=10)
    page.draw_line((100, 200), (500, 200), width=2.0)
    page.add_line_annot((100, 200), (300, 200))  # a length-like markup on the drawn line
    page.add_polyline_annot([(100, 300), (200, 300), (200, 350)])
    page.add_polygon_annot([(10, 10), (30, 10), (20, 30)])  # a triangle symbol (a count symbol)
    page.add_freetext_annot(pymupdf.Rect(40, 120, 100, 140), "B12")
    if rotate:
        page.set_rotation(rotate)
    doc.save(path)


def test_structure_counts_subtypes_and_fields(tmp_path: Path) -> None:
    p = tmp_path / "t.pdf"
    make_pdf(p)
    r = study_file(p)
    assert r["pages"] == 1 and r["annots"] == 4
    assert dict(r["by_subtype"]) == {"Line": 1, "PolyLine": 1, "Polygon": 1, "FreeText": 1}
    assert r["fields"]["FreeText"]["has_contents"] == 1
    assert r["fields"]["Line"]["has_measure"] == 0  # no measurement dictionary was written
    assert r["fields"]["Polygon"]["vertices>=2"] == 1


def test_the_text_fingerprint_ignores_annotations(tmp_path: Path) -> None:
    plain, marked = tmp_path / "a.pdf", tmp_path / "b.pdf"
    doc = pymupdf.open()
    pg = doc.new_page(width=600, height=400)
    pg.insert_text((50, 60), "ALPHA BETA GAMMA DELTA EPSILON ZETA", fontsize=10)
    doc.save(plain)
    pg.add_freetext_annot(pymupdf.Rect(40, 120, 200, 160), "EXTRA COMMENT WORDS HERE")
    doc.save(marked)
    with pymupdf.open(plain) as a, pymupdf.open(marked) as b:
        assert page_hash(a[0]) == page_hash(b[0]) is not None
        assert page_signature(a[0]) == page_signature(b[0])


def test_geometry_helpers() -> None:
    v = [(0.0, 0.0), (30.0, 40.0), (30.0, 100.0)]
    assert poly_length(v) == 110.0
    pts = samples_along([(0.0, 0.0), (10.0, 0.0)], step=1.0)
    assert len(pts) == 11 and pts[0].tolist() == [0.0, 0.0] and pts[-1].tolist() == [10.0, 0.0]
    d = dist_points_segments(np.array([[5.0, 3.0], [20.0, 0.0]]), np.array([[0.0, 0.0, 10.0, 0.0]]))
    assert d.round(3).tolist() == [[3.0], [10.0]]
    assert [band(x) for x in (0.1, 0.5, 1.0, 2.0)] == ["<0.25", "0.25-0.75", "0.75-1.25", ">1.25"]


def test_vertices_follow_the_page_rotation(tmp_path: Path) -> None:
    p = tmp_path / "r.pdf"
    make_pdf(p, rotate=90)
    with pymupdf.open(p) as doc:
        page = doc[0]
        a = next(x for x in page.annots() if x.type[1] == "Line")
        v = vertices_of(a, page)
        # the line was (100,200)-(300,200) on an unrotated 600x400 page; displayed it is vertical
        assert abs(v[0][0] - v[1][0]) < 0.01 and abs(abs(v[0][1] - v[1][1]) - 200) < 0.01


def test_measurement_scale_is_read_from_the_number_format(tmp_path: Path) -> None:
    """A PDF /Measure number format (1/2 in = 1 ft: C = 1/36 ft per point... C = 0.0277778 ft per point)."""
    p = tmp_path / "m.pdf"
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    a = page.add_line_annot((100, 100), (172, 100))
    nf = doc.get_new_xref()
    doc.update_object(nf, "<< /Type /NumberFormat /U (ft) /C 0.02777778 /F /D /D 16 >>")
    ms = doc.get_new_xref()
    doc.update_object(
        ms,
        f"<< /Type /Measure /Subtype /RL /R (0.5 in = 1 ft) /X [{nf} 0 R] /D [{nf} 0 R] /A [{nf} 0 R] >>",
    )
    doc.xref_set_key(a.xref, "Measure", f"{ms} 0 R")
    doc.save(p)
    with pymupdf.open(p) as d2:
        obj = d2.xref_object(next(iter(d2[0].annots())).xref, compressed=False)
        got = measure_scale(obj, d2)
    assert got is not None and got[1] == "ft" and abs(got[0] - 0.02777778) < 1e-9
    assert abs(ratio_from_measure(got) - 24.0) < 1e-3  # 1/2 in = 1 ft is a ratio of 24


def test_colour_key_and_tag_class() -> None:
    from tools.takeoff.colour_study import colour_key, tag_class

    assert colour_key((1, 0, 0.333)) == "1.00/0.00/0.33"
    assert colour_key(None) == "none"
    assert [tag_class(t) for t in ("B12", "12", "AB", "", "two words", "B-12", "#1")] == [
        "letters+digits",
        "digits",
        "letters",
        "none",
        "long",
        "letters+digits",
        "other",
    ]


def test_tag_study_pairs_symbols_with_nearest_tag(tmp_path: Path) -> None:
    from tools.takeoff.tag_study import page_study

    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    for i, x in enumerate((50, 200, 350)):
        page.add_polygon_annot([(x, 50), (x + 20, 50), (x + 10, 70)])
        page.add_freetext_annot(pymupdf.Rect(x, 75, x + 30, 90), f"B{i + 1}")
    page.add_polygon_annot([(500, 300), (520, 300), (510, 320)])  # no tag within the radius
    r = page_study(page, {})
    assert r["symbols"] == 4 and r["tagged"] == 3 and r["distinct_tags"] == 3
    assert sum(r["by_colour_shape_prefix"].values()) == 4


def test_workbook_helpers_and_bands() -> None:
    from tools.takeoff.m7_study import band as m7_band
    from tools.takeoff.target_workbook import band as wb_band
    from tools.takeoff.target_workbook import classify_name, norm_ref, num

    assert norm_ref("2 / s5-02") == "2S502"
    assert num("12.5") == 12.5 and num("") is None and num(None) is None
    assert wb_band(7, [5, 10, 1e18], ["<5", "5-10", "10+"]) == "5-10"
    assert wb_band(None, [5], ["<5"]) == "missing"
    assert classify_name("HSS8X4X1/2 beam") == "profile-like"
    assert classify_name("roof beam") == "other" and classify_name("") == "empty"
    assert [m7_band(r) for r in (0, 0.05, 0.2, 0.4, 0.9)] == [
        "equal",
        "<=10%",
        "<=25%",
        "<=50%",
        ">50%",
    ]


def test_v3_canonical_size_and_m7_counts() -> None:
    from tools.takeoff.m7_study import page_counts
    from tools.takeoff.v3_trace import canon

    assert canon("HSS", "8X4X1/2") == "HSS8X4X1/2"
    assert canon("WF", "12X26") == "W12X26"
    assert canon("ZZ", "1X1") is None

    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.insert_text((50, 60), "W12X26 BEAM LABEL AND SOME MORE TEXT FOR THE LAYER", fontsize=10)
    page.insert_text(
        (540, 60), "W10X30 TITLE BLOCK STRIP TEXT", fontsize=6
    )  # right strip: not counted
    page.add_polygon_annot(
        [(100, 100), (110, 100), (110, 110), (100, 110), (95, 105), (96, 101), (98, 99), (99, 100)]
    )
    page.add_polygon_annot([(200, 200), (220, 200), (210, 220)])
    r = page_counts(page)
    assert r is not None and r["text"] and r["n_sym"] == 2 and r["n_circle"] == 1
    assert r["n_lbl"] == 1 and r["n_lbl_W"] == 1


def test_kind_table_priority_and_prefix() -> None:
    from tools.takeoff.kind_study import kind_of
    from tools.takeoff.prefix_inventory import prefix_of

    assert kind_of("Roof BEAM at grid") == ("Beams", "main")
    assert kind_of("curved beam") == ("Curved Beam/Rolled Beam", "main")  # specific before general
    assert kind_of("Dock Stair frame") == ("Dock Stair", "misc")
    assert kind_of("wallrail") == ("Handrail/Wallrails", "misc")  # before "wall"
    assert kind_of("vertical brace")[0] == "Vertical Brace"
    assert kind_of("brace")[1] == "ambiguous"
    assert kind_of("floor joist") == ("Joist", "excluded")
    assert kind_of("") == ("unmapped", "unmapped") and kind_of("xyz") == ("unmapped", "unmapped")
    assert prefix_of("b12") == "B" and prefix_of("12") == "(none)" and prefix_of("CB3") == "CB"


def test_length_source_classes() -> None:
    from tools.takeoff.length_source import source_on_page

    lines = [("W12X26", 100.0), ("20'-0\"", 101.0), ("TYP 18'-6\" LONG", 300.0), ("12'-0\"", 500.0)]
    assert source_on_page(lines, 240.0) == "schedule"  # same row band as a profile text
    assert source_on_page(lines, 222.0) == "callout"
    assert source_on_page(lines, 144.0) == "plan dimension"
    assert source_on_page(lines, 999.0) is None
