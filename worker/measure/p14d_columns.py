"""Phase 14d: image-based Find similar from one click (docs/PHASE14D_PREREGISTRATION.md; session 1
page 5 primary, the DEV column-plan pages secondary; read-only).

  PYTHONPATH=. .venv/bin/python -m measure.p14d_columns            # the run
  PYTHONPATH=. .venv/bin/python -m measure.p14d_columns report     # the doc again from the JSON

The 14b, 14b v2, 14c and 14d hashes are verified first. Each page is built IN MEMORY (the
engine's `build_page`, v3 rules) for its candidate symbols and grid lines, then the app's Find
similar function (`src.build.col_image.find_similar`) runs from one click: page 5's example is
the estimator's first drawn column; a DEV page's click is the first estimator mark in (y, x)
order that gives an example (those marks are rings beside the symbols). Writes the private
fixtures/private/eval/p14d/v4/ (refused when it exists) and the local docs/PHASE14D_RESULTS.md;
prints counts only. No database writes; the locked TEST set is never read.
"""

from __future__ import annotations

import collections
import html
import json
import os
import platform
import random
import statistics
import sys
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from measure import p14b_columns as b
from measure.p12c_eval import _font
from measure.prereg import verify
from measure.takeoff.common import PRIVATE, ROOT
from src.build.col_image import Settings, find_similar
from src.build.col_symbols import V3_RULES, find_symbols, symbol_json
from src.build.page import Setup, build_page
from src.build.propose import displayed_size

PREREG = ROOT / "docs" / "PHASE14D_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE14D.sha256"
PREREG_C = ROOT / "docs" / "PHASE14C_PREREGISTRATION.md"
PREREG_C_HASH = ROOT / "worker" / "prereg" / "PHASE14C.sha256"
V3_JSON = PRIVATE / "eval" / "p14c" / "v3" / "columns.json"
OUT_DIR = PRIVATE / "eval" / "p14d" / "v4"
DOC = ROOT / "docs" / "PHASE14D_RESULTS.md"
P5 = "session1 p5"
BUDGET_S = 2.0
PRIMARY = ("V", "I", "V+I")
INFO = ("I @0.6", "V+I @0.6", "I @0.8", "V+I @0.8", "E", "V+E")


def page5_first_drawn() -> int:
    """Index (in the truth order of measure.p14b_columns.load) of the estimator's first drawn
    column: the earliest members.created_at among the 30."""
    ps = json.loads((b.EXPORT / "pieces_final.json").read_text())
    sheets = {s["id"]: s["page_index"] for s in json.loads((b.EXPORT / "sheets.json").read_text())}
    truth = [p for p in ps if sheets.get(p["sheet_id"]) == b.PAGE5 and p["added"]
             and not p["deleted"]]  # fmt: skip
    created = {
        m["id"]: m["created_at"] for m in json.loads((b.EXPORT / "members.json").read_text())
    }
    return min(range(len(truth)), key=lambda k: (created[truth[k]["id"]], k))


def page5_kinds() -> list[str]:
    ps = json.loads((b.EXPORT / "pieces_final.json").read_text())
    sheets = {s["id"]: s["page_index"] for s in json.loads((b.EXPORT / "sheets.json").read_text())}
    keep = [p for p in ps if sheets.get(p["sheet_id"]) == b.PAGE5 and p["added"]]
    return [p["kind"] or "Column" for p in keep if not p["deleted"]]


def prepare(ctx: b.Ctx):
    pg = ctx.pg
    setup = Setup(pg.box, pg.ratio, pg.tos, pg.auto, pg.role,
                  str(pg.inputs.get("crossing_rule") or "family"), pens=pg.view_pens)  # fmt: skip
    pb = build_page(pg.page, setup, pg.text, pg.legend, pg.plan)
    syms = find_symbols(pb.segments, pb.cleaned.keep, pg.box, pb.text, pb.bubbles, pg.ratio, True,
                        rules=V3_RULES)  # fmt: skip
    return [symbol_json(s) for s in syms], [(g.p0, g.p1) for g in pb.grid_lines]


def cols(points: list, source: str) -> list[dict]:
    return [{"pt": list(p), "kind": "Column", "source": source} for p in points]


def configs(res) -> dict[str, list[dict]]:
    return {
        "V": cols([v["centre"] for v in res.vector], "vector"),
        "I": cols([h.centre for h in res.image], "image"),
        "V+I": [{"pt": c["centre"], "kind": "Column", "source": c["source"]} for c in res.combined],
    }


def run() -> dict[str, Any]:
    ctxs = b.load()
    first = page5_first_drawn()
    pages: dict[str, dict] = {}
    for ctx in ctxs:
        syms, grid = prepare(ctx)
        page, crop, ratio = ctx.pg.page, ctx.pg.box, ctx.pg.ratio
        if ctx.key == P5:
            order = [first]
        else:
            order = sorted(range(len(ctx.truth)), key=lambda k: (ctx.truth[k][1], ctx.truth[k][0]))
        res, click, tried = None, None, 0
        for k in order:
            tried += 1
            r = find_similar(page, crop, ratio, tuple(ctx.truth[k]), syms, grid)
            if r.example is not None:
                res, click = r, k
                break
        rec: dict[str, Any] = {"group": ctx.group, "click": click, "clicks_tried": tried,
                               "configs": {}}  # fmt: skip
        if res is None:
            for c in (*PRIMARY, *INFO):
                rec["configs"][c] = {"columns": []}
            rec.update(example=None, runtime_s=None, z=None)
        else:
            rec.update(example=res.example, runtime_s=round(res.runtime_s, 3), z=round(res.z, 3))
            rec["configs"].update(configs(res))
            pt = tuple(ctx.truth[click])
            for t in (0.6, 0.8):
                o = configs(find_similar(page, crop, ratio, pt, syms, grid, Settings(threshold=t)))
                rec["configs"][f"I @{t}"], rec["configs"][f"V+I @{t}"] = o["I"], o["V+I"]
            o = configs(find_similar(page, crop, ratio, pt, syms, grid, Settings(edges=True)))
            rec["configs"]["E"], rec["configs"]["V+E"] = o["I"], o["V+I"]
        for c in rec["configs"]:
            m = {"columns": rec["configs"][c]["columns"] if isinstance(rec["configs"][c], dict)
                 else rec["configs"][c]}  # fmt: skip
            b.measure(ctx, m)
            rec["configs"][c] = m
        # misses (V+I): clean ink near the mark or not
        if res is not None:
            from src.build.col_image import render

            r = render(page, crop, ratio, grid, Settings())
            miss = collections.Counter()
            for k, t in enumerate(ctx.truth):
                if rec["configs"]["V+I"]["truth_matched"][k]:
                    continue
                cx, cy = r.px(tuple(t))
                rad = 12.0 * r.z
                H, W = r.clean.shape
                y0, y1 = max(int(cy - rad), 0), min(int(cy + rad) + 1, H)
                x0, x1 = max(int(cx - rad), 0), min(int(cx + rad) + 1, W)
                ink = r.clean[y0:y1, x0:x1].any() if y1 > y0 and x1 > x0 else False
                miss["ink, no hit" if ink else "no clean ink within 12 pt"] += 1
            rec["miss"] = dict(miss)
        pages[ctx.key] = rec
        print(f"{ctx.key}: done", flush=True)
    names = [*PRIMARY, *INFO]
    dev = [p for k, p in pages.items() if k != P5]
    d: dict[str, Any] = {"pages": pages, "configs": names}
    d["dev"] = {c: b.pooled(dev, c) for c in names}
    rts = [p["runtime_s"] for p in pages.values() if p["runtime_s"] is not None]
    d["runtime"] = {
        "median_s": round(statistics.median(rts), 3) if rts else None,
        "max_s": max(rts) if rts else None,
        "over_budget": [k for k, p in pages.items() if (p["runtime_s"] or 0) > BUDGET_S],
        "cpu": f"{platform.processor() or platform.machine()}, {os.cpu_count()} logical CPUs",
        "opencv_threads": __import__("cv2").getNumThreads(),
    }
    kinds = page5_kinds()
    p5 = pages[P5]["configs"]["V+I"]
    d["page5_truth_kinds"] = {
        k: {"truth": kinds.count(k), "matched": sum(1 for j, kk in enumerate(kinds)
                                                    if kk == k and p5["truth_matched"][j])}
        for k in sorted(set(kinds))
    }  # fmt: skip
    allp = list(pages.values())
    fp = [x for p in allp for x in p["configs"]["V+I"]["columns"] if not x["matched"]]
    d["fp"] = dict(collections.Counter(x["source"] for x in fp))
    tot: collections.Counter[str] = collections.Counter()
    for p in allp:
        tot.update(p.get("miss", {}))
    d["miss"] = dict(tot)
    d["miss_p5"] = pages[P5].get("miss", {})
    d["_ctxs"] = ctxs
    return d


# --- gallery --------------------------------------------------------------------------------------
def gallery(ctxs: list[b.Ctx], pages: dict[str, dict], folder) -> list[dict]:
    folder.mkdir(parents=True)
    v3 = json.loads(V3_JSON.read_text())["pages"]
    changed = []
    for ctx in ctxs:
        x = v3[ctx.key]["configs"]["v3 NEW-click"]["truth_matched"]
        y = pages[ctx.key]["configs"]["V+I"]["truth_matched"]
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
        p1 = b._panel(page, box, v3[key]["configs"]["v3 NEW-click"]["columns"], ctx.truth)
        p2 = b._panel(page, box, pages[key]["configs"]["V+I"]["columns"], ctx.truth)
        gap = 16
        im = Image.new("RGB", (p1.width * 2 + gap * 3, p1.height + 100), (255, 255, 255))
        o = ImageDraw.Draw(im)
        for i, (pi, t) in enumerate(((p1, "before: 14c v3 NEW-click"), (p2, "after: 14d V+I"))):
            xx = gap + i * (p1.width + gap)
            o.text((xx, 6), t, fill=(40, 40, 40), font=_font(22))
            im.paste(pi, (xx, 36))
        status = (
            "newly matched" if pages[key]["configs"]["V+I"]["truth_matched"][k] else "newly lost"
        )
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
        "<!doctype html><meta charset='utf-8'><title>Phase 14d gallery</title>"
        "<style>img{max-width:100%}figure{margin:0 0 24px}</style>" + rows
    )
    return out


# --- report ---------------------------------------------------------------------------------------
_pct = b._pct


def _row(name: str, d: dict) -> str:
    p5 = d["pages"][P5]["configs"][name]
    dv = d["dev"][name]
    return (
        f"| {name} | {p5['ours']} / {p5['theirs']}, {p5['matched']}, {_pct(p5['precision'])},"
        f" {_pct(p5['recall'])}, {'yes' if p5['within'] else 'no'} | {dv['within']},"
        f" {dv['matched']} / {dv['theirs']} (ours {dv['ours']}), {_pct(dv['precision'])},"
        f" {_pct(dv['recall'])} |"
    )


def report(d: dict) -> str:
    L = ["# Phase 14d results (v4): image-based Find similar from one click", ""]
    L.append(
        f"Pre-registration `docs/PHASE14D_PREREGISTRATION.md`, sha256 `{d['prereg'][:16]}...`"
        " (committed before the run). NOT blind: written after v1-v3 and after the 14c"
        " diagnostic of page 5's misses. Page 5's click is the estimator's own first drawn column;"
        " a DEV page's click is an estimator ring beside the symbol (secondary). In memory; no"
        " database writes; DEV data and session 1 only."
    )
    head = ("| Configuration | Page 5: ours / truth, matched, P, R, within 20% |"
            " DEV pages: within 20% (of 10), matched / marks (ours), P, R |")  # fmt: skip
    L += ["", "## Results", "", head, "|---|---|---|"]
    L += [_row(c, d) for c in PRIMARY]
    L += ["", "### Information only (thresholds, edge variant)", "", head, "|---|---|---|"]
    L += [_row(c, d) for c in INFO]
    rt = d["runtime"]
    ex5 = d["pages"][P5]["example"] or {}
    L += [
        "",
        "## Runtime (render + clean + example + search + checks, per click)",
        "",
        f"- Median {rt['median_s']} s, maximum {rt['max_s']} s ({rt['cpu']}; OpenCV threads"
        f" {rt['opencv_threads']}). Budget 2 s per click: "
        + ("all pages PASS." if not rt["over_budget"] else f"FAIL on {rt['over_budget']}."),
        "",
        "## Page 5",
        "",
        f"- Example: {ex5.get('source')} (family {ex5.get('family')}, real size"
        f" {ex5.get('real_in')} in).",
        f"- Truth by kind (V+I): {d['page5_truth_kinds']}; ours are all kind Column (a click"
        " example's kind).",
        f"- Misses (V+I): {d['miss_p5']}.",
        "",
        "## Per page",
        "",
        "| Page | Truth | Example | Clicks tried | Runtime s | "
        + " | ".join(f"{c}: ours (matched)" for c in PRIMARY) + " |",
        "|---|---:|---|---:|---:|" + "---|" * len(PRIMARY),
    ]  # fmt: skip
    for key, p in d["pages"].items():
        cf = p["configs"]
        ex = p["example"]["source"] if p["example"] else "none"
        L.append(
            f"| {key} | {cf['V']['theirs']} | {ex} | {p['clicks_tried']} | {p['runtime_s']} | "
            + " | ".join(f"{cf[c]['ours']} ({cf[c]['matched']})" for c in PRIMARY)
            + " |"
        )
    L += [
        "",
        "## Census (V+I)",
        "",
        f"- False positives by source: {d['fp']}.",
        f"- Misses, all pages: {d['miss']}.",
        "",
        "## Gallery",
        "",
        f"`fixtures/private/eval/p14d/v4/gallery/index.html`: {len(d['gallery'])} crops (before 14c"
        " v3 NEW-click, after 14d V+I).",
    ]
    return "\n".join(L) + "\n"


def main(argv: list[str]) -> None:
    verify(b.PREREG, b.PREREG_HASH)
    verify(b.PREREG2, b.PREREG2_HASH)
    verify(PREREG_C, PREREG_C_HASH)
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:
        DOC.write_text(report(json.loads((OUT_DIR / "columns.json").read_text())))
        return
    if OUT_DIR.exists():
        raise SystemExit(f"{OUT_DIR} exists; a new run needs a new versioned folder")
    print("pre-registration verified:", digest[:12])
    np.random.seed(0)  # nothing random is used; fixed for safety
    d = run()
    ctxs = d.pop("_ctxs")
    d["prereg"] = digest
    d["gallery"] = gallery(ctxs, d["pages"], OUT_DIR / "gallery")
    (OUT_DIR / "columns.json").write_text(json.dumps(d, indent=1, default=float))
    DOC.write_text(report(d))
    for c in d["configs"]:
        p5 = d["pages"][P5]["configs"][c]
        print(c, "page5", p5["ours"], p5["matched"], "dev", d["dev"][c])
    print("runtime", d["runtime"])


if __name__ == "__main__":
    main(sys.argv[1:])
