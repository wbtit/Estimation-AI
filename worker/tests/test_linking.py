"""Line reconstruction, candidates, the frozen rule and structural-class suggestion (synthetic)."""

import math
import random
import sys
from pathlib import Path

import pymupdf
import pytest

from src.linking.candidates import candidates_for
from src.linking.labels import page_labels
from src.linking.lines import Line, class_key, page_lines, reconstruct, width_bucket
from src.linking.rules import propose
from src.linking.structural import class_table, lines_in_box, suggest_classes

STUDY = Path(__file__).resolve().parents[1] / "tools" / "study"
sys.path.insert(0, str(STUDY))
import candidates as study_cand  # noqa: E402
import rules as study_rules  # noqa: E402


def seg(x0, y0, x1, y1, w=1.0, col="black"):
    return (x0, y0, x1, y1, w, col)


def ln(x0, y0, x1, y1, w=2.0, col="black", dashed=False) -> Line:
    return Line(x0, y0, x1, y1, w, col, dashed, 1)


# --- lines -------------------------------------------------------------------------------------
def test_touching_collinear_segments_merge_and_a_gap_keeps_two_lines() -> None:
    assert sorted(
        round(x.length) for x in reconstruct([seg(0, 0, 50, 0), seg(50.4, 0, 120, 0)])
    ) == [120]
    assert len(reconstruct([seg(0, 0, 50, 0), seg(60, 0, 120, 0)])) == 2
    assert len(reconstruct([seg(0, 0, 50, 0, 1.0), seg(50, 0, 100, 0, 2.0)])) == 2  # styles differ


def test_exploded_dashes_become_one_dashed_line() -> None:
    lines = reconstruct([seg(k * 12, 5, k * 12 + 8, 5, 0.3) for k in range(10)])
    assert len(lines) == 1 and lines[0].dashed and lines[0].n_src == 10
    assert abs(lines[0].length - 116) < 1 and lines[0].klass == "0.25-0.5|black|dash"


def test_class_keys_and_buckets() -> None:
    assert (
        width_bucket(0.05) == "<0.1"
        and width_bucket(2.0) == "1.5-2.5"
        and width_bucket(3) == ">2.5"
    )
    assert class_key(2.0, "black", False) == "1.5-2.5|black|solid"


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_lines_are_in_displayed_coordinates_on_rotated_pages(rotation: int) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.set_rotation(rotation)
    inv = ~page.rotation_matrix
    # a horizontal line of 200 pt drawn at displayed (50, 60) to (250, 60)
    page.draw_line(pymupdf.Point(50, 60) * inv, pymupdf.Point(250, 60) * inv, width=2)
    (line,) = page_lines(page)
    assert abs(line.y0 - 60) < 0.01 and abs(line.y1 - 60) < 0.01
    assert abs(abs(line.x1 - line.x0) - 200) < 0.01 and min(line.x0, line.x1) == pytest.approx(
        50, abs=0.01
    )


# --- candidates and the frozen rule ----------------------------------------------------------
def test_candidates_are_the_nearest_lines_within_the_radius() -> None:
    lines = [ln(0, 130, 300, 130), ln(0, 80, 300, 80), ln(120, 0, 120, 300), ln(0, 900, 300, 900)]
    got = candidates_for((100.0, 100.0, 140.0, 110.0), 0.0, lines)
    assert [c.cand for c in got] == [1, 2, 3] and len(got) == 3  # the far line is out of radius
    assert got[0].dist == 0.0 and got[0].rel_angle == pytest.approx(
        90.0
    )  # the touching vertical line


def test_short_lines_are_not_candidates() -> None:
    assert candidates_for((100, 100, 140, 110), 0.0, [ln(100, 120, 108, 120)]) == []


def test_rule_confidence_classes() -> None:
    far = ln(0, 200, 300, 200)
    near = ln(0, 118, 300, 118)
    # one aligned candidate: high
    assert propose(candidates_for((100, 100, 140, 110), 0.0, [near])).confidence == "high"
    # two aligned lines 2 pt apart in score: low
    assert (
        propose(candidates_for((100, 100, 140, 110), 0.0, [near, ln(0, 120, 300, 120)])).confidence
        == "low"
    )
    # best aligned at 8 pt, the second 30 pt further: medium (margin 30 < 40)
    assert (
        propose(candidates_for((100, 100, 140, 110), 0.0, [near, ln(0, 148, 300, 148)])).confidence
        == "medium"
    )
    # margin >= 40: high
    assert propose(candidates_for((100, 100, 140, 110), 0.0, [near, far])).confidence == "high"
    # no candidates: low, no best
    p = propose([])
    assert (p.confidence, p.best, p.margin) == ("low", None, None)


def test_a_parallel_line_beats_a_nearer_crossing_line() -> None:
    crossing = ln(120, 0, 120, 300)  # touches the label, perpendicular to the text
    parallel = ln(0, 125, 300, 125)  # 15 pt below, aligned
    p = propose(candidates_for((100, 100, 140, 110), 0.0, [crossing, parallel]))
    assert p.best.candidate.line is parallel and p.best.score == pytest.approx(15.0)


def test_parity_with_the_study_implementation() -> None:
    """The production rule must give the same ranking and confidence as the frozen study rule."""
    rng = random.Random(7)
    params = study_rules.Params(theta_tol=5.0, p_ang=20.0)
    checked = 0
    for _ in range(200):
        lines = []
        for _ in range(rng.randint(1, 8)):
            x, y = rng.uniform(0, 400), rng.uniform(0, 300)
            a = math.radians(rng.choice([0, 0, 90, 90, rng.uniform(0, 180)]))
            length = rng.uniform(20, 200)
            lines.append(ln(x, y, x + length * math.cos(a), y + length * math.sin(a)))
        x0, y0 = rng.uniform(50, 350), rng.uniform(50, 250)
        bbox = (x0, y0, x0 + 40, y0 + 8)
        angle = rng.choice([0.0, 90.0])
        mine = propose(candidates_for(bbox, angle, lines))
        sl = [
            {"p": (m.x0, m.y0), "q": (m.x1, m.y1), "klass": "k", "dashed": False, "layer": "",
             "width": 2.0, "length": m.length}
            for m in lines
        ]  # fmt: skip
        theirs = study_cand.candidates_for({"bbox": list(bbox), "angle_deg": angle}, sl)
        if not theirs:
            assert mine.best is None
            continue
        _, order, info = study_rules.predict(theirs, {}, params)
        assert [r.candidate.cand for r in mine.ranked][:3] == order[:3]
        assert mine.confidence == study_rules.confidence(info, 5.0, 40.0)
        checked += 1
    assert checked > 100


# --- structural classes --------------------------------------------------------------------------
def test_the_heaviest_solid_class_with_enough_lines_is_suggested() -> None:
    lines = (
        [ln(0, 20 * k, 200, 20 * k, 2.0) for k in range(10)]  # 10 heavy beams
        + [ln(0, 5 + 20 * k, 200, 5 + 20 * k, 0.3) for k in range(40)]  # lots of thin lines
        + [
            ln(0, 8 + 20 * k, 200, 8 + 20 * k, 2.0, col="grey") for k in range(12)
        ]  # grey heavy: not structural
        + [ln(0, 3, 200, 3, 3.0)]  # one very heavy line: not enough lines
    )
    table = class_table(lines)
    assert suggest_classes(table) == ["1.5-2.5|black|solid"]
    assert suggest_classes([]) == []
    assert suggest_classes(class_table([ln(0, 0, 100, 0, 2.0, dashed=True)] * 20)) == []


def test_the_sheet_border_and_lines_outside_the_box_are_ignored() -> None:
    lines = [ln(10, 10, 990, 10), ln(100, 100, 200, 100), ln(700, 700, 800, 700)]
    got = lines_in_box(lines, (50, 50, 300, 300), (1000, 800))
    assert [round(g.x0) for g in got] == [100]


# --- labels --------------------------------------------------------------------------
def test_profile_and_mark_labels_with_boxes_and_exclusions() -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=3000, height=2000)
    page.insert_text((300, 300), "(2) W12x26 BEAM", fontsize=10)
    page.insert_text((300, 400), "B1", fontsize=10)
    page.insert_text((300, 500), "B9", fontsize=10)  # a mark with no legend row: not a label
    page.insert_text((2800, 300), "W8x10", fontsize=10)  # title strip
    note = " ".join(["WORD"] * 14) + " W16x26"  # running text, not a label
    page.insert_text((300, 600), note, fontsize=10)
    page.insert_text((300, 700), "SIDE W14x30", fontsize=10, rotate=90)
    got = page_labels(page, "sheet-1", {"B1"})
    kinds = sorted((g.kind, g.text) for g in got)
    assert kinds == [("mark", "B1"), ("profile", "W12x26"), ("profile", "W14x30")]
    by = {g.text: g for g in got}
    assert by["W12x26"].quantity_prefix and by["W12x26"].angle_deg == 0.0
    assert by["W14x30"].angle_deg == 90.0 and by["W12x26"].canonical == "W12X26"
    assert by["B1"].bbox[2] > by["B1"].bbox[0]
    assert len({g.key for g in got}) == 3 and all(len(g.key) == 64 for g in got)
