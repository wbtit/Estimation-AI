"""Phase 14c: five column types, grid pieces, solid clicks (docs/PHASE14C_PREREGISTRATION.md;
session 1 page 5 and the DEV column-plan pages; read-only).

  PYTHONPATH=. .venv/bin/python -m tools.p14c_columns            # the run
  PYTHONPATH=. .venv/bin/python -m tools.p14c_columns report     # the doc again from the JSON

The 14b, 14b v2 and 14c pre-registration hashes are verified first; the run stops when one
differs. Each page is rebuilt IN MEMORY with the engine's `build_page` (tools.p14b_columns):
A (guard: the stored column counts), v2 NEW-auto / NEW-click (guard: equal to the stored v2 run),
v3 NEW-auto, NEW-click (a SIMULATED click from estimator data), NEW-click without click_solid,
NEW-auto+A, and one change at a time. Writes the private fixtures/private/eval/p14c/v3/ (refused
when it exists; older galleries are never touched) and the local docs/PHASE14C_RESULTS.md; prints
counts only. No database writes; the locked TEST set is never read.
"""

from __future__ import annotations

import collections
import html
import json
import math
import random
import sys
from typing import Any

from PIL import Image, ImageDraw

from src.build.col_symbols import FIVE_FAMILIES, STUD_KIND, V2_RULES, V3_RULES
from src.build.grids import find_grid_lines
from src.build.page import Setup, build_page
from src.build.propose import displayed_size
from tools import p14b_columns as b
from tools.p12c_eval import _font
from tools.prereg import verify
from tools.takeoff.common import PRIVATE, ROOT

PREREG = ROOT / "docs" / "PHASE14C_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE14C.sha256"
OUT_DIR = PRIVATE / "eval" / "p14c" / "v3"
DOC = ROOT / "docs" / "PHASE14C_RESULTS.md"
P5 = "session1 p5"
GRID_NEAR_PT = 6.0
SAME_PT = 2.0
NO_GRID = V3_RULES - {"grid_strip"}
NO_FIVE = V2_RULES | {"grid_strip", "click_solid"}
NO_SOLID = V3_RULES - {"click_solid"}
# name -> (base configuration, rules)
RUNS: dict[str, tuple[str, frozenset[str]]] = {
    "A": ("A", V3_RULES),
    "v2 NEW-auto": ("NEW-auto", V2_RULES),
    "v2 NEW-click": ("NEW-click", V2_RULES),
    "v3 NEW-auto": ("NEW-auto", V3_RULES),
    "v3 NEW-click": ("NEW-click", V3_RULES),
    "v3 NEW-click no solid": ("NEW-click", NO_SOLID),
    "v3 NEW-auto no grid": ("NEW-auto", NO_GRID),
    "v3 NEW-click no grid": ("NEW-click", NO_GRID),
    "v3 NEW-auto no five": ("NEW-auto", NO_FIVE),
    "v3 NEW-click no five": ("NEW-click", NO_FIVE),
}
PRIMARY = ("A", "v2 NEW-auto", "v2 NEW-click", "v3 NEW-auto", "v3 NEW-click",
           "v3 NEW-click no solid", "v3 NEW-auto+A")  # fmt: skip
INFO = ("v3 NEW-auto no grid", "v3 NEW-click no grid", "v3 NEW-auto no five",
        "v3 NEW-click no five")  # fmt: skip
SIMULATED = {n for n, (c, _) in RUNS.items() if c == "NEW-click"}


def build(ctx: b.Ctx, cfg: str, rules: frozenset[str]):
    pg = ctx.pg
    flags = frozenset() if cfg == "A" else b.NEW
    clicks = tuple(sorted(ctx.truth, key=lambda m: (m[1], m[0]))) if cfg == "NEW-click" else ()
    setup = Setup(
        pg.box,
        pg.ratio,
        pg.tos,
        pg.auto,
        pg.role,
        str(pg.inputs.get("crossing_rule") or "family"),
        pens=pg.view_pens,
        flags=flags,
        clicks=clicks,
        col_rules=rules,
    )
    pb = build_page(pg.page, setup, pg.text, pg.legend, pg.plan)
    res = pb.col_result
    if res is None:
        cols = [{"pt": list(g.centre), "kind": "Column", "family": None, "solid": None,
                 "source": "A", "profile": None, "flag": None} for g in pb.columns]  # fmt: skip
        rec: dict[str, Any] = {"columns": cols}
    else:
        cols = [
            {
                "pt": list(h.symbol.centre),
                "kind": h.kind,
                "family": h.symbol.family,
                "solid": h.symbol.solid,
                "source": h.source,
                "profile": h.profile,
                "flag": h.flag,
            }
            for h in res.hits
        ]
        rec = {
            "columns": cols,
            "examples": len(res.examples),
            "examples_label": sum(e.source == "label" for e in res.examples),
            "examples_click": sum(e.source == "click" for e in res.examples),
            "example_keys": sorted({_key(e.symbol) for e in res.examples}),
            "callouts": res.callouts,
            "callouts_with_leader": res.callouts_with_leader,
            "symbols": len(res.symbols),
            "families": dict(collections.Counter(s.family for s in res.symbols)),
            "solids": dict(collections.Counter(s.solid for s in res.symbols if s.solid)),
        }
    return rec, pb


def _key(s) -> str:
    return f"solid_{s.solid}" if s.solid else s.family


def recovered(with_grid, without_grid) -> int:
    """Known-family symbols of v3 with no same-family symbol within SAME_PT without grid_strip."""
    n = 0
    for s in with_grid:
        if s.family not in FIVE_FAMILIES:
            continue
        if not any(
            o.family == s.family and math.dist(o.centre, s.centre) <= SAME_PT for o in without_grid
        ):
            n += 1
    return n


def miss_census(ctx: b.Ctx, rec: dict, pb) -> dict[str, int]:
    """Prereg 14c section 4: the first cause that applies to each unmatched truth mark."""
    out: collections.Counter[str] = collections.Counter()
    res = pb.col_result
    lines, _ = find_grid_lines(pb.segments, pb.cleaned.keep, pb.bubbles)
    hits = [tuple(c["pt"]) for c in rec["columns"]]
    for k, t in enumerate(ctx.truth):
        if rec["truth_matched"][k]:
            continue
        if res is None or not res.examples:
            out["no example on the page"] += 1
            continue
        near = [s for s in res.symbols if math.dist(s.centre, t) <= b.MATCH_PT]
        if not near:
            out["no symbol"] += 1
            if any(_axis_dist(t, ln.p0, ln.p1) <= GRID_NEAR_PT for ln in lines):
                out["no symbol, on a grid line"] += 1
            continue
        s = min(near, key=lambda s: (math.dist(s.centre, t), s.centre))
        if s.family == "unknown" and not (s.solid and f"solid_{s.solid}" in rec["example_keys"]):
            out["unknown (solid)" if s.solid else "unknown"] += 1
        elif _key(s) not in rec["example_keys"]:
            out["family of no example"] += 1
        else:
            out["other size"] += 1
            if any(math.dist(h, s.centre) <= SAME_PT for h in hits):
                out["other size: the symbol is one of ours (matched to another mark)"] += 1
    return dict(out)


def _axis_dist(p, a, c) -> float:
    d = math.dist(a, c)
    if d == 0:
        return math.dist(p, a)
    return abs((c[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (c[1] - a[1])) / d


def run() -> dict[str, Any]:
    v2 = json.loads(b.OUT2.read_text())
    ctxs = b.load()
    pages: dict[str, dict] = {}
    extra: dict[str, dict] = {}
    for ctx in ctxs:
        pages[ctx.key] = {"group": ctx.group, "configs": {}}
        built = {}
        for name, (cfg, rules) in RUNS.items():
            rec, pb = build(ctx, cfg, rules)
            if name == "A" and len(rec["columns"]) != b.stored_columns(ctx.pg):
                raise SystemExit(f"guard: A differs from the stored column count on {ctx.key}")
            b.measure(ctx, rec)
            if name.startswith("v2 "):
                old = v2["pages"][ctx.key]["configs"][cfg]
                if (old["ours"], old["matched"]) != (rec["ours"], rec["matched"]):
                    raise SystemExit(f"guard: v2 {cfg} differs from the stored v2 run on {ctx.key}")
            pages[ctx.key]["configs"][name] = rec
            built[name] = pb
        na = pages[ctx.key]["configs"]["v3 NEW-auto"]
        a = pages[ctx.key]["configs"]["A"]
        pages[ctx.key]["configs"]["v3 NEW-auto+A"] = dict(na) if na.get("examples") else dict(a)
        extra[ctx.key] = {
            "recovered": recovered(built["v3 NEW-auto"].col_result.symbols,
                                   built["v3 NEW-auto no grid"].col_result.symbols),
            "miss": miss_census(ctx, pages[ctx.key]["configs"]["v3 NEW-click"],
                                built["v3 NEW-click"]),
        }  # fmt: skip
        print(f"{ctx.key}: built", flush=True)
    names = [*PRIMARY, *INFO]
    dev = [p for k, p in pages.items() if k != P5]
    d: dict[str, Any] = {"pages": pages, "configs": names}
    d["dev"] = {c: b.pooled(dev, c) for c in names}
    p5 = pages[P5]["configs"]
    lost = [k for k, m in enumerate(p5["v2 NEW-click"]["truth_matched"]) if not m]
    got = [k for k in lost if p5["v3 NEW-click"]["truth_matched"][k]]
    d["page5_misses"] = {
        "v2_missed": len(lost),
        "v3_found": len(got),
        "v3_no_grid_also_found": sum(
            1 for k in got if p5["v3 NEW-click no grid"]["truth_matched"][k]),
    }  # fmt: skip
    d["recovered"] = {k: v["recovered"] for k, v in extra.items()}
    d["miss"] = {k: v["miss"] for k, v in extra.items()}
    allp = list(pages.values())
    d["fp"] = {
        c: {
            "family": dict(collections.Counter(
                x["family"] for p in allp for x in p["configs"][c]["columns"] if not x["matched"])),
            "source": dict(collections.Counter(
                x["source"] for p in allp for x in p["configs"][c]["columns"] if not x["matched"])),
            "solid": sum(1 for p in allp for x in p["configs"][c]["columns"]
                         if not x["matched"] and x.get("solid")),
        }
        for c in ("v3 NEW-auto", "v3 NEW-click", "v3 NEW-click no solid")
    }  # fmt: skip
    na = [p["configs"]["v3 NEW-auto"] for p in allp]
    nc = [p["configs"]["v3 NEW-click"] for p in allp]
    fam: collections.Counter[str] = collections.Counter()
    sol: collections.Counter[str] = collections.Counter()
    for r in na:
        fam.update(r.get("families", {}))
        sol.update(r.get("solids", {}))
    d["families"] = {k: fam[k] for k in (*FIVE_FAMILIES, "unknown") if fam[k]}
    d["solids"] = dict(sorted(sol.items()))
    d["examples"] = {
        "pages": len(allp),
        "pages_with_label_example": sum(1 for r in na if r.get("examples_label")),
        "pages_needing_click": sum(1 for r in na if not r.get("examples_label")),
        "pages_click_found": sum(1 for r in nc if r.get("examples_click")),
        "pages_click_solid": sum(1 for r in nc if any(k.startswith("solid_") for k in r.get("example_keys", []))),  # noqa: E501
        "callouts": sum(r.get("callouts", 0) for r in na),
        "with_leader": sum(r.get("callouts_with_leader", 0) for r in na),
        "label_examples": sum(r.get("examples_label", 0) for r in na),
        "by_source": dict(collections.Counter(c["source"] for r in nc for c in r["columns"])),
        "flags": sum(1 for r in nc for c in r["columns"] if c["flag"]),
    }  # fmt: skip
    d["_ctxs"] = ctxs
    return d


# --- gallery --------------------------------------------------------------------------------------
def gallery(ctxs: list[b.Ctx], pages: dict[str, dict], folder) -> list[dict]:
    folder.mkdir(parents=True)
    before, after = "v2 NEW-click", "v3 NEW-click"
    changed = []
    for ctx in ctxs:
        x = pages[ctx.key]["configs"][before]["truth_matched"]
        y = pages[ctx.key]["configs"][after]["truth_matched"]
        for k, t in enumerate(ctx.truth):
            if x[k] != y[k]:
                changed.append((ctx.key, round(t[0], 1), round(t[1], 1), k, ctx))
    changed.sort(key=lambda c: (c[0], c[1], c[2]))
    rng = random.Random(b.SEED)
    p5 = [c for c in changed if c[0] == P5]
    pick = rng.sample(p5, 1) if p5 else []
    rest = [c for c in changed if c not in pick]
    pick += rng.sample(rest, min(10 - len(pick), len(rest)))
    out = []
    for n, (key, x, y, k, ctx) in enumerate(pick):
        page = ctx.pg.page
        w, h = displayed_size(page)
        x0 = min(max(x - b.WIN_PT / 2, 0.0), max(w - b.WIN_PT, 0.0))
        y0 = min(max(y - b.WIN_PT / 2, 0.0), max(h - b.WIN_PT, 0.0))
        box = (x0, y0, min(x0 + b.WIN_PT, w), min(y0 + b.WIN_PT, h))
        cfgs = pages[key]["configs"]
        p1 = b._panel(page, box, cfgs[before]["columns"], ctx.truth)
        p2 = b._panel(page, box, cfgs[after]["columns"], ctx.truth)
        gap = 16
        im = Image.new("RGB", (p1.width * 2 + gap * 3, p1.height + 100), (255, 255, 255))
        o = ImageDraw.Draw(im)
        for i, (pi, t) in enumerate(((p1, f"before: {before}"), (p2, f"after: {after}"))):
            xx = gap + i * (p1.width + gap)
            o.text((xx, 6), t + " (simulated click)", fill=(40, 40, 40), font=_font(22))
            im.paste(pi, (xx, 36))
        status = "newly matched" if cfgs[after]["truth_matched"][k] else "newly lost"
        o.text((gap, im.height - 58), f"{key}: {status}", fill=(20, 20, 20), font=_font(18))
        o.text((gap, im.height - 32), "blue: estimator column, teal: our column, orange: our"
               " stud/post", fill=(90, 90, 90), font=_font(16))  # fmt: skip
        name = f"{n + 1:02d}.png"
        im.save(folder / name, optimize=True)
        out.append({"file": name, "page": key, "status": status})
    rows = "".join(
        f"<figure><img src='{html.escape(g['file'])}'><figcaption>{html.escape(g['page'])}: "
        f"{html.escape(g['status'])}</figcaption></figure>"
        for g in out
    )
    (folder / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>Phase 14c gallery</title>"
        "<style>img{max-width:100%}figure{margin:0 0 24px}</style>" + rows
    )
    return out


# --- report ---------------------------------------------------------------------------------------
_pct = b._pct


def _row(name: str, d: dict) -> str:
    p5 = d["pages"][P5]["configs"][name]
    dv = d["dev"][name]
    sim = " (simulated)" if name in SIMULATED else ""
    return (
        f"| {name}{sim} | {p5['ours']} / {p5['theirs']}, {p5['matched']}, {_pct(p5['precision'])},"
        f" {_pct(p5['recall'])}, {'yes' if p5['within'] else 'no'} | {dv['within']},"
        f" {dv['matched']} / {dv['theirs']} (ours {dv['ours']}), {_pct(dv['precision'])},"
        f" {_pct(dv['recall'])} |"
    )


def report(d: dict) -> str:
    L = ["# Phase 14c results (v3): five column types, grid pieces, solid clicks", ""]
    L.append(
        f"Pre-registration `docs/PHASE14C_PREREGISTRATION.md`, sha256 `{d['prereg'][:16]}...`"
        " (committed before the run; amended once before any run, disclosed in the document)."
        " NOT blind: written after the 14b v1 and v2 runs on these pages. NEW-click is a SIMULATED"
        " click from estimator data, not an automatic result. In memory; no database writes; DEV"
        " data and session 1 only. The v2 rows are a re-run that equals the stored v2 run (guard)."
    )
    head = ("| Configuration | Page 5: ours / truth, matched, P, R, within 20% |"
            " DEV pages: within 20% (of 10), matched / marks (ours), P, R |")  # fmt: skip
    L += ["", "## v3 vs v2 vs A", "", head, "|---|---|---|"]
    L += [_row(c, d) for c in PRIMARY]
    L += ["", "## Page 5: columns and studs / posts", "",
          "| Configuration | Columns: ours, matched | Studs/posts: ours, matched | Together: ours, matched |",  # noqa: E501
          "|---|---|---|---|"]  # fmt: skip
    for c in PRIMARY:
        cols = d["pages"][P5]["configs"][c]["columns"]
        k = collections.Counter((x["kind"], x["matched"]) for x in cols)

        def n(kind: str, k=k) -> tuple[int, int]:
            return sum(v for (kk, _), v in k.items() if kk == kind), k[(kind, True)]

        x, y = n("Column"), n(STUD_KIND)
        L.append(f"| {c} | {x[0]}, {x[1]} | {y[0]}, {y[1]} | {x[0] + y[0]}, {x[1] + y[1]} |")
    pm = d["page5_misses"]
    L += [
        "",
        "## Grid fix",
        "",
        f"- Page 5: v2 NEW-click missed {pm['v2_missed']} of the 30; v3 NEW-click finds"
        f" {pm['v3_found']} of them; v3 without grid_strip also finds {pm['v3_no_grid_also_found']}"
        f" (so {pm['v3_found'] - pm['v3_no_grid_also_found']} are credited to the grid fix).",
        f"- Known-family symbols recovered by grid_strip (v3 NEW-auto symbol lists): total"
        f" {sum(d['recovered'].values())}; per page "
        + ", ".join(f"{k} {v}" for k, v in d["recovered"].items())
        + ".",
        "",
        "## One change at a time (information)",
        "",
        head,
        "|---|---|---|",
    ]
    L += [_row(c, d) for c in INFO]
    L += ["", "## Per page", ""]
    cols = ("A", "v2 NEW-click", "v3 NEW-auto", "v3 NEW-click", "v3 NEW-click no solid")
    L.append("| Page | Truth | " + " | ".join(f"{c}: ours (matched)" for c in cols) + " |")
    L.append("|---|---:|" + "---|" * len(cols))
    for key, p in d["pages"].items():
        cf = p["configs"]
        L.append(
            f"| {key} | {cf['A']['theirs']} | "
            + " | ".join(f"{cf[c]['ours']} ({cf[c]['matched']})" for c in cols)
            + " |"
        )
    e = d["examples"]
    L += [
        "",
        "## Examples (v3)",
        "",
        f"- Pages with an example from a label (NEW-auto): {e['pages_with_label_example']} of"
        f" {e['pages']}; pages that needed a click: {e['pages_needing_click']} (the simulated click"
        f" found a symbol on {e['pages_click_found']}; a solid one on {e['pages_click_solid']}).",
        f"- Callouts {e['callouts']}, with a leader {e['with_leader']}, giving an example"
        f" {e['label_examples']}.",
        f"- Matches by source (NEW-click): {e['by_source']}. Cross-check flags: {e['flags']}.",
        "",
        "## Miss census (v3 NEW-click, unmatched truth, first cause)",
        "",
    ]
    tot: collections.Counter[str] = collections.Counter()
    for v in d["miss"].values():
        tot.update(v)
    L.append(f"- All pages: {dict(sorted(tot.items()))}.")
    L.append(f"- Page 5: {d['miss'][P5]}.")
    L += ["", "## False-positive census (unmatched ours)", ""]
    for c, v in d["fp"].items():
        L.append(f"- {c}: by family {v['family']}; by source {v['source']}; solid {v['solid']}.")
    L += ["", "## Families of the kept symbols (v3 NEW-auto, all pages)", ""]
    L.append(", ".join(f"{k} {v}" for k, v in d["families"].items()))
    L.append(f"; solid shapes (inside unknown): {d['solids']}.")
    L += ["", "## Gallery", "",
          f"`fixtures/private/eval/p14c/v3/gallery/index.html`: {len(d['gallery'])} crops"
          " (before v2 NEW-click, after v3 NEW-click)."]  # fmt: skip
    return "\n".join(L) + "\n"


def main(argv: list[str]) -> None:
    verify(b.PREREG, b.PREREG_HASH)
    verify(b.PREREG2, b.PREREG2_HASH)
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:
        DOC.write_text(report(json.loads((OUT_DIR / "columns.json").read_text())))
        return
    if OUT_DIR.exists():
        raise SystemExit(f"{OUT_DIR} exists; a new run needs a new versioned folder")
    print("pre-registration verified:", digest[:12])
    d = run()
    ctxs = d.pop("_ctxs")
    d["prereg"] = digest
    d["gallery"] = gallery(ctxs, d["pages"], OUT_DIR / "gallery")
    (OUT_DIR / "columns.json").write_text(json.dumps(d, indent=1))
    DOC.write_text(report(d))
    for c in d["configs"]:
        p5 = d["pages"][P5]["configs"][c]
        print(c, "page5", p5["ours"], p5["matched"], "dev", d["dev"][c])
    print("page5 misses", d["page5_misses"], "recovered", sum(d["recovered"].values()))


if __name__ == "__main__":
    main(sys.argv[1:])
