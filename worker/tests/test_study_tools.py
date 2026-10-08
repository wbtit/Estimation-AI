"""Phase 4e study tools on synthetic data (no real drawings): lines, candidates, rules, scoring."""

import sys
from contextlib import contextmanager
from pathlib import Path

import pymupdf

STUDY = Path(__file__).resolve().parents[1] / "tools" / "study"
sys.path.insert(0, str(STUDY))
import candidates as cand  # noqa: E402
import columns  # noqa: E402
import common  # noqa: E402
import labels  # noqa: E402
import leaders  # noqa: E402
import linework  # noqa: E402
import rules  # noqa: E402
import score  # noqa: E402

BLACK = "black"


def seg(x0, y0, x1, y1, w=1.0):
    return (x0, y0, x1, y1, w, BLACK, "")


# --- linework ----------------------------------------------------------------------------------
def test_touching_collinear_segments_merge_into_one_line() -> None:
    lines, _ = linework.reconstruct([seg(0, 0, 50, 0), seg(50.4, 0, 120, 0), seg(0, 30, 80, 30)])
    lengths = sorted(round(ln.length) for ln in lines)
    assert lengths == [80, 120]


def test_a_gap_larger_than_the_tolerance_keeps_two_lines() -> None:
    lines, _ = linework.reconstruct([seg(0, 0, 50, 0), seg(60, 0, 120, 0)])
    assert len(lines) == 2


def test_different_styles_never_merge() -> None:
    lines, _ = linework.reconstruct([seg(0, 0, 50, 0, 1.0), seg(50, 0, 100, 0, 2.0)])
    assert len(lines) == 2


def test_exploded_dashes_become_one_dashed_line() -> None:
    dashes = [seg(k * 12, 5, k * 12 + 8, 5, 0.3) for k in range(10)]
    lines, stats = linework.reconstruct(dashes)
    assert stats["dash_chains"] == 1 and len(lines) == 1
    assert lines[0].dashed and lines[0].n_src == 10 and abs(lines[0].length - 116) < 1


def test_diagonal_collinear_segments_merge() -> None:
    lines, _ = linework.reconstruct([seg(0, 0, 30, 30), seg(30, 30, 60, 60)])
    assert len(lines) == 1 and abs(lines[0].length - 84.85) < 0.2


def test_page_segments_reads_paths_from_a_rotated_page() -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.set_rotation(90)
    inv = ~page.rotation_matrix
    page.draw_line(pymupdf.Point(50, 50) * inv, pymupdf.Point(250, 50) * inv, width=2)
    segs, _ = linework.page_segments(page)
    ((x0, y0, x1, y1, w, _, _),) = segs
    assert abs(abs(x1 - x0) - 200) < 0.1 and abs(y1 - y0) < 0.1 and w == 2


def test_closed_small_shapes_are_collected() -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.draw_rect(pymupdf.Rect(100, 100, 112, 112), width=1)
    _, shapes = linework.page_segments(page)
    assert len(shapes) == 1 and abs(shapes[0]["bbox"][2] - shapes[0]["bbox"][0] - 12) < 0.1


# --- candidates ----------------------------------------------------------------------------------
def line(p, q, klass="1.5-2.5|black|solid"):
    import math

    return {"p": p, "q": q, "klass": klass, "dashed": False, "layer": "", "width": 2.0,
            "length": math.hypot(q[0] - p[0], q[1] - p[1])}  # fmt: skip


def test_candidates_are_the_nearest_lines_with_angle_and_side() -> None:
    label = {"bbox": [100.0, 100.0, 140.0, 110.0], "angle_deg": 0.0}
    below = line((0, 130), (300, 130))  # label sits above this line
    above = line((0, 80), (300, 80))  # label sits below this one
    vertical = line((120, 0), (120, 300))
    far = line((0, 900), (300, 900))
    got = cand.candidates_for(label, [far, vertical, above, below])
    assert [c["dist"] for c in got] == sorted(c["dist"] for c in got)
    by_dist = {c["dist"]: c for c in got}
    assert len(got) == 3  # the far line is outside the radius
    below_c = next(c for c in got if c["p"] == [0.0, 130.0])
    above_c = next(c for c in got if c["p"] == [0.0, 80.0])
    vert_c = next(c for c in got if c["p"] == [120.0, 0.0])
    assert below_c["side"] == 1 and above_c["side"] == -1  # +1: label above the line
    assert below_c["rel_angle"] == 0.0 and vert_c["rel_angle"] == 90.0
    assert vert_c["dist"] == 0.0 and vert_c["side"] == 0  # the label touches it
    assert by_dist


def test_rotated_text_uses_its_own_baseline() -> None:
    label = {"bbox": [100.0, 100.0, 110.0, 140.0], "angle_deg": 90.0}  # reads upward
    vertical = line((130, 0), (130, 300))
    horizontal = line((0, 160), (300, 160))
    got = {c["p"][0]: c for c in cand.candidates_for(label, [vertical, horizontal])}
    assert got[130.0]["rel_angle"] == 0.0 and got[0.0]["rel_angle"] == 90.0


# --- rules ---------------------------------------------------------------------------------------
def cands():
    return [
        {"cand": 1, "dist": 6.0, "rel_angle": 90.0, "side": 0},  # nearest, but across the text
        {"cand": 2, "dist": 12.0, "rel_angle": 0.0, "side": 1},
        {"cand": 3, "dist": 14.0, "rel_angle": 0.0, "side": -1},
    ]


def test_baseline_is_the_nearest_line() -> None:
    pred, order, _ = rules.predict(cands(), {}, rules.BASELINE)
    assert pred == ("line", 1) and order == [1, 2, 3]


def test_the_angle_penalty_prefers_a_parallel_line() -> None:
    p = rules.Params(theta_tol=10.0, p_ang=20.0)
    pred, order, info = rules.predict(cands(), {}, p)
    assert pred == ("line", 2) and order == [2, 3, 1] and info["aligned_top"]


def test_the_side_preference_picks_the_learned_side() -> None:
    p = rules.Params(theta_tol=10.0, p_ang=20.0, side_mode="learned", p_side=10.0)
    assert rules.predict(cands(), {}, p, preferred_side=-1)[0] == ("line", 3)
    assert rules.predict(cands(), {}, p, preferred_side=1)[0] == ("line", 2)
    assert rules.predict(cands(), {}, p, preferred_side=None)[0] == ("line", 2)  # nothing learned


def test_group_note_overrides_and_a_leader_overrides_the_ranking() -> None:
    g = rules.Params(group_notes=True)
    assert rules.predict(cands(), {"group_note_in_line": True}, g)[0] == ("group", None)
    assert rules.predict(cands(), {"group_note_in_line": False}, g)[0] == ("line", 1)
    ld = rules.Params(leader=True)
    pred, order, info = rules.predict(cands(), {}, ld, leader_target=3)
    assert pred == ("line", 3) and order[0] == 3 and info["leader"]
    assert rules.predict([], {}, rules.BASELINE)[0] == ("none", None)


def test_confidence_classes() -> None:
    assert rules.confidence({"leader": True, "n_candidates": 2}, 5, 20) == "high"
    assert (
        rules.confidence(
            {"leader": False, "margin": 30, "aligned_top": True, "n_candidates": 3}, 5, 20
        )
        == "high"
    )
    assert (
        rules.confidence(
            {"leader": False, "margin": 30, "aligned_top": False, "n_candidates": 3}, 5, 20
        )
        == "medium"
    )
    assert (
        rules.confidence(
            {"leader": False, "margin": 2, "aligned_top": True, "n_candidates": 3}, 5, 20
        )
        == "low"
    )


# --- leaders -------------------------------------------------------------------------------------
class FakePage(leaders.PageIndex):
    def __init__(self, lines, arrows=()):
        import math

        import numpy as np

        self.lines = [
            {"p": p, "q": q, "length": math.hypot(q[0] - p[0], q[1] - p[1])} for p, q in lines
        ]
        self.ends = np.array([[*p, *q] for p, q in lines])
        self.arrows = list(arrows)


def test_a_leader_chain_reaches_the_candidate_it_touches() -> None:
    box = [100.0, 100.0, 140.0, 110.0]
    idx = FakePage([((140.0, 105.0), (180.0, 150.0)), ((180.0, 150.0), (200.0, 150.0))])
    cands_ = [{"cand": 4, "p": [200.0, 100.0], "q": [200.0, 300.0]}]
    assert leaders.find_leader_target(idx, box, cands_, 3.0, 250.0) == 4
    assert leaders.find_leader_target(idx, box, cands_, 3.0, 40.0) is None  # chain too long


def test_no_leader_when_nothing_starts_at_the_label() -> None:
    idx = FakePage([((300.0, 300.0), (350.0, 350.0))])
    assert (
        leaders.find_leader_target(
            idx, [100, 100, 140, 110], [{"cand": 1, "p": [0, 0], "q": [10, 0]}], 6.0, 250.0
        )
        is None
    )


# --- scoring -------------------------------------------------------------------------------------
def test_correctness_and_failure_modes() -> None:
    assert score.is_correct(("line", 2), "2") and not score.is_correct(("line", 1), "2")
    assert score.is_correct(("group", None), "group") and not score.is_correct(("line", 1), "group")
    assert score.is_correct(("none", None), "none") and not score.is_correct(("line", 1), "missing")
    it = {"gold": "3", "candidates": cands()}
    info = {"leader": False}
    assert (
        score.failure_mode(it, ("line", 2), [2], info, rules.BASELINE)
        == "parallel_neighbour_other_side"
    )
    assert (
        score.failure_mode(it, ("line", 1), [1], info, rules.BASELINE)
        == "crossing_or_non_parallel_line"
    )
    assert (
        score.failure_mode(
            {"gold": "missing", "candidates": []}, ("none", None), [], info, rules.BASELINE
        )
        == "candidate_missing"
    )


def test_preferred_side_is_the_majority_of_design_gold_lines() -> None:
    def item(job, side, gold="1", split="design"):
        return {"job": job, "split": split, "gold": gold, "candidates": [{"cand": 1, "side": side}]}

    pref = score.preferred_side([item("a", 1), item("a", 1), item("a", -1), item("b", -1),
                                 item("c", 1, split="validation"), item("d", 1, gold="missing")])  # fmt: skip
    assert pref["a"] == 1 and pref["b"] == -1
    assert pref["c"] is None and pref["d"] is None  # validation labels and missing gold never count


def test_the_grid_has_no_duplicate_configurations() -> None:
    params = score.all_params()
    assert len(params) == len({tuple(sorted(p.__dict__.items())) for p in params})
    assert rules.BASELINE in params or any(
        p.p_ang == 0 and not p.leader and not p.group_notes for p in params
    )


# --- labels, columns -----------------------------------------------------------------------------
@contextmanager
def fake_doc(monkeypatch, doc):
    monkeypatch.setattr(common, "open_doc", lambda job: doc)
    yield


def test_labels_are_found_with_boxes_and_context(monkeypatch) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=3000, height=2000)
    page.insert_text((300, 300), "(2) W12x26 TYP", fontsize=10)
    page.insert_text((300, 400), "W14x90", fontsize=10)
    page.insert_text((2800, 300), "W8x10", fontsize=10)  # title strip: excluded
    page.insert_text((300, 500), " ".join(["WORD"] * 14) + " W16x26", fontsize=10)  # running note
    with fake_doc(monkeypatch, doc):
        got, excl = labels.page_labels("job-000", 0)
    assert [g["canonical"] for g in got] == ["W12X26", "W14X90"]
    assert (
        got[0]["quantity_prefix"]
        and got[0]["group_note_in_line"]
        and not got[1]["group_note_in_line"]
    )
    assert excl == {"note_line": 1, "title_strip": 1}
    assert got[0]["bbox"][2] > got[0]["bbox"][0] and got[0]["angle_deg"] == 0.0


def test_schedule_rows_need_a_mark_and_a_profile_in_one_row(monkeypatch) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=600)
    for k, (mark, prof) in enumerate([("C1", "W12x26"), ("C2", "HSS6x6x1/4"), ("C3", "W14x90")]):
        page.insert_text((100, 100 + k * 14), f"{mark}  {prof}", fontsize=9)
    page.insert_text((100, 300), "C9", fontsize=9)
    with fake_doc(monkeypatch, doc):
        got = columns.schedule_rows("job-000", 0)
    assert got["mark_and_profile_rows"] == 3 and got["mark_only_rows"] == 1
