"""Synthetic PDFs for the Phase 7 grammar rules v1 (no drawings, no private data)."""

from __future__ import annotations

import collections
import math

import numpy as np
import pymupdf

from tools.takeoff import phase7_grammar as G
from tools.takeoff import phase7_parse as P

BOX = (0.0, 0.0, 800.0, 600.0)


def _page(w=800, h=600):
    doc = pymupdf.open()
    return doc, doc.new_page(width=w, height=h)


def _line(page, a, b, width=1.0, dashes=None, color=(0, 0, 0)):
    s = page.new_shape()
    s.draw_line(a, b)
    s.finish(width=width, color=color, dashes=dashes, closePath=False)
    s.commit()


def _square(page, x, y, size=10.0, fill=True):
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(x, y, x + size, y + size))
    s.finish(fill=(0, 0, 0) if fill else None, color=None if fill else (0, 0, 0), width=0.5)
    s.commit()


def _bubble(page, cx, cy, text, r=12.0):
    s = page.new_shape()
    s.draw_circle((cx, cy), r)
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    page.insert_text((cx - 3, cy + 3), text, fontsize=9)


def _run(page, doc=None):
    parse = P.parse_page(page, doc)
    return G.run_page(parse, G.words_of(page), BOX), parse


# ---- roles ----------------------------------------
def test_roles_follow_the_pages_own_width_histogram():
    doc, page = _page()
    for k in range(6):  # 600 pt of thin lines
        _line(page, (50, 40 + 30 * k), (150, 40 + 30 * k), width=0.25)
    for k in range(2):  # 200 pt of medium
        _line(page, (300, 40 + 30 * k), (400, 40 + 30 * k), width=0.7)
    _line(page, (500, 40), (560, 40), width=2.0)  # 60 pt of heavy
    parse = P.parse_page(page)
    roles, hatch = G.assign_roles(parse, BOX)
    by_w = {round(float(w), 2): G.ROLE_NAMES[r] for w, r in zip(parse.seg_w, roles, strict=True)}
    assert by_w[0.25] == "thin" and by_w[0.7] == "medium" and by_w[2.0] == "heavy"
    assert not hatch.any()


def test_a_page_with_one_width_is_all_thin_and_short_pieces_are_hatch():
    doc, page = _page()
    _line(page, (50, 50), (250, 50), width=1.0)
    _line(page, (50, 80), (58, 80), width=1.0)  # 8 pt: shorter than 12
    parse = P.parse_page(page)
    roles, _ = G.assign_roles(parse, BOX)
    names = sorted(G.ROLE_NAMES[r] for r in roles)
    assert names == ["hatch", "thin"]


def test_parallel_short_lines_are_hatch_and_dashed_is_kept_as_a_flag():
    doc, page = _page()
    for k in range(8):
        _line(page, (100, 100 + 3 * k), (140, 100 + 3 * k), width=0.1)
    _line(page, (300, 100), (500, 100), width=0.5, dashes="[6 3] 0")
    parse = P.parse_page(page)
    roles, hatch = G.assign_roles(parse, BOX)
    assert hatch[:8].all()
    assert roles[8] == G.THIN and parse.seg_dashed[8]


# ---- chains ----------------------------------------
def test_collinear_segments_chain_across_a_small_gap_but_not_a_large_one():
    doc, page = _page()
    _line(page, (50, 100), (150, 100))
    _line(page, (155, 100), (255, 100))  # 5 pt gap: joined
    _line(page, (300, 100), (400, 100))  # 45 pt gap: separate
    parse = P.parse_page(page)
    chains = G.chain_segments(parse.seg, [0, 1, 2], G.CHAIN_GAP)
    sizes = sorted(len(c[0]) for c in chains)
    assert sizes == [1, 2]
    two = next(c for c in chains if len(c[0]) == 2)
    xs = sorted([two[1][0], two[2][0]])  # the end order along the chain is arbitrary
    assert abs(xs[0] - 50) < 1e-6 and abs(xs[1] - 255) < 1e-6


def test_horizontal_lines_do_not_wrap_at_the_angle_cut():
    doc, page = _page()
    # a segment drawn right to left and one left to right on the same line
    _line(page, (200, 300), (100, 300))
    _line(page, (205, 300), (300, 300))
    parse = P.parse_page(page)
    chains = G.chain_segments(parse.seg, [0, 1], G.CHAIN_GAP)
    assert len(chains) == 1 and len(chains[0][0]) == 2


def test_offset_beyond_one_point_is_not_collinear():
    doc, page = _page()
    _line(page, (50, 100), (150, 100))
    _line(page, (155, 103), (255, 103))
    parse = P.parse_page(page)
    assert len(G.chain_segments(parse.seg, [0, 1], G.CHAIN_GAP)) == 2


# ---- bubbles and grids ----------------------------------------
def _grid_page():
    doc, page = _page()
    _bubble(page, 100, 40, "1")
    _bubble(page, 400, 40, "2")
    _bubble(page, 30, 200, "A")
    _bubble(page, 30, 450, "B")
    for x in (100, 400):  # vertical grid lines, dash-dot, from the bubble down
        _line(page, (x, 52), (x, 560), width=0.3, dashes="[20 4 2 4] 0")
    for y in (200, 450):
        _line(page, (42, y), (700, y), width=0.3, dashes="[20 4 2 4] 0")
    return doc, page


def test_grid_lines_are_anchored_by_bubbles_and_families_come_from_the_label():
    doc, page = _grid_page()
    pp, _ = _run(page, doc)
    assert len(pp.bubbles) == 4
    fam = {b["label"]: b["family"] for b in pp.bubbles}
    assert fam == {"1": "N", "2": "N", "A": "A", "B": "A"}
    assert len(pp.grid_lines) == 4
    assert len(pp.intersections) == 4 and pp.has_grid
    xs = sorted({round(p[0]) for p in pp.intersections})
    assert xs == [100, 400]


def test_family_is_the_label_content_in_any_script():
    assert G.family_of("12") == "N"
    assert G.family_of("A") == "A"
    assert G.family_of("Б") == "A"  # Cyrillic letter
    assert G.family_of("٣") == "N"  # Arabic-indic digit three
    assert G.family_of("A1") == "A"


def test_bubbles_with_non_latin_text_are_found_from_given_words():
    doc, page = _page()
    s = page.new_shape()
    s.draw_circle((100, 100), 12)
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    parse = P.parse_page(page)
    words = [G.Word("Б", (96, 96, 104, 104))]
    b = G.find_bubbles(parse, words, BOX)
    assert len(b) == 1 and b[0]["family"] == "A"
    assert G.find_bubbles(parse, [], BOX) == []  # a circle with no text is not a bubble
    long_text = [G.Word("ABC", (92, 96, 108, 104))]
    assert G.find_bubbles(parse, long_text, BOX) == []  # more than two characters


# ---- glyphs ----------------------------------------
def test_glyph_near_a_grid_intersection_is_main_and_one_elsewhere_is_flagged_off_grid():
    doc, page = _grid_page()
    _square(page, 95, 195)  # centred on (100, 200)
    _square(page, 250, 300)  # nowhere near an intersection
    pp, _ = _run(page, doc)
    assert pp.has_grid
    near = next(
        g for g in pp.glyphs if abs(g["centre"][0] - 100) < 3 and abs(g["centre"][1] - 200) < 3
    )
    far = next(g for g in pp.glyphs if abs(g["centre"][0] - 255) < 3)
    assert near["at_grid"] and near["main"]
    assert not far["at_grid"] and not far["main"]
    assert near["signature"] == [1.0] * 8
    assert far in pp.glyphs  # kept, only flagged
    assert near in pp.main_glyphs() and far not in pp.main_glyphs()


def test_on_a_page_without_a_grid_a_glyph_is_main_only_where_three_main_span_ends_meet():
    doc, page = _page()
    _line(page, (100, 105), (400, 105), width=2.0)  # a heavy beam from the first column ...
    _line(page, (400, 105), (400, 300), width=2.0)  # ... to a second one, and a corner member
    _line(page, (400, 105), (700, 105), width=2.0)  # and a third member on the same corner
    for k in range(5):  # thin bulk so that 2.0 is the heavy role
        _line(page, (50, 500 + 10 * k), (750, 500 + 10 * k), width=0.25)
    _square(page, 95, 100)
    _square(page, 395, 100)  # two heavy span ends meet here
    _square(page, 395, 295)  # the corner member's other end
    _square(page, 695, 100)  # the third member's other end
    _square(page, 600, 300)  # a glyph nobody frames into
    pp, _ = _run(page, doc)
    assert not pp.has_grid
    by_x = {round(g["centre"][0]): g for g in pp.glyphs}
    tops = [g for g in pp.glyphs if abs(g["centre"][0] - 400) < 3 and g["centre"][1] < 200]
    assert len(tops) == 1 and tops[0]["meets"] == 3 and tops[0]["main"]
    assert by_x[100]["meets"] == 1 and not by_x[100]["main"]
    assert by_x[605]["meets"] == 0 and not by_x[605]["main"]
    assert len(pp.glyphs) == 5  # all kept


def test_outline_and_fill_of_one_column_are_one_glyph_and_big_shapes_are_not_glyphs():
    doc, page = _page()
    _square(page, 100, 100, 10, fill=True)
    _square(page, 99, 99, 12, fill=False)  # the outline drawn a little larger than the fill
    _square(page, 300, 300, 60, fill=False)  # 60 pt: a room, not a column
    pp, _ = _run(page, doc)
    assert len(pp.glyphs) == 1 and len(pp.glyphs[0]["shape_ids"]) == 2


def test_an_h_shaped_glyph_has_a_width_profile_that_is_not_a_box():
    pts = [
        (0, 0),
        (10, 0),
        (10, 3),
        (6, 3),
        (6, 7),
        (10, 7),
        (10, 10),
        (0, 10),
        (0, 7),
        (4, 7),
        (4, 3),
        (0, 3),
    ]
    prof = G.width_profile(pts, (0, 0, 10, 10))
    assert len(prof) == 8
    assert prof[0] == 1.0 and prof[-1] == 1.0
    assert min(prof[3], prof[4]) < 0.5  # the web is narrow


# ---- consumed before chaining ----------------------------------------
def test_x_and_v_brace_signs_are_consumed_and_not_chained():
    doc, page = _page()
    _line(page, (100, 100), (220, 220), width=0.7)  # X
    _line(page, (220, 100), (100, 220), width=0.7)
    _line(page, (400, 100), (460, 220), width=0.7)  # V: apex at the bottom, tops on one line
    _line(page, (520, 100), (460, 220), width=0.7)
    _line(page, (50, 400), (350, 400), width=0.7)  # an ordinary member stays
    pp, parse = _run(page, doc)
    kinds = sorted(b["kind"] for b in pp.braces)
    assert kinds == ["V", "X"]
    consumed = pp.consumed_segs["brace_sign"]
    assert len(consumed) == 4
    assert all(i not in consumed for sp in pp.spans for i in sp["segs"])
    assert any(abs(sp["p0"][1] - 400) < 1 for sp in pp.spans)


def test_a_dimension_line_with_ticks_and_a_number_is_consumed():
    doc, page = _page()
    _line(page, (100, 300), (300, 300), width=0.2)  # the dimension line (thin)
    _line(page, (97.5, 302.5), (102.5, 297.5), width=0.2)  # 45 degree ticks (7 pt) at both ends
    _line(page, (297.5, 302.5), (302.5, 297.5), width=0.2)
    page.insert_text((180, 296), "12'-6\"", fontsize=8)
    _line(page, (100, 500), (300, 500), width=0.2)  # same geometry but no ticks and no text
    # heavier lines so the dimension line is thin by the page histogram
    _line(page, (50, 100), (750, 100), width=1.5)
    _line(page, (50, 130), (750, 130), width=1.5)
    pp, parse = _run(page, doc)
    dim = pp.consumed_segs["dimension"]
    assert 0 in dim and 1 in dim and 2 in dim
    assert 3 not in dim
    assert all(i not in dim for sp in pp.spans for i in sp["segs"])


# ---- members, supports, spans ----------------------------------------
def test_a_beam_between_two_columns_is_one_supported_span():
    doc, page = _page()
    _line(page, (100, 300), (500, 300), width=1.0)
    _square(page, 90, 295)
    _square(page, 495, 295)
    pp, _ = _run(page, doc)
    spans = [s for s in pp.spans if abs(s["p0"][1] - 300) < 1]
    assert len(spans) == 1
    sp = spans[0]
    assert [s["type"] for s in sp["supports"]] == ["column", "column"] and sp["n_supports"] == 2
    # one width on the page: only the thin role, so the default main total (medium+) is empty
    assert pp.main_spans() == []
    assert sp in pp.main_spans(min_supports=2, min_role=G.THIN)


def test_a_chain_is_split_at_a_column_in_the_middle():
    doc, page = _page()
    _line(page, (100, 300), (500, 300), width=1.0)
    _square(page, 95, 295)
    _square(page, 295, 295)  # in the middle
    _square(page, 495, 295)
    pp, _ = _run(page, doc)
    spans = sorted((s for s in pp.spans if abs(s["p0"][1] - 300) < 1), key=lambda s: s["p0"][0])
    assert len(spans) == 2
    assert all(s["n_supports"] == 2 for s in spans)
    cuts = sorted(
        round(x) for s in spans for x in (s["p0"][0], s["p1"][0]) if 150 < x < 450
    )  # the cut appears once in each of the two spans (the order of the ends is arbitrary)
    assert cuts == [300, 300]


def test_a_beam_framing_into_a_girder_is_split_at_the_t_and_supported_by_the_member():
    doc, page = _page()
    _line(page, (100, 100), (100, 500), width=2.0)  # girder (heavy)
    _line(page, (100, 300), (400, 300), width=1.0)  # beam ending on the girder
    _line(page, (50, 520), (750, 520), width=0.25)  # something thin so the roles differ
    pp, _ = _run(page, doc)
    beam = [s for s in pp.spans if abs(s["p0"][1] - 300) < 1 and abs(s["p1"][1] - 300) < 1]
    assert len(beam) == 1
    sup = beam[0]["supports"]
    types = sorted(str(x["type"]) if x else "none" for x in sup)
    assert types == ["member", "none"]  # the girder at one end, nothing at the other
    assert beam[0]["n_supports"] == 1


def test_a_span_with_no_support_is_kept_flagged_and_left_out_of_the_main_total():
    doc, page = _page()
    _line(page, (100, 300), (500, 300), width=1.0)  # nothing at either end
    pp, _ = _run(page, doc)
    assert len(pp.spans) == 1
    assert pp.spans[0]["n_supports"] == 0
    assert pp.main_spans() == [] and pp.main_spans(1, G.THIN) == []
    G.check_evidence(pp)


def test_every_piece_has_evidence():
    doc, page = _grid_page()
    _square(page, 95, 195)
    _line(page, (100, 200), (400, 200), width=1.0)
    pp, _ = _run(page, doc)
    G.check_evidence(pp)
    assert all(s["segs"] for s in pp.spans)
    assert all(g["shape_ids"] for g in pp.glyphs)


def test_the_label_is_evidence_only():
    doc, page = _page()
    _line(page, (100, 300), (500, 300), width=1.0)
    _square(page, 90, 295)
    parse = P.parse_page(page)
    labels = [("L1", (250.0, 285.0, 280.0, 295.0)), ("far", (250.0, 100.0, 280.0, 110.0))]
    with_labels = G.run_page(parse, [], BOX, labels)
    without = G.run_page(parse, [], BOX, None)
    assert with_labels.spans[0]["label"] == "L1"
    assert without.spans[0]["label"] is None
    assert len(with_labels.main_spans(1, G.THIN)) == len(without.main_spans(1, G.THIN)) == 1


def test_hatch_is_not_chained_into_members():
    doc, page = _page()
    for k in range(8):
        _line(page, (100, 100 + 3 * k), (180, 100 + 3 * k), width=0.1)
    pp, _ = _run(page, doc)
    assert pp.spans == []


def test_a_form_xobject_member_is_found_in_page_coordinates():
    src = pymupdf.open()
    sp = src.new_page(width=200, height=100)
    _line(sp, (0, 50), (200, 50), width=1.0)
    doc, page = _page()
    page.show_pdf_page(pymupdf.Rect(100, 300, 500, 500), src, 0)  # scaled by 2
    pp, parse = _run(page, doc)
    assert parse.prims and parse.prims[0].in_form
    assert len(pp.spans) == 1
    assert abs(pp.spans[0]["p0"][1] - 400) < 1 and abs(pp.spans[0]["length"] - 400) < 1


def test_run_is_deterministic():
    doc, page = _grid_page()
    _square(page, 95, 195)
    _line(page, (100, 200), (400, 200), width=1.0)
    a, _ = _run(page, doc)
    b, _ = _run(page, doc)
    assert [(s["p0"], s["p1"], s["n_supports"]) for s in a.spans] == [
        (s["p0"], s["p1"], s["n_supports"]) for s in b.spans
    ]
    assert np.array_equal(a.roles, b.roles)


# ---- the vectorised hatch rule equals the first (cell grid) implementation ----------------
def _hatch_reference(seg: np.ndarray, length: np.ndarray, inside: np.ndarray) -> np.ndarray:
    """A segment with at least G.HATCH_N other near-parallel segments of similar length at small
    perpendicular offsets that overlap it along its direction by at least half (core), plus one
    propagation pass: a segment with such a neighbour that is itself core hatch (the edge lines of
    a stack). Erratum 1 of the pre-registration (before any real drawing was parsed)."""
    n = len(seg)
    out = np.zeros(n, dtype=bool)
    if n < G.HATCH_N + 1:
        return out
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180.0
    mid = G._mid(seg)
    cell = 24.0
    grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    cand = [i for i in range(n) if inside[i] and 0.5 < length[i] < 400.0]
    for i in cand:
        grid[(int(mid[i, 0] // cell), int(mid[i, 1] // cell))].append(i)
    ux = np.cos(np.radians(ang))
    uy = np.sin(np.radians(ang))
    neighbours: dict[int, list[int]] = {}
    for i in cand:
        cx, cy = int(mid[i, 0] // cell), int(mid[i, 1] // cell)
        found: list[int] = []
        reach = int(max(1, math.ceil((length[i] / 2 + G.HATCH_OFFSET) / cell)))
        for gx in range(cx - reach, cx + reach + 1):
            for gy in range(cy - reach, cy + reach + 1):
                for j in grid.get((gx, gy), ()):
                    if j == i:
                        continue
                    if G.angle_diff_deg(ang[i], ang[j]) > G.HATCH_ANGLE:
                        continue
                    if abs(length[j] - length[i]) > G.HATCH_RATIO * length[i]:
                        continue
                    dx, dy = mid[j, 0] - mid[i, 0], mid[j, 1] - mid[i, 1]
                    along = dx * ux[i] + dy * uy[i]
                    perp = -dx * uy[i] + dy * ux[i]
                    if abs(perp) > G.HATCH_OFFSET or abs(perp) < 0.2:
                        continue
                    if 1.0 - abs(along) / max(length[i], 1e-9) < G.HATCH_OVERLAP:
                        continue
                    found.append(j)
        neighbours[i] = found
        out[i] = len(found) >= G.HATCH_N
    core = out.copy()
    for i, found in neighbours.items():
        if not core[i] and any(core[j] for j in found):
            out[i] = True
    return out


def _scene(seed):
    rng = np.random.default_rng(seed)
    segs = []
    for _ in range(25):  # stacks of parallel lines (hatch) at random angles
        cx, cy = rng.uniform(100, 700, 2)
        ang = rng.uniform(0, math.pi)
        ln = rng.uniform(10, 60)
        n = int(rng.integers(5, 15))
        gap = rng.uniform(1.0, 3.0)
        for k in range(n):
            ox = -math.sin(ang) * gap * k
            oy = math.cos(ang) * gap * k
            segs.append(
                [
                    cx + ox - math.cos(ang) * ln / 2,
                    cy + oy - math.sin(ang) * ln / 2,
                    cx + ox + math.cos(ang) * ln / 2,
                    cy + oy + math.sin(ang) * ln / 2,
                ]
            )
    for _ in range(150):  # loose lines, some axis aligned
        x, y = rng.uniform(0, 800, 2)
        a = rng.choice([0.0, math.pi / 2, rng.uniform(0, math.pi)])
        ln = rng.uniform(5, 300)
        segs.append([x, y, x + math.cos(a) * ln, y + math.sin(a) * ln])
    return np.array(segs)


def test_vectorised_hatch_mask_equals_the_reference_implementation():
    for seed in range(6):
        seg = _scene(seed)
        length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
        inside = np.ones(len(seg), dtype=bool)
        inside[::17] = False
        new = G.hatch_mask(seg, length, inside)
        ref = _hatch_reference(seg, length, inside)
        assert np.array_equal(new, ref), seed
        assert new.sum() > 20  # the scene really has hatch


def test_r1_main_spans_need_both_ends_and_a_medium_or_heavy_role():
    doc, page = _page()
    for k in range(6):
        _line(page, (50, 520 + 10 * k), (250, 520 + 10 * k), width=0.25)  # the thin bulk
    _line(page, (100, 300), (500, 300), width=1.0)  # medium, columns at both ends
    _square(page, 90, 295)
    _square(page, 495, 295)
    _line(page, (100, 400), (500, 400), width=0.25)  # thin, columns at both ends
    _square(page, 90, 395)
    _square(page, 495, 395)
    _line(page, (100, 450), (500, 450), width=1.0)  # medium, column at one end only
    _square(page, 90, 445)
    pp, _ = _run(page, doc)
    at = lambda y: [s for s in pp.spans if abs(s["p0"][1] - y) < 1 and abs(s["p1"][1] - y) < 1]  # noqa: E731
    assert at(300)[0] in pp.main_spans()
    assert at(400)[0] not in pp.main_spans() and at(400)[0] in pp.main_spans(2, G.THIN)
    assert at(450)[0] not in pp.main_spans() and at(450)[0] in pp.main_spans(1, G.THIN)
    assert all(s in pp.spans for s in (at(400)[0], at(450)[0]))  # kept, only flagged


def test_r3_side_by_side_main_spans_are_one_piece_the_other_is_flagged_not_deleted():
    doc, page = _page()
    for k in range(6):
        _line(page, (50, 520 + 10 * k), (250, 520 + 10 * k), width=0.25)  # the thin bulk
    _line(page, (100, 300), (500, 300), width=1.0)  # a beam drawn with two flange lines
    _line(page, (100, 306), (500, 306), width=1.0)
    _square(page, 88, 298, 12)
    _square(page, 500, 298, 12)
    _line(page, (100, 400), (500, 400), width=1.0)  # another beam far away stays its own piece
    _square(page, 88, 394, 12)
    _square(page, 500, 394, 12)
    pp, _ = _run(page, doc)
    near = [s for s in pp.spans if 295 < s["p0"][1] < 310 and 295 < s["p1"][1] < 310]
    assert len(near) == 2
    kept = [s for s in near if s["merged_into"] is None]
    merged = [s for s in near if s["merged_into"] is not None]
    assert len(kept) == 1 and len(merged) == 1
    assert kept[0] in pp.main_spans() and merged[0] not in pp.main_spans()
    assert merged[0] in pp.spans  # kept in the output, only flagged
    far = [s for s in pp.spans if abs(s["p0"][1] - 400) < 1]
    assert len(far) == 1 and far[0] in pp.main_spans()
    G.check_evidence(pp)
