"""Glyph geometry and the fixed tolerances."""

import itertools
import random

import numpy as np
from stroke_font import GLYPHS, LIBRARY_LABELS

from src.text_reader import geometry
from src.text_reader.geometry import (
    CHAMFER_TOL,
    HAUSDORFF_TOL,
    N_POINTS,
    describe,
    distances,
    signature_hash,
)


def scaled(strokes, scale, dx=0.0, dy=0.0):
    return [[(x * scale + dx, y * scale + dy) for x, y in s] for s in strokes]


def close(a, b) -> bool:
    c, h = distances(a.points[None], b.points)
    return bool(c[0] <= CHAMFER_TOL and h[0] <= HAUSDORFF_TOL)


def test_tolerances_are_the_phase_4a_constants() -> None:
    assert (CHAMFER_TOL, HAUSDORFF_TOL, N_POINTS) == (0.03, 0.10, 64)


def test_descriptor_is_invariant_to_translation_and_scale() -> None:
    base = describe(GLYPHS["R"])
    moved = describe(scaled(GLYPHS["R"], 2.75, 300.5, -41.25))
    c, h = distances(base.points[None], moved.points)
    assert c[0] < 1e-6 and h[0] < 1e-6
    assert base.key == moved.key


def test_resample_returns_n_points_even_for_a_dot_or_a_single_stroke() -> None:
    assert geometry.resample(geometry.normalise(GLYPHS["I"])).shape == (N_POINTS, 2)
    dot = geometry.resample(geometry.normalise([[(5.0, 5.0)]]))
    assert dot.shape == (N_POINTS, 2) and np.allclose(dot, dot[0])


def test_aspect_ratio_is_kept_when_normalising() -> None:
    d = describe(GLYPHS["-"])  # a horizontal bar: wide, no height
    assert d.extent == (1.0, 0.0)
    d = describe(GLYPHS["I"])
    assert d.extent == (0.0, 1.0)


def test_small_drawing_noise_still_matches() -> None:
    rng = random.Random(1)
    for ch in "BRSN8":
        noisy = [
            [(x + rng.uniform(-0.04, 0.04), y + rng.uniform(-0.04, 0.04)) for x, y in s]
            for s in GLYPHS[ch]
        ]
        assert close(describe(GLYPHS[ch]), describe(noisy)), ch


def test_every_pair_of_distinct_font_glyphs_is_distinguishable_at_the_fixed_tolerances() -> None:
    """If this fails the synthetic FONT must change, never the tolerances."""
    d = {ch: describe(GLYPHS[ch]) for ch in LIBRARY_LABELS}
    confusable = [(a, b) for a, b in itertools.combinations(d, 2) if close(d[a], d[b])]
    assert confusable == []


def test_signature_hash_is_stable_and_distinguishes_shapes() -> None:
    assert signature_hash(GLYPHS["B"]) == signature_hash(scaled(GLYPHS["B"], 3.0, 10, 10))
    assert len({signature_hash(GLYPHS[c]) for c in LIBRARY_LABELS}) == len(LIBRARY_LABELS)
    assert len(signature_hash(GLYPHS["B"])) == 64
