"""Phase 14b: columns from labels, find similar, symbol families (docs/PHASE14B_PREREGISTRATION.md;
session 1 page 5 and the DEV column-plan pages; read-only).

  PYTHONPATH=. .venv/bin/python -m tools.p14b_columns            # the run
  PYTHONPATH=. .venv/bin/python -m tools.p14b_columns report     # the doc again from the JSON
  PYTHONPATH=. .venv/bin/python -m tools.p14b_columns v2         # the v2 run (PHASE14B2 prereg)

The pre-registration's hash (worker/prereg/PHASE14B.sha256) is verified first; the run stops when
it differs. Each page is rebuilt IN MEMORY with the engine's `build_page` under A, NEW-auto,
NEW-click (a SIMULATED click from estimator data) and NEW-auto+A (information). A must reproduce
the stored column counts (else the run stops). Writes the private
fixtures/private/eval/p14b/columns.json and gallery/, and the local docs/PHASE14B_RESULTS.md;
prints counts only. No database writes; the locked TEST set is never read.
"""

from __future__ import annotations

import collections
import html
import json
import math
import random
import sys
from typing import Any

import pymupdf
from PIL import Image, ImageDraw

from src.build.col_symbols import FAMILIES, STUD_KIND, V2_RULES
from src.build.page import Setup, build_page
from src.build.propose import displayed_size
from src.config import load_config
from src.db import connect
from tools.p12c_eval import _font, _render, one_to_one
from tools.p12c_lib import COLUMN, JOBS, group, project_name, their_pages
from tools.p13a_pen import VERDICT_GROUPS, Page
from tools.prereg import verify
from tools.takeoff.common import PRIVATE, ROOT

PREREG = ROOT / "docs" / "PHASE14B_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE14B.sha256"
OUT = PRIVATE / "eval" / "p14b" / "columns.json"
PREREG2 = ROOT / "docs" / "PHASE14B2_PREREGISTRATION.md"
PREREG2_HASH = ROOT / "worker" / "prereg" / "PHASE14B2.sha256"
OUT2 = PRIVATE / "eval" / "p14b" / "columns_v2.json"
# v2 information configurations: one change alone
INFO2 = {"NEW-auto arrow only": ("NEW-auto", frozenset({"arrow_pt"})),
         "NEW-auto known only": ("NEW-auto", frozenset({"known_only"})),
         "NEW-click arrow only": ("NEW-click", frozenset({"arrow_pt"})),
         "NEW-click known only": ("NEW-click", frozenset({"known_only"}))}  # fmt: skip
GALLERY = PRIVATE / "eval" / "p14b" / "gallery"
DOC = ROOT / "docs" / "PHASE14B_RESULTS.md"
SESSION = "3e829c0b-0e49-45ae-af82-87831c55551b"
EXPORT = PRIVATE / "sessions" / SESSION  # the frozen export v1
PAGE5 = 4  # page index of session 1 page 5
MATCH_PT = 36.0
SEED = 13
NEW = frozenset({"col_labels", "col_similar", "col_real_size"})
CONFIGS = ("A", "NEW-auto", "NEW-click", "NEW-auto+A")
SIMULATED = {"NEW-click"}


class Ctx:
    def __init__(self, key: str, grp: str, pg: Page, truth: list[tuple[float, float]]):
        self.key, self.group, self.pg, self.truth = key, grp, pg, truth


def stored_columns(pg: Page) -> int:
    return sum(1 for p in pg.snap["pieces"] if p.get("type") == "column" and p.get("page"))


def build(ctx: Ctx, cfg: str, rules: frozenset[str] = frozenset()) -> dict[str, Any]:
    pg = ctx.pg
    flags = frozenset() if cfg == "A" else NEW
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
        cols = [{"pt": list(g.centre), "kind": "Column", "family": None, "source": "A",
                 "profile": None, "flag": None, "on_row": False} for g in pb.columns]  # fmt: skip
    else:
        cols = [
            {
                "pt": list(h.symbol.centre),
                "kind": h.kind,
                "family": h.symbol.family,
                "source": h.source,
                "profile": h.profile,
                "flag": h.flag,
                "on_row": h.profile_on_row,
            }
            for h in res.hits
        ]
    rec: dict[str, Any] = {"columns": cols}
    if res is not None:
        rec.update(
            examples=len(res.examples),
            examples_label=sum(e.source == "label" for e in res.examples),
            examples_click=sum(e.source == "click" for e in res.examples),
            callouts=res.callouts,
            callouts_with_leader=res.callouts_with_leader,
            symbols=len(res.symbols),
            families=dict(collections.Counter(s.family for s in res.symbols)),
            note=res.note,
        )
    return rec


def measure(ctx: Ctx, rec: dict[str, Any]) -> None:
    pts = [tuple(c["pt"]) for c in rec["columns"]]
    m = one_to_one(ctx.truth, pts, math.dist, MATCH_PT)
    got = set(m.values())
    for j, c in enumerate(rec["columns"]):
        c["matched"] = j in got
    ours, theirs = len(pts), len(ctx.truth)
    rec.update(
        ours=ours,
        theirs=theirs,
        matched=len(m),
        precision=len(m) / ours if ours else None,
        recall=len(m) / theirs if theirs else None,
        within=abs(ours - theirs) <= 0.2 * theirs if theirs else ours == 0,
        truth_matched=[k in m for k in range(theirs)],
    )


def load() -> list[Ctx]:
    cfg = load_config()
    out: list[Ctx] = []
    docs = []
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        # (a) session 1 page 5: frozen snapshot and truth (v1 export), setup and text read-only
        snaps = json.loads((EXPORT / "build_snapshots.json").read_text())
        sheets = {
            s["id"]: s["page_index"] for s in json.loads((EXPORT / "sheets.json").read_text())
        }
        sn = next(s for s in snaps if sheets[s["sheet_id"]] == PAGE5 and s["before_user_edit"])
        pid = json.loads((EXPORT / "manifest.json").read_text())["project_id"]
        stored = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
        ).fetchone()["stored_path"]
        doc = pymupdf.open(cfg.upload_dir / stored)
        docs.append(doc)
        pg = Page(conn, pid, sn["sheet_id"], sn, doc[PAGE5])
        truth = [
            tuple(p["a"])
            for p in json.loads((EXPORT / "pieces_final.json").read_text())
            if p["sheet_id"] == sn["sheet_id"] and p["added"] and not p["deleted"]
        ]
        out.append(Ctx("session1 p5", "session1", pg, truth))
        # (b) the DEV column-plan pages of the 12c-A / 13c verdict set
        for job in JOBS:
            if group(job) not in VERDICT_GROUPS:
                continue
            pid = str(
                conn.execute(
                    "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                    (project_name(job),),
                ).fetchone()["id"]
            )
            theirs = their_pages(job)
            stored = conn.execute(
                "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
            ).fetchone()["stored_path"]
            rows = conn.execute(
                "SELECT s.id AS sheet_id, s.page_index, b.setup, b.pieces FROM build_snapshots b"
                " JOIN sheets s ON s.id = b.sheet_id WHERE b.project_id = %s ORDER BY s.page_index",
                (pid,),
            ).fetchall()
            doc = pymupdf.open(cfg.upload_dir / stored)
            docs.append(doc)
            for r in rows:
                tag = r["setup"]["evidence"].get("p12c_person_setup") or {}
                if not tag.get("built") or not r["setup"]["built"]:
                    continue
                if r["setup"]["role"]["value"] != "column_plan":
                    continue
                dp = r["page_index"]
                pg = Page(conn, pid, str(r["sheet_id"]), r, doc[dp])
                marks = [(s.x, s.y) for s in theirs[dp].symbols if s.prefix == COLUMN]
                out.append(Ctx(f"{job} p{dp + 1}", group(job), pg, marks))
    return out


def pooled(pages: list[dict], cfg: str) -> dict[str, Any]:
    rs = [p["configs"][cfg] for p in pages]
    m, o, t = (sum(r[k] for r in rs) for k in ("matched", "ours", "theirs"))
    return {
        "pages": len(rs),
        "within": sum(bool(r["within"]) for r in rs),
        "matched": m,
        "ours": o,
        "theirs": t,
        "precision": m / o if o else None,
        "recall": m / t if t else None,
    }


# --- gallery --------------------------------------------------------------------------------------
WIN_PT = 200.0
ZOOM = 3.0


def _panel(page, box, cols, truth) -> Image.Image:
    img = _render(page, box, ZOOM)
    img = Image.blend(img, Image.new("RGB", img.size, (255, 255, 255)), 0.35)
    d = ImageDraw.Draw(img)
    P = lambda x, y: ((x - box[0]) * ZOOM, (y - box[1]) * ZOOM)  # noqa: E731
    for t in truth:
        c = P(*t)
        d.ellipse([c[0] - 14, c[1] - 14, c[0] + 14, c[1] + 14], outline=(0, 90, 255), width=4)
    for c in cols:
        a = P(*c["pt"])
        colour = (230, 120, 0) if c["kind"] == STUD_KIND else (0, 160, 140)
        d.rectangle([a[0] - 9, a[1] - 9, a[0] + 9, a[1] + 9], outline=colour, width=4)
    return img


def gallery(ctxs: list[Ctx], pages: dict[str, dict]) -> list[dict]:
    GALLERY.mkdir(parents=True, exist_ok=True)
    changed = []
    for ctx in ctxs:
        a = pages[ctx.key]["configs"]["A"]["truth_matched"]
        b = pages[ctx.key]["configs"]["NEW-click"]["truth_matched"]
        for k, t in enumerate(ctx.truth):
            if a[k] != b[k]:
                changed.append((ctx.key, round(t[0], 1), round(t[1], 1), k, ctx))
    changed.sort(key=lambda c: (c[0], c[1], c[2]))
    rng = random.Random(SEED)
    p5 = [c for c in changed if c[0] == "session1 p5"]
    pick = rng.sample(p5, 1) if p5 else []
    rest = [c for c in changed if c not in pick]
    pick += rng.sample(rest, min(10 - len(pick), len(rest)))
    out = []
    for n, (key, x, y, k, ctx) in enumerate(pick):
        page = ctx.pg.page
        w, h = displayed_size(page)
        x0 = min(max(x - WIN_PT / 2, 0.0), max(w - WIN_PT, 0.0))
        y0 = min(max(y - WIN_PT / 2, 0.0), max(h - WIN_PT, 0.0))
        box = (x0, y0, min(x0 + WIN_PT, w), min(y0 + WIN_PT, h))
        cfgs = pages[key]["configs"]
        p1 = _panel(page, box, cfgs["A"]["columns"], ctx.truth)
        p2 = _panel(page, box, cfgs["NEW-click"]["columns"], ctx.truth)
        gap = 16
        im = Image.new("RGB", (p1.width * 2 + gap * 3, p1.height + 100), (255, 255, 255))
        o = ImageDraw.Draw(im)
        for i, (pi, t) in enumerate(((p1, "before: A"), (p2, "after: NEW-click (simulated)"))):
            xx = gap + i * (p1.width + gap)
            o.text((xx, 6), t, fill=(40, 40, 40), font=_font(22))
            im.paste(pi, (xx, 36))
        status = "newly matched" if cfgs["NEW-click"]["truth_matched"][k] else "newly lost"
        o.text((gap, im.height - 58), f"{key}: {status}", fill=(20, 20, 20), font=_font(18))
        o.text((gap, im.height - 32), "blue: estimator column, teal: our column, orange: our"
               " stud/post", fill=(90, 90, 90), font=_font(16))  # fmt: skip
        name = f"{n + 1:02d}.png"
        im.save(GALLERY / name, optimize=True)
        out.append({"file": name, "page": key, "status": status})
    rows = "".join(
        f"<figure><img src='{html.escape(g['file'])}'><figcaption>{html.escape(g['page'])}: "
        f"{html.escape(g['status'])}</figcaption></figure>"
        for g in out
    )
    (GALLERY / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>Phase 14b gallery</title>"
        "<style>img{max-width:100%}figure{margin:0 0 24px}</style>" + rows
    )
    return out


# --- report ---------------------------------------------------------------------------------------
def _pct(x: float | None) -> str:
    return "-" if x is None else f"{100 * x:.0f}%"


def report(d: dict) -> str:
    L = ["# Phase 14b results: columns from labels, find similar, symbol families", ""]
    L.append(
        f"Pre-registration `docs/PHASE14B_PREREGISTRATION.md`, sha256 `{d['prereg'][:16]}...`"
        " (committed before the run). Not blind (see the pre-registration). NEW-click is a"
        " SIMULATED click from estimator data, not an automatic result. In memory; no database"
        " writes; DEV data and session 1 only."
    )
    L += ["", "## Summary", ""]
    L.append(
        "| Configuration | Page 5: ours / truth, matched, P, R, within 20% | DEV pages: within 20% (of 10), matched / marks, P, R |"  # noqa: E501
    )
    L.append("|---|---|---|")
    for c in CONFIGS:
        p5 = d["pages"]["session1 p5"]["configs"][c]
        dv = d["dev"][c]
        L.append(
            f"| {c}{' (simulated)' if c in SIMULATED else ''} | {p5['ours']} / {p5['theirs']},"
            f" {p5['matched']}, {_pct(p5['precision'])}, {_pct(p5['recall'])},"
            f" {'yes' if p5['within'] else 'no'} | {dv['within']}, {dv['matched']} /"
            f" {dv['theirs']} (ours {dv['ours']}), {_pct(dv['precision'])},"
            f" {_pct(dv['recall'])} |"
        )
    L += ["", "## Page 5: columns and studs / posts", ""]
    L.append(
        "| Configuration | Columns: ours, matched | Studs/posts: ours, matched | Together: ours, matched |"  # noqa: E501
    )
    L.append("|---|---|---|---|")
    for c in CONFIGS:
        cols = d["pages"]["session1 p5"]["configs"][c]["columns"]
        k = collections.Counter((x["kind"], x["matched"]) for x in cols)

        def n(kind: str, k=k) -> tuple[int, int]:
            return sum(v for (kk, _), v in k.items() if kk == kind), k[(kind, True)]

        a, b = n("Column"), n(STUD_KIND)
        L.append(f"| {c} | {a[0]}, {a[1]} | {b[0]}, {b[1]} | {a[0] + b[0]}, {a[1] + b[1]} |")
    L += ["", "## Per page", ""]
    L.append(
        "| Page | Truth | "
        + " | ".join(f"{c}: ours (matched)" for c in CONFIGS)
        + " | Examples NEW-auto (label) | Callouts / with leader |"
    )
    L.append("|---|---:|" + "---|" * len(CONFIGS) + "---|---|")
    for key, p in d["pages"].items():
        cf = p["configs"]
        na = cf["NEW-auto"]
        L.append(
            f"| {key} | {cf['A']['theirs']} | "
            + " | ".join(f"{cf[c]['ours']} ({cf[c]['matched']})" for c in CONFIGS)
            + f" | {na.get('examples_label', 0)} | {na.get('callouts', 0)} / {na.get('callouts_with_leader', 0)} |"  # noqa: E501
        )
    e = d["examples"]
    L += [
        "",
        "## Examples",
        "",
        f"- Pages with an example from a label (NEW-auto): {e['pages_with_label_example']} of"
        f" {e['pages']}; pages that needed a click: {e['pages_needing_click']} (NEW-click found a"
        f" symbol for the click on {e['pages_click_found']}).",
        f"- Callouts {e['callouts']}, with a leader {e['with_leader']}, giving an example"
        f" {e['label_examples']}.",
        f"- Matches by source (NEW-click): {e['by_source']}.",
        f"- Cross-check flags (NEW-click): {e['flags']}.",
        f"- TYP profile (NEW-click): {e['typ_primary']} matches get the profile under the primary"
        f" rule (view / crop); {e['typ_row']} under the row / column sensitivity.",
        "",
        "## False-positive census (unmatched ours)",
        "",
    ]
    for c in ("NEW-auto", "NEW-click"):
        L.append(f"- {c}: by family {d['fp'][c]['family']}; by source {d['fp'][c]['source']}.")
    L += ["", "## Families of the kept symbols (NEW-auto, all pages)", ""]
    L.append(", ".join(f"{k} {v}" for k, v in d["families"].items()))
    L += [
        "",
        "## Gallery",
        "",
        f"`fixtures/private/eval/p14b/gallery/index.html`: {len(d['gallery'])} crops.",
    ]
    return "\n".join(L) + "\n"


def run(rules: frozenset[str], info: dict[str, tuple[str, frozenset[str]]]) -> dict[str, Any]:
    ctxs = load()
    pages: dict[str, dict] = {}
    for ctx in ctxs:
        pages[ctx.key] = {"group": ctx.group, "configs": {}}
        for c in CONFIGS[:3]:
            rec = build(ctx, c, rules)
            if c == "A" and len(rec["columns"]) != stored_columns(ctx.pg):
                raise SystemExit(f"guard: A differs from the stored column count on {ctx.key}")
            measure(ctx, rec)
            pages[ctx.key]["configs"][c] = rec
        na = pages[ctx.key]["configs"]["NEW-auto"]
        both = dict(na) if na.get("examples") else dict(pages[ctx.key]["configs"]["A"])
        pages[ctx.key]["configs"]["NEW-auto+A"] = both
        for name, (base, r) in info.items():
            rec = build(ctx, base, r)
            measure(ctx, rec)
            pages[ctx.key]["configs"][name] = rec
        print(f"{ctx.key}: built", flush=True)
    names = [*CONFIGS, *info]
    dev = [p for k, p in pages.items() if k != "session1 p5"]
    d: dict[str, Any] = {"pages": pages, "configs": names}
    d["dev"] = {c: pooled(dev, c) for c in names}
    allp = list(pages.values())
    nc = [p["configs"]["NEW-click"] for p in allp]
    na = [p["configs"]["NEW-auto"] for p in allp]
    d["examples"] = {
        "pages": len(allp),
        "pages_with_label_example": sum(1 for r in na if r.get("examples_label")),
        "pages_needing_click": sum(1 for r in na if not r.get("examples_label")),
        "pages_click_found": sum(1 for r in nc if r.get("examples_click")),
        "callouts": sum(r.get("callouts", 0) for r in na),
        "with_leader": sum(r.get("callouts_with_leader", 0) for r in na),
        "label_examples": sum(r.get("examples_label", 0) for r in na),
        "by_source": dict(collections.Counter(c["source"] for r in nc for c in r["columns"])),
        "flags": sum(1 for r in nc for c in r["columns"] if c["flag"]),
        "typ_primary": sum(1 for r in nc for c in r["columns"] if c["source"] == "similar" and c["profile"]),  # noqa: E501
        "typ_row": sum(1 for r in nc for c in r["columns"] if c["source"] == "similar" and c["on_row"]),  # noqa: E501
    }  # fmt: skip
    d["fp"] = {
        c: {
            "family": dict(collections.Counter(
                x["family"] for p in allp for x in p["configs"][c]["columns"] if not x["matched"])),
            "source": dict(collections.Counter(
                x["source"] for p in allp for x in p["configs"][c]["columns"] if not x["matched"])),
        }
        for c in ("NEW-auto", "NEW-click")
    }  # fmt: skip
    fam: collections.Counter[str] = collections.Counter()
    for r in na:
        fam.update(r.get("families", {}))
    d["families"] = {k: fam[k] for k in (*FAMILIES, "unknown") if fam[k]}
    d["_ctxs"] = ctxs
    return d


def report_v2(d: dict) -> str:
    body = report(d).split("\n", 2)[2]  # without the v1 title line
    L = ["", "---", "", "# Phase 14b v2 (two rule fixes, pre-registered after v1)", ""]
    L.append(
        f"`docs/PHASE14B2_PREREGISTRATION.md`, sha256 `{d['prereg'][:16]}...`, committed after the"
        " v1 run and before this run. Designed on the v1 results of these same pages: not blind."
    )
    L += ["", "## One change alone (information)", "",
          "| Configuration | Page 5: ours, matched | DEV: within, matched / marks, P, R |", "|---|---|---|"]  # fmt: skip  # noqa: E501
    for c in INFO2:
        p5 = d["pages"]["session1 p5"]["configs"][c]
        dv = d["dev"][c]
        L.append(
            f"| {c} | {p5['ours']}, {p5['matched']} | {dv['within']}, {dv['matched']} /"
            f" {dv['theirs']} (ours {dv['ours']}), {_pct(dv['precision'])}, {_pct(dv['recall'])} |"
        )
    return "\n".join(L) + "\n" + body


def main(argv: list[str]) -> None:
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:
        v1 = json.loads(OUT.read_text())
        v2 = json.loads(OUT2.read_text()) if OUT2.is_file() else None
        DOC.write_text(report(v1) + (report_v2(v2) if v2 else ""))
        return
    print("pre-registration verified:", digest[:12])
    if argv[:1] == ["v2"]:
        d2 = verify(PREREG2, PREREG2_HASH)
        print("v2 pre-registration verified:", d2[:12])
        d = run(V2_RULES, INFO2)
        ctxs = d.pop("_ctxs")
        d["prereg"] = d2
        d["gallery"] = gallery(ctxs, d["pages"])
        OUT2.write_text(json.dumps(d, indent=1))
        DOC.write_text(report(json.loads(OUT.read_text())) + report_v2(d))
        for c in d["configs"]:
            p5 = d["pages"]["session1 p5"]["configs"][c]
            print(c, "page5", p5["ours"], p5["matched"], "dev", d["dev"][c])
        return
    d = run(frozenset(), {})
    ctxs = d.pop("_ctxs")
    d["prereg"] = digest
    d["gallery"] = gallery(ctxs, d["pages"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(d, indent=1))
    DOC.write_text(report(d))
    for c in CONFIGS:
        p5 = d["pages"]["session1 p5"]["configs"][c]
        print(c, "page5", p5["ours"], p5["matched"], "dev", d["dev"][c])


if __name__ == "__main__":
    main(sys.argv[1:])
