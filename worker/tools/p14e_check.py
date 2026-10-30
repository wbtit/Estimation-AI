"""Phase 14e: equivalence and timing check of the fast image search (read-only; session 1 page 5
and the DEV column-plan pages; NOT an evaluation: nothing is compared with the truth).

  PYTHONPATH=. .venv/bin/python -m tools.p14e_check

On each page (the 14d clicks: page 5 = the estimator's first drawn column, a DEV page = the first
mark giving an example) it checks that
  1. the tiled, parallel search against the 14d implementation (threshold 0.70): hits paired
     within 1 pt with the same rotation and scores within 1e-4; the rest are reported (float
     rounding breaks plateaus of equal scores differently: not a check), and the 14d measure V+I
     at 0.70 (ours, matched) recomputed with the fast search against the stored 14d run;
  2. one search at 0.60 filtered at 0.70 / 0.80 equals a search at 0.70 / 0.80 (combined);
  3. the cached raster (save + load) gives the same result as the rendered one;
and times the search on a cached raster (a cache hit: load + search) and on a fresh render. Prints
counts and times only; exits non-zero when a check fails.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
import tempfile
import time
from pathlib import Path

from src.build import col_image as ci
from tools import p14b_columns as b
from tools.p14d_columns import P5, page5_first_drawn, prepare
from tools.takeoff.common import PRIVATE


def _box(r, click, ratio, syms):
    vex = ci.vector_example(click, syms)
    if vex is None:
        return ci.ink_example(r, click, ratio)
    p0, p1 = r.px((vex["box"][0], vex["box"][1])), r.px((vex["box"][2], vex["box"][3]))
    return (math.floor(p0[0]), math.floor(p0[1]), math.ceil(p1[0]), math.ceil(p1[1]))


def unpaired(a: list[ci.Hit], b_: list[ci.Hit]) -> int:
    """Hits of `a` with no hit of `b_` within 1 pt, same rotation, score within 1e-4."""
    return sum(
        1
        for x in a
        if not any(
            x.rotation == y.rotation
            and math.dist(x.centre, y.centre) < 1.0
            and abs(x.score - y.score) <= 1e-4
            for y in b_
        )
    )


def main() -> None:
    first = page5_first_drawn()
    v4 = json.loads((PRIVATE / "eval" / "p14d" / "v4" / "columns.json").read_text())
    fails: list[str] = []
    hit_s, fresh_s = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for ctx in b.load():
            syms, grid = prepare(ctx)
            page, crop, ratio = ctx.pg.page, ctx.pg.box, ctx.pg.ratio
            s7 = ci.Settings(threshold=0.7)
            r = ci.render(page, crop, ratio, grid, s7)
            order = (
                [first]
                if ctx.key == P5
                else sorted(range(len(ctx.truth)), key=lambda k: (ctx.truth[k][1], ctx.truth[k][0]))
            )
            click = next(
                (tuple(ctx.truth[k]) for k in order if _box(r, tuple(ctx.truth[k]), ratio, syms)),
                None,
            )
            if click is None:
                print(f"{ctx.key}: no example (as 14d)")
                continue
            box = _box(r, click, ratio, syms)
            new, old = ci.image_matches(r, box, ratio, s7), ci.image_matches_14d(r, box, ratio, s7)
            only_new, only_old = unpaired(new, old), unpaired(old, new)
            at7 = ci.search(r, ratio, click, syms, s7)
            rec = {"columns": [{"pt": c["centre"], "kind": "Column"} for c in at7.combined]}
            b.measure(ctx, rec)
            stored = v4["pages"][ctx.key]["configs"]["V+I"]
            low = ci.search(r, ratio, click, syms, ci.Settings(threshold=ci.SEARCH_THRESHOLD))
            ok2 = all(
                ci.strict(low.combined, t)
                == ci.search(r, ratio, click, syms, ci.Settings(threshold=t)).combined
                for t in (0.7, 0.8)
            )
            path = Path(tmp) / f"{len(hit_s)}.npz"
            ci.save_raster(path, r)
            t0 = time.perf_counter()
            cached = ci.load_raster(path)
            res = ci.search(cached, ratio, click, syms, ci.Settings(threshold=ci.SEARCH_THRESHOLD))
            hit = time.perf_counter() - t0
            ok3 = res.combined == low.combined
            t0 = time.perf_counter()
            ci.search(
                ci.render(page, crop, ratio, grid, s7), ratio, click, syms,
                ci.Settings(threshold=ci.SEARCH_THRESHOLD),
            )  # fmt: skip
            fresh = time.perf_counter() - t0
            hit_s.append(hit)
            fresh_s.append(fresh)
            print(f"{ctx.key}: hits {len(new)} (14d {len(old)}), unpaired {only_new} / {only_old};"
                  f" V+I@0.7 ours {rec['ours']} matched {rec['matched']} (14d run {stored['ours']},"
                  f" {stored['matched']}); filter=search {ok2};"
                  f" cache same={ok3}; cache hit {hit:.2f}s, fresh render {fresh:.2f}s,"
                  f" cache file {path.stat().st_size / 1e6:.2f} MB")  # fmt: skip
            if not (ok2 and ok3):
                fails.append(ctx.key)
    med = statistics.median
    print(f"search on a cache hit: median {med(hit_s):.2f}s, max {max(hit_s):.2f}s;"
          f" on a fresh render: median {med(fresh_s):.2f}s, max {max(fresh_s):.2f}s")  # fmt: skip
    if fails:
        print("CHECK FAILED on", fails)
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
