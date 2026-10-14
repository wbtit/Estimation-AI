"""Phase 7 Part C development aid (DEV jobs only): which categories of grammar pieces match.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_diag
Counts per category (rules v1 main set: one supported end, any role) (piece type, role, dashed flag, support signature) of the combined main set on
the dev pages: pieces, and how many are matched at 12 pt by the exact rule. Refuses other sides.
"""

from __future__ import annotations

import collections

import numpy as np
import pymupdf

from tools.takeoff import phase7_cgrammar_run as R
from tools.takeoff import phase7_grammar as G
from tools.takeoff import phase7_lib as L
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_study import their_symbols


def category(kind: str, piece: dict) -> str:
    if kind == "column":
        return f"column paint={piece['paint']} at_grid={piece['at_grid']} verts={min(piece['n_verts'], 9)}"
    sup = sorted(("none" if s is None else s["type"]) for s in piece["supports"])
    role = G.ROLE_NAMES[piece["role"]]
    return f"span role={role} dashed={piece['dashed']} supports={'+'.join(sup)}"


def main() -> None:
    ld = R.Loader()
    cats: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    for idx, item in enumerate(R.pages_of("dev")):
        page, parse, words, box, labels = ld.page(item["job"], item["dp"])
        with pymupdf.open(TAKEOFFS / item["file"]) as t:
            syms = their_symbols(t[item["tp"]])
        xy = [(s["x"], s["y"]) for s in syms]
        pp = G.run_page(parse, words, box, labels)
        pieces = [("span", s) for s in pp.main_spans(1, G.THIN)] + [
            ("column", g) for g in pp.main_glyphs()
        ]
        geoms = [R.span_geom(p) if k == "span" else R.glyph_geom(p) for k, p in pieces]
        d = L.distance_matrix(xy, geoms) if geoms else np.zeros((len(xy), 0))
        matched = {j for _, j, _ in L.hungarian_pairs(d, 12.0)}
        for j, (k, p) in enumerate(pieces):
            c = category(k, p)
            cats[c][0] += 1
            cats[c][1] += j in matched
    print(f"{'category':70s} {'pieces':>8s} {'matched':>8s} {'precision':>9s}")
    for c, (n, m) in sorted(cats.items(), key=lambda kv: -kv[1][0]):
        print(f"{c:70s} {n:8d} {m:8d} {m / n:9.3f}")


if __name__ == "__main__":
    main()
