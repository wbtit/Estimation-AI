"""Synthetic tests for the Phase 7 Part B helpers (no drawings, no files)."""

from __future__ import annotations

import itertools
import random

import numpy as np

from tools.takeoff import phase7_lib as L


def test_polyline_point_and_rect_distances():
    xy = np.array([[5.0, 3.0], [15.0, 0.0], [5.0, -4.0]])
    d = L.geometry_distances(xy, {"k": "poly", "pts": [[0, 0], [10, 0], [10, 10]]})
    assert np.allclose(d, [3.0, 5.0, 4.0])  # to the first leg, to the end of the first leg, ...
    d = L.geometry_distances(xy, {"k": "point", "p": [5, 0]})
    assert np.allclose(d, [3.0, 10.0, 4.0])
    d = L.geometry_distances(xy, {"k": "rect", "r": [0, 0, 10, 10]})
    assert np.allclose(d, [0.0, 5.0, 4.0])  # inside the rectangle is 0


def test_distance_matrix_shape_and_empty():
    geoms = [{"k": "point", "p": [0, 0]}, {"k": "point", "p": [10, 0]}]
    d = L.distance_matrix([(0, 0), (10, 5), (3, 4)], geoms)
    assert d.shape == (3, 2)
    assert np.allclose(d[:, 0], [0.0, np.hypot(10, 5), 5.0])
    assert L.distance_matrix([], geoms).shape == (0, 2)
    assert L.distance_matrix([(0, 0)], []).shape == (1, 0)


def test_fast_segment_path_equals_the_general_path():
    rng = np.random.default_rng(3)
    syms = [tuple(map(float, r)) for r in rng.uniform(0, 100, size=(12, 2))]
    segs = rng.uniform(0, 100, size=(9, 4))
    segs[2] = [5, 5, 5, 5]  # a degenerate segment is a point
    geoms = [{"k": "poly", "pts": [[a, b], [c, d]]} for a, b, c, d in segs]
    fast = L.distance_matrix(syms, geoms)
    slow = np.stack([L.geometry_distances(np.asarray(syms), g) for g in geoms], axis=1)
    assert np.allclose(fast, slow)


def test_mixed_geometries_in_one_matrix_equal_the_one_by_one_distances():
    rng = np.random.default_rng(5)
    syms = [tuple(map(float, r)) for r in rng.uniform(0, 100, size=(10, 2))]
    geoms = [
        {"k": "poly", "pts": [[10, 10], [60, 20]]},
        {"k": "rect", "r": [30, 30, 40, 45]},
        {"k": "point", "p": [70, 70]},
        {"k": "poly", "pts": [[0, 0], [50, 0], [50, 50]]},  # a three-point polyline
    ]
    mixed = L.distance_matrix(syms, geoms)
    slow = np.stack([L.geometry_distances(np.asarray(syms), g) for g in geoms], axis=1)
    assert np.allclose(mixed, slow)


def test_greedy_misses_a_match_that_hungarian_finds():
    # s0 is closest to p0, but s1 can only use p0: greedy takes (s0,p0) and loses s1
    d = np.array([[1.0, 2.0], [2.0, 99.0]])
    assert len(L.greedy_pairs(d, 12.0)) == 1
    pairs = L.hungarian_pairs(d, 12.0)
    assert sorted((i, j) for i, j, _ in pairs) == [(0, 1), (1, 0)]


def _brute(d: np.ndarray, radius: float) -> tuple[int, float]:
    """Largest number of pairs within the radius, then the smallest total distance."""
    n, m = d.shape
    best = (0, 0.0)
    rows = range(n)
    for k in range(min(n, m), 0, -1):
        found = None
        for rs in itertools.combinations(rows, k):
            for cs in itertools.permutations(range(m), k):
                if all(d[r, c] <= radius for r, c in zip(rs, cs, strict=True)):
                    tot = sum(d[r, c] for r, c in zip(rs, cs, strict=True))
                    if found is None or tot < found:
                        found = tot
        if found is not None:
            return (k, found)
    return best


def test_hungarian_equals_brute_force_on_random_small_cases():
    rng = np.random.default_rng(7)
    for _ in range(60):
        n, m = int(rng.integers(1, 5)), int(rng.integers(1, 6))
        d = rng.uniform(0, 30, size=(n, m))
        radius = float(rng.uniform(8, 25))
        k, tot = _brute(d, radius)
        pairs = L.hungarian_pairs(d, radius)
        assert len(pairs) == k
        assert abs(sum(p[2] for p in pairs) - tot) < 1e-9
        # one-to-one and within the radius
        assert len({p[0] for p in pairs}) == len(pairs) == len({p[1] for p in pairs})
        assert all(p[2] <= radius for p in pairs)


def test_hungarian_handles_more_symbols_than_pieces_and_nothing_in_range():
    d = np.array([[1.0], [2.0], [3.0]])
    assert [(i, j) for i, j, _ in L.hungarian_pairs(d, 12.0)] == [(0, 0)]
    assert L.hungarian_pairs(np.array([[50.0, 60.0]]), 12.0) == []
    assert L.hungarian_pairs(np.zeros((0, 3)), 12.0) == []


def test_hungarian_never_loses_to_greedy_and_is_deterministic():
    rng = np.random.default_rng(11)
    d = rng.uniform(0, 40, size=(40, 55))
    for r in L.RADII:
        g = L.greedy_pairs(d, r)
        h1 = L.hungarian_pairs(d, r)
        h2 = L.hungarian_pairs(d, r)
        assert len(h1) >= len(g)
        assert h1 == h2


def test_prf():
    assert L.prf(5, 10, 20) == (0.5, 0.25, 2 * 0.5 * 0.25 / 0.75)
    assert L.prf(0, 0, 4) == (None, 0.0, None)


def test_controls_are_seeded_and_stay_in_the_box():
    box = (0.0, 0.0, 100.0, 50.0)
    a = L.uniform_points(box, 30, random.Random(5))
    b = L.uniform_points(box, 30, random.Random(5))
    assert a == b and len(a) == 30
    assert all(0 <= x <= 100 and 0 <= y <= 50 for x, y in a)
    syms = [(50.0, 25.0)] * 40
    moved = L.displaced_points(syms, (-500.0, -500.0, 500.0, 500.0), random.Random(1))
    dist = [np.hypot(x - 50, y - 25) for x, y in moved]
    assert min(dist) >= L.DISPLACE_MIN_PT - 1e-9 and max(dist) <= L.DISPLACE_MAX_PT + 1e-9
    clipped = L.displaced_points(syms, box, random.Random(1))
    assert all(0 <= x <= 100 and 0 <= y <= 50 for x, y in clipped)


def test_job_split_is_fixed_balanced_and_separates_the_two_largest():
    sizes = {f"job-{i:03d}": 10 + i for i in range(16)}
    sizes["job-big1"] = 1000
    sizes["job-big2"] = 900
    sizes.pop("job-000")
    sizes.pop("job-001")
    s1 = L.split_jobs(sizes)
    assert s1 == L.split_jobs(sizes)
    assert sum(v == "dev" for v in s1.values()) == 10
    assert sum(v == "held-out" for v in s1.values()) == 6
    assert s1["job-big1"] != s1["job-big2"]
