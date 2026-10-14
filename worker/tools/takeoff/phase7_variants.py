"""Phase 7 Part C development aid (DEV jobs only): score candidate filters of the main set.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_variants
Run on rules v1 (before revisions r1 and r2; `main_glyphs` there meant "at grid or no grid"). One grammar pass over the dev pages, then each variant (a filter over spans and glyphs) is scored
with the exact rule at 12 pt against the symbols and against 5 displaced replicates. Every variant
looked at is listed in the dev log of docs/PHASE7_RESULTS.md, kept or not.
"""

from __future__ import annotations

import random

import numpy as np
import pymupdf

from tools.takeoff import phase7_cgrammar_run as R
from tools.takeoff import phase7_grammar as G
from tools.takeoff import phase7_lib as L
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_study import their_symbols

REPS = 5


def col_end(s):
    return sum(1 for x in s["supports"] if x and x["type"] == "column")


def heavier_member(s, chains):
    out = 0
    for x in s["supports"]:
        if x and x["type"] == "member" and chains[x["id"]].role > s["role"]:
            out += 1
    return out


def similar_glyph_counts(glyphs):
    """size class (rounded box sides) -> number of glyphs on the page"""
    cnt = {}
    for g in glyphs:
        k = (round(g["box"][2] - g["box"][0]), round(g["box"][3] - g["box"][1]), g["paint"])
        cnt[k] = cnt.get(k, 0) + 1
    return cnt


VARIANTS = {
    "v1 as registered (>=1 support, all glyphs main)": lambda s, c: s["n_supports"] >= 1,
    "A both ends supported": lambda s, c: s["n_supports"] == 2,
    "B both ends, role>=medium": lambda s, c: s["n_supports"] == 2 and s["role"] >= G.MEDIUM,
    "C both ends, at least one column": lambda s, c: s["n_supports"] == 2 and col_end(s) >= 1,
    "D both ends, columns or strictly heavier member": lambda s, c: (
        s["n_supports"] == 2 and col_end(s) + heavier_member(s, c) == 2
    ),
    "E both ends columns": lambda s, c: col_end(s) == 2,
    "F both ends columns, role>=medium": lambda s, c: col_end(s) == 2 and s["role"] >= G.MEDIUM,
    "G >=1 column end, role>=medium": lambda s, c: col_end(s) >= 1 and s["role"] >= G.MEDIUM,
    "H heavy only, >=1 support": lambda s, c: s["n_supports"] >= 1 and s["role"] == G.HEAVY,
    "I role>=medium, >=1 strictly heavier member or column": lambda s, c: (
        s["role"] >= G.MEDIUM and col_end(s) + heavier_member(s, c) >= 1
    ),
}


GLYPH_MODES = (
    "none",
    "all main",
    "repeat>=4",
    "meets>=1 span end",
    "meets>=2 span ends",
    "repeat>=4 and meets>=1",
)


def glyph_filter(mode, pp, span_keep):
    """indices of the glyphs kept by `mode` (span_keep: the span filter used for the ends)."""
    if mode == "none":
        return []
    main = [k for k, g in enumerate(pp.glyphs) if g["main"]]
    if mode == "all main":
        return main
    ends = {}
    for s in pp.spans:
        if not span_keep(s, pp.chains):
            continue
        for x in s["supports"]:
            if x and x["type"] == "column":
                ends[x["id"]] = ends.get(x["id"], 0) + 1
    rep = similar_glyph_counts(pp.glyphs)

    def repeats(g):
        return rep[(round(g["box"][2] - g["box"][0]), round(g["box"][3] - g["box"][1]), g["paint"])]

    if mode == "repeat>=4":
        return [k for k in main if repeats(pp.glyphs[k]) >= 4]
    if mode == "meets>=1 span end":
        return [k for k in main if ends.get(k, 0) >= 1]
    if mode == "meets>=2 span ends":
        return [k for k in main if ends.get(k, 0) >= 2]
    return [k for k in main if repeats(pp.glyphs[k]) >= 4 and ends.get(k, 0) >= 1]


def main() -> None:
    ld = R.Loader()
    pages = []
    for idx, item in enumerate(R.pages_of("dev")):
        page, parse, words, box, labels = ld.page(item["job"], item["dp"])
        with pymupdf.open(TAKEOFFS / item["file"]) as t:
            syms = their_symbols(t[item["tp"]])
        pp = G.run_page(parse, words, box, labels)
        pages.append((idx, [(s["x"], s["y"]) for s in syms], box, pp))
    theirs = sum(len(p[1]) for p in pages)
    print("dev pages", len(pages), "symbols", theirs)
    for name in (
        "v1 as registered (>=1 support, all glyphs main)",
        "A both ends supported",
        "B both ends, role>=medium",
    ):
        keep = VARIANTS[name]
        for glyph_mode in GLYPH_MODES:
            m_real = n_pieces = 0
            m_ctl = [0] * REPS
            for idx, xy, box, pp in pages:
                geoms = [R.span_geom(s) for s in pp.spans if keep(s, pp.chains)]
                geoms += [R.glyph_geom(pp.glyphs[k]) for k in glyph_filter(glyph_mode, pp, keep)]
                n_pieces += len(geoms)
                if not geoms:
                    continue
                m_real += len(L.hungarian_pairs(L.distance_matrix(xy, geoms), 12.0))
                for k in range(REPS):
                    rng = random.Random(900000 + k * 1000 + idx)
                    pts = L.displaced_points(xy, box, rng)
                    m_ctl[k] += len(L.hungarian_pairs(L.distance_matrix(pts, geoms), 12.0))
            p, r, f = L.prf(m_real, n_pieces, theirs)
            rc = float(np.mean(m_ctl)) / theirs
            print(
                f"{name[:44]:44s} glyphs={glyph_mode:26s} pieces={n_pieces:6d} P={p or 0:.3f} R={r:.3f}"
                f" F1={f or 0:.3f} | displaced R={rc:.3f} gap={r - rc:+.3f}"
            )


if __name__ == "__main__":
    main()
