"""Phase 7 Part C driver: run the grammar on the pages of one side, score it, draw overlays.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_cgrammar_run run --set dev [--name rev0]
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_cgrammar_run run --set held-out
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_cgrammar_run overlays --set dev|held-out
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_cgrammar_run report --set dev|held-out [--name x]

`--set held-out` refuses unless the tag `phase7-grammar-frozen` exists, the grammar files are
unchanged since that tag, and no held-out run is recorded (lock file). Our side is the PDF the API
stored for the job's Phase 6b project (database lookup); symbols and the page map are Phase 6b's.
Private outputs go under fixtures/private (git-ignored). Counts only are printed.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import pickle
import random
import subprocess
import time

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

from src.linking.labels import page_labels
from src.review.auto_run import whole_sheet_box
from tools.takeoff import phase7_grammar as G
from tools.takeoff import phase7_lib as L
from tools.takeoff import phase7_parse as P
from tools.takeoff.common import PRIVATE, ROOT, TAKEOFFS
from tools.takeoff.phase6b_lib import verdict
from tools.takeoff.phase6b_study import their_symbols
from tools.takeoff.phase6c_census import page_plan
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

SPLIT = TAKEOFFS / "phase7_split.json"
CACHE = TAKEOFFS / "phase7_cache"
LOCK = TAKEOFFS / "phase7_heldout.lock"
SHOTS = PRIVATE / "shots" / "phase7"
FROZEN_TAG = "phase7-grammar-frozen"
FROZEN_FILES = [
    "worker/tools/takeoff/phase7_grammar.py",
    "worker/tools/takeoff/phase7_parse.py",
    "worker/tools/takeoff/phase7_lib.py",
    "worker/tools/takeoff/phase7_cgrammar_run.py",
]
LARGEST = {"dev": "job-012", "held-out": "job-015"}
OVERLAY_SEED = 7301
OVERLAY_MIN_SYMBOLS = 20
SETS = ("linear", "linear_all", "linear_2", "columns", "columns_all", "combined", "combined_braces")
REASONS = (
    "matched",
    "1 outside the view box",
    "2 no parsed primitive within 24 pt",
    "3 only consumed primitives within 24 pt",
    "4 an excluded candidate within 24 pt",
    "5 a main piece within 12 pt, taken by another symbol",
    "6 a main piece 12 to 24 pt away",
    "7 a main piece 24 to 36 pt away",
    "8 other",
)


# ---- guard ----------------------------------------------------------------------------------------
def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=False
    ).stdout.strip()


def check_heldout_allowed() -> None:
    if not git("rev-parse", "--verify", "--quiet", f"refs/tags/{FROZEN_TAG}"):
        raise SystemExit(f"refused: the tag {FROZEN_TAG} does not exist (freeze and tag first)")
    changed = git("diff", "--name-only", FROZEN_TAG, "--", *FROZEN_FILES)
    if changed:
        raise SystemExit(f"refused: grammar files changed since the tag: {changed.split()}")
    if LOCK.exists():
        raise SystemExit(f"refused: a held-out run is already recorded ({LOCK.name})")


def code_hash() -> str:
    h = hashlib.sha1()
    for f in FROZEN_FILES:
        h.update((ROOT / f).read_bytes())
    return h.hexdigest()[:12]


def parse_hash() -> str:
    return hashlib.sha1((ROOT / FROZEN_FILES[1]).read_bytes()).hexdigest()[:10]


# ---- pages ----------------------------------------------------------------------------------------
def pages_of(side: str) -> list[dict]:
    split = json.loads(SPLIT.read_text())
    return [p for p in page_plan(False) if split[p["job"]] == side]


class Loader:
    def __init__(self) -> None:
        self.conn = connect()
        self.runs = json.loads(RUNS.read_text())
        self.docs: dict[str, pymupdf.Document] = {}

    def doc(self, job: str) -> pymupdf.Document:
        if job not in self.docs:
            self.docs[job] = pymupdf.open(stored_pdf(self.conn, self.runs[job]["project_id"]))
        return self.docs[job]

    def page(self, job: str, dp: int):
        """(page, parse, words, box, labels) with the parse cached on disk (keyed by parser code)."""
        doc = self.doc(job)
        page = doc[dp]
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"{job}_{dp}_{parse_hash()}.pkl"
        if path.exists():
            parse, words = pickle.loads(path.read_bytes())
        else:
            parse = P.parse_page(page, doc)
            words = G.words_of(page)
            path.write_bytes(pickle.dumps((parse, words)))
        size = (page.rect.width, page.rect.height)
        b = whole_sheet_box(*size)
        box = (b["x0"], b["y0"], b["x1"], b["y1"])
        labels = [
            (lb.key, tuple(lb.bbox))
            for lb in page_labels(page, f"{job}-{dp}", set())
            if box[0] <= (lb.bbox[0] + lb.bbox[2]) / 2 <= box[2]
            and box[1] <= (lb.bbox[1] + lb.bbox[3]) / 2 <= box[3]
        ]
        return page, parse, words, box, labels


# ---- pieces as geometry ---------------------------------------------------------------------------
def span_geom(s: dict) -> dict:
    return {"k": "poly", "pts": [list(s["p0"]), list(s["p1"])]}


def glyph_geom(g: dict) -> dict:
    return {"k": "rect", "r": list(g["box"])}


def brace_geom(b: dict) -> dict:
    return {"k": "point", "p": list(b["pt"])}


def piece_sets(pp: G.PagePieces) -> dict[str, list[dict]]:
    lin = [("span", span_geom(s)) for s in pp.main_spans(1)]
    lin_all = [("span", span_geom(s)) for s in pp.spans]
    lin_2 = [("span", span_geom(s)) for s in pp.main_spans(2)]
    col = [("column", glyph_geom(g)) for g in pp.main_glyphs()]
    col_all = [("column", glyph_geom(g)) for g in pp.glyphs]
    br = [("brace", brace_geom(b)) for b in pp.braces]
    pack = lambda xs: [{"type": t, "geom": g} for t, g in xs]  # noqa: E731
    return {
        "linear": pack(lin),
        "linear_all": pack(lin_all),
        "linear_2": pack(lin_2),
        "columns": pack(col),
        "columns_all": pack(col_all),
        "combined": pack(lin + col),
        "combined_braces": pack(lin + col + br),
    }


def counts(d: np.ndarray) -> dict[int, int]:
    return {int(r): len(L.hungarian_pairs(d, r)) for r in L.RADII}


# ---- miss reasons ---------------------------------------------------------------------------------
def reasons_for(
    xy: np.ndarray,
    box: G.Box,
    parse: P.PageParse,
    pp: G.PagePieces,
    d_main: np.ndarray,
    pairs12: list[tuple[int, int, float]],
) -> tuple[list[str], dict[str, int]]:
    n = len(xy)
    matched = {i for i, _, _ in pairs12}
    consumed = set().union(*pp.consumed_segs.values()) if pp.consumed_segs else set()
    glyph_shapes_main = {sid for g in pp.main_glyphs() for sid in g["shape_ids"]}
    bubble_shapes = {b["shape"] for b in pp.bubbles}
    shape_boxes = (
        np.array([s.bbox for s in parse.shapes], dtype=float) if parse.shapes else np.zeros((0, 4))
    )
    # distances from every symbol to every segment, shape box and excluded candidate (chunked)
    near_seg: list[np.ndarray] = []
    near_shape: list[np.ndarray] = []
    for a in range(0, n, 40):
        chunk = xy[a : a + 40]
        if len(parse.seg):
            dm = L.segment_matrix(chunk, parse.seg)
            near_seg.extend(np.nonzero(dm[k] <= 24.0)[0] for k in range(len(chunk)))
        else:
            near_seg.extend(np.zeros(0, dtype=int) for _ in range(len(chunk)))
        if len(shape_boxes):
            dm = L.rect_matrix(chunk, shape_boxes)
            near_shape.extend(np.nonzero(dm[k] <= 24.0)[0] for k in range(len(chunk)))
        else:
            near_shape.extend(np.zeros(0, dtype=int) for _ in range(len(chunk)))
    cand_geoms = [span_geom(s) for s in pp.spans if s["n_supports"] == 0]
    cand_geoms += [glyph_geom(g) for g in pp.glyphs if not g["main"]]
    d_cand = L.distance_matrix([tuple(p) for p in xy], cand_geoms) if cand_geoms else None
    shape_segs: dict[int, list[int]] = collections.defaultdict(list)
    for i, sid in enumerate(parse.seg_shape):
        shape_segs[int(sid)].append(i)
    out: list[str] = []
    flags = collections.Counter()
    for i in range(n):
        x, y = xy[i]
        ns, nh = near_seg[i], near_shape[i]
        dmain = float(d_main[i].min()) if d_main.shape[1] else np.inf
        cand24 = bool(d_cand is not None and d_cand[i].min() <= 24.0)
        seg_ok = all(int(k) in consumed for k in ns)
        shape_ok = all(
            int(k) in bubble_shapes
            or (
                int(k) not in glyph_shapes_main
                and shape_segs.get(int(k))
                and all(j in consumed for j in shape_segs[int(k)])
            )
            for k in nh
        )
        any_prim = len(ns) > 0 or len(nh) > 0
        flags["near_any_primitive_24"] += any_prim
        flags["near_main_piece_12"] += dmain <= 12.0
        flags["near_main_piece_24"] += dmain <= 24.0
        flags["near_excluded_candidate_24"] += cand24
        if i in matched:
            out.append(REASONS[0])
        elif not G.in_box(x, y, box):
            out.append(REASONS[1])
        elif not any_prim:
            out.append(REASONS[2])
        elif seg_ok and shape_ok and not cand24 and dmain > 24.0:
            out.append(REASONS[3])
        elif cand24:
            out.append(REASONS[4])
        elif dmain <= 12.0:
            out.append(REASONS[5])
        elif dmain <= 24.0:
            out.append(REASONS[6])
        elif dmain <= 36.0:
            out.append(REASONS[7])
        else:
            out.append(REASONS[8])
    return out, dict(flags)


# ---- one page -------------------------------------------------------------------------------------
def run_page(ld: Loader, item: dict, idx: int) -> dict:
    t0 = time.time()
    page, parse, words, box, labels = ld.page(item["job"], item["dp"])
    with pymupdf.open(TAKEOFFS / item["file"]) as tdoc:
        syms = their_symbols(tdoc[item["tp"]])
    xy = np.array([(s["x"], s["y"]) for s in syms], dtype=float)
    pp = G.run_page(parse, words, box, labels)
    G.check_evidence(pp)
    sets = piece_sets(pp)
    rec: dict = {
        "job": item["job"],
        "dp": item["dp"],
        "theirs": len(syms),
        "sets": {},
        "stats": {
            "prims": len(parse.prims),
            "segs": int(len(parse.seg)),
            "forms": parse.n_forms,
            "bubbles": len(pp.bubbles),
            "grid_lines": len(pp.grid_lines),
            "intersections": len(pp.intersections),
            "has_grid": pp.has_grid,
            "glyphs": len(pp.glyphs),
            "glyphs_main": len(pp.main_glyphs()),
            "spans": len(pp.spans),
            "spans_supported": len(pp.main_spans(1)),
            "spans_two_ends": len(pp.main_spans(2)),
            "braces": len(pp.braces),
            "consumed": pp.consumed,
        },
    }
    for name in SETS:
        geoms = [p["geom"] for p in sets[name]]
        d = L.distance_matrix([tuple(p) for p in xy], geoms) if geoms else np.zeros((len(xy), 0))
        rec["sets"][name] = {"pieces": len(geoms), "matched": counts(d)}
        if name == "combined":
            pairs12 = L.hungarian_pairs(d, 12.0)
            kinds = [sets[name][j]["type"] for _, j, _ in pairs12]
            rec["matched_by_type_12"] = dict(collections.Counter(kinds))
            reasons, flags = reasons_for(xy, box, parse, pp, d, pairs12)
            rec["reasons"] = dict(collections.Counter(reasons))
            rec["flags"] = flags
            # chance controls on the combined set
            geoms_c = geoms
            ctl = {}
            for kind, seed0 in (
                ("uniform", L.CONTROL_SEED_UNIFORM),
                ("displaced", L.CONTROL_SEED_DISPLACED),
            ):
                reps = []
                for k in range(L.CONTROL_REPLICATES):
                    rng = random.Random(seed0 * 100000 + k * 1000 + idx)
                    pts = (
                        L.uniform_points(box, len(xy), rng)
                        if kind == "uniform"
                        else L.displaced_points([tuple(p) for p in xy], box, rng)
                    )
                    dc = L.distance_matrix(pts, geoms_c) if geoms_c else np.zeros((len(pts), 0))
                    reps.append(counts(dc))
                ctl[kind] = reps
            rec["controls"] = ctl
    rec["seconds"] = round(time.time() - t0, 2)
    return rec


# ---- aggregation ----------------------------------------------------------------------------------
def tally(rows: list[dict], name: str) -> dict:
    theirs = sum(r["theirs"] for r in rows)
    pieces = sum(r["sets"][name]["pieces"] for r in rows)
    out: dict = {"pages": len(rows), "theirs": theirs, "pieces": pieces}
    for r in L.RADII:
        m = sum(x["sets"][name]["matched"][int(r)] for x in rows)
        p, rc, f = L.prf(m, pieces, theirs)
        out[f"m{int(r)}"], out[f"P{int(r)}"], out[f"R{int(r)}"], out[f"F{int(r)}"] = m, p, rc, f
    n = len(rows) or 1
    ours = [x["sets"][name]["pieces"] for x in rows]
    th = [x["theirs"] for x in rows]
    out["equal"] = sum(a == b for a, b in zip(ours, th, strict=True)) / n
    out["within1"] = sum(abs(a - b) <= 1 for a, b in zip(ours, th, strict=True)) / n
    out["within20"] = (
        sum(b >= 1 and abs(a - b) <= 0.2 * b for a, b in zip(ours, th, strict=True)) / n
    )
    out["verdict"] = verdict(out["within1"], out["P12"], out["R12"])
    return out


def control_tally(rows: list[dict], kind: str) -> dict:
    theirs = sum(r["theirs"] for r in rows)
    pieces = sum(r["sets"]["combined"]["pieces"] for r in rows)
    res = {}
    for r in L.RADII:
        ps, rs = [], []
        for k in range(L.CONTROL_REPLICATES):
            m = sum(x["controls"][kind][k][int(r)] for x in rows)
            p, rc, _ = L.prf(m, pieces, theirs)
            ps.append(p)
            rs.append(rc)
        ok = [v for v in ps if v is not None]
        res[int(r)] = {
            "P": [float(np.mean(ok)), float(np.std(ok))] if ok else [None, None],
            "R": [float(np.mean(rs)), float(np.std(rs))],
        }
    return res


def summarise(rows: list[dict], side: str) -> dict:
    out: dict = {"all": {}, "without_largest": {}}
    for scope, sel in (
        ("all", rows),
        ("without_largest", [r for r in rows if r["job"] != LARGEST[side]]),
    ):
        out[scope] = {
            "sets": {name: tally(sel, name) for name in SETS},
            "controls": {k: control_tally(sel, k) for k in ("uniform", "displaced")},
            "reasons": dict(
                sum((collections.Counter(r["reasons"]) for r in sel), collections.Counter())
            ),
            "flags": dict(
                sum((collections.Counter(r["flags"]) for r in sel), collections.Counter())
            ),
            "matched_by_type_12": dict(
                sum(
                    (collections.Counter(r["matched_by_type_12"]) for r in sel),
                    collections.Counter(),
                )
            ),
            "stats": {
                k: sum(r["stats"][k] for r in sel)
                for k in (
                    "prims",
                    "segs",
                    "forms",
                    "bubbles",
                    "grid_lines",
                    "glyphs",
                    "glyphs_main",
                    "spans",
                    "spans_supported",
                    "spans_two_ends",
                    "braces",
                )
            },
            "pages_with_grid": sum(r["stats"]["has_grid"] for r in sel),
            "consumed": dict(
                sum(
                    (collections.Counter(r["stats"]["consumed"]) for r in sel),
                    collections.Counter(),
                )
            ),
        }
    jobs = sorted({r["job"] for r in rows})
    out["per_job"] = {j: tally([r for r in rows if r["job"] == j], "combined") for j in jobs}
    return out


def line(name: str, t: dict) -> str:
    f = lambda v: " none" if v is None else f"{v:.3f}"  # noqa: E731
    return (
        f"{name:16s} pcs={t['pieces']:6d} m12={t['m12']:5d} P={f(t['P12'])} R={f(t['R12'])} F={f(t['F12'])}"
        f" | 24: P={f(t['P24'])} R={f(t['R24'])} | 36: P={f(t['P36'])} R={f(t['R36'])}"
        f" | eq={t['equal']:.2f} w1={t['within1']:.2f} w20={t['within20']:.2f} {t['verdict']}"
    )


def show(summary: dict) -> None:
    for scope in ("all", "without_largest"):
        s = summary[scope]
        print(f"== {scope}")
        for name in SETS:
            print(line(name, s["sets"][name]))
        for kind in ("uniform", "displaced"):
            c = s["controls"][kind]
            print(
                f"control {kind:9s} 12 pt: P={c[12]['P'][0]:.3f} R={c[12]['R'][0]:.3f}"
                f" | 24: P={c[24]['P'][0]:.3f} R={c[24]['R'][0]:.3f}"
            )
        print("matched by type at 12:", s["matched_by_type_12"], "stats:", s["stats"])
        print("consumed:", s["consumed"], "pages with grid:", s["pages_with_grid"])
        tot = sum(s["reasons"].values())
        for r in REASONS:
            n = s["reasons"].get(r, 0)
            print(f"  {r:60s} {n:6d} {100 * n / tot:5.1f}%")
        print("  flags (overlapping):", s["flags"])


# ---- commands -------------------------------------------------------------------------------------
def cmd_run(side: str, name: str) -> None:
    if side == "held-out":
        check_heldout_allowed()
    items = pages_of(side)
    ld = Loader()
    rows = []
    t0 = time.time()
    for i, item in enumerate(items):
        rows.append(run_page(ld, item, i))
        print(i + 1, len(items), item["job"], item["dp"], rows[-1]["seconds"], flush=True)
    summary = summarise(rows, side)
    out = TAKEOFFS / f"phase7_c_{side}_{name}.json"
    out.write_text(
        json.dumps(
            {"side": side, "code": code_hash(), "name": name, "rows": rows, "summary": summary},
            default=list,
        )
    )
    if side == "held-out":
        LOCK.write_text(json.dumps({"code": code_hash(), "tag": git("rev-parse", FROZEN_TAG)}))
    print("seconds", round(time.time() - t0), "written", out.name)
    show(summary)


def cmd_report(side: str, name: str) -> None:
    data = json.loads((TAKEOFFS / f"phase7_c_{side}_{name}.json").read_text())
    show(data["summary"])


def draw_overlay(ld: Loader, item: dict, out_path) -> None:
    page, parse, words, box, labels = ld.page(item["job"], item["dp"])
    with pymupdf.open(TAKEOFFS / item["file"]) as tdoc:
        syms = their_symbols(tdoc[item["tp"]])
    pp = G.run_page(parse, words, box, labels)
    z = min(2.0, 2200.0 / max(page.rect.width, page.rect.height))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    d = ImageDraw.Draw(img, "RGBA")

    def px(p):
        return (p[0] * z, p[1] * z)

    for gl in pp.grid_lines:
        d.line([px(gl["p0"]), px(gl["p1"])], fill=(150, 60, 200, 160), width=2)
    for b in pp.bubbles:
        cx, cy = px(b["centre"])
        r = b["radius"] * z
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(150, 60, 200, 255), width=3)
    for s in pp.spans:
        ok = s["n_supports"] >= 1
        col = (20, 70, 255, 230) if ok else (140, 140, 140, 150)
        d.line([px(s["p0"]), px(s["p1"])], fill=col, width=3 if ok else 2)
        for k, p in enumerate((s["p0"], s["p1"])):
            if s["supports"][k] is not None:
                x, y = px(p)
                d.rectangle([x - 3, y - 3, x + 3, y + 3], fill=(255, 140, 0, 255))
    for g in pp.glyphs:
        b = [g["box"][0] * z - 3, g["box"][1] * z - 3, g["box"][2] * z + 3, g["box"][3] * z + 3]
        d.rectangle(b, outline=(0, 160, 0, 255) if g["main"] else (140, 140, 140, 220), width=3)
    for br in pp.braces:
        x, y = px(br["pt"])
        d.line([x - 6, y - 6, x + 6, y + 6], fill=(220, 180, 0, 255), width=3)
        d.line([x - 6, y + 6, x + 6, y - 6], fill=(220, 180, 0, 255), width=3)
    for s in syms:
        x, y = px((s["x"], s["y"]))
        r = 9 * z + 4
        d.ellipse([x - r, y - r, x + r, y + r], outline=(230, 0, 0, 255), width=3)
    d.rectangle([0, 0, img.width, 18], fill=(255, 255, 255, 255))
    d.text(
        (4, 3),
        "blue: supported span   grey: unsupported span / off-grid glyph   orange: support   green box: "
        "column glyph   purple: grid line, bubble   yellow X: brace sign   red ring: estimator symbol",
        fill=(0, 0, 0, 255),
    )
    img.save(out_path)


def overlay_pages(side: str) -> list[dict]:
    items = pages_of(side)
    eligible: dict[str, list[dict]] = collections.defaultdict(list)
    for it in items:
        with pymupdf.open(TAKEOFFS / it["file"]) as t:
            n = len(their_symbols(t[it["tp"]]))
        if n >= OVERLAY_MIN_SYMBOLS:
            eligible[it["job"]].append(it)
    rng = random.Random(OVERLAY_SEED + (0 if side == "dev" else 1))
    jobs = sorted(eligible)
    rng.shuffle(jobs)
    picked = []
    for j in jobs[:6]:
        pages = sorted(eligible[j], key=lambda it: it["dp"])
        picked.append(rng.choice(pages))
    return picked


def cmd_overlays(side: str) -> None:
    if side == "held-out":
        if not LOCK.exists():
            raise SystemExit(
                "refused: the held-out overlays are drawn after the single held-out run"
            )
    SHOTS.mkdir(parents=True, exist_ok=True)
    ld = Loader()
    index = []
    for k, item in enumerate(overlay_pages(side), 1):
        path = SHOTS / f"{side}-{k:02d}.png"
        draw_overlay(ld, item, path)
        index.append({"file": path.name, "job": item["job"], "page": item["dp"] + 1})
        print(path.name, item["job"], item["dp"] + 1, flush=True)
    (SHOTS / f"INDEX-{side}.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "report", "overlays"])
    ap.add_argument("--set", dest="side", choices=["dev", "held-out"], required=True)
    ap.add_argument("--name", default="rev0")
    a = ap.parse_args()
    {
        "run": lambda: cmd_run(a.side, a.name),
        "report": lambda: cmd_report(a.side, a.name),
        "overlays": lambda: cmd_overlays(a.side),
    }[a.cmd]()
