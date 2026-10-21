"""Phase 12c-A (docs/PHASE12C_PLAN.md sections 4 to 6): measures, failure table and gallery.

  PYTHONPATH=. .venv/bin/python -m tools.p12c_eval [--gallery]

Read-only on the database. Reads the frozen system version of each `p12c-<job>` copy and the
estimators' markups (tools/p12c_lib.py). Writes fixtures/private/eval/p12c/eval.json (and with
--gallery the 27 three-panel images there). Prints counts only.
"""

from __future__ import annotations

import collections
import json
import math
import statistics
import sys
from typing import Any

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from src.build.propose import displayed_size
from src.config import load_config
from src.db import connect
from src.linking.lines import page_lines
from src.linking.structural import lines_in_box
from tools.p12c_lib import BEAM, COLUMN, JOBS, TheirPage, group, project_name, their_pages
from tools.takeoff.common import PRIVATE, TAKEOFFS

OUT = PRIVATE / "eval" / "p12c"
RADII = (36.0, 24.0, 12.0)  # primary first
PRIMARY = RADII[0]
WITHIN = 0.2
PEN_MIN_IN = 24.0  # pen check: lines of at least 24 real inches
# joist-like run
RUN_MIN = 4
RUN_ANGLE_DEG = 2.0
RUN_LENGTH_TOL = 0.10
RUN_SPACING_TOL = 0.10
RUN_MAX_SPACING_IN = 96.0
ROW_MERGE_PT = 2.0  # pieces at the same offset are one row
# over-split
COLLINEAR_DEG = 2.0
COLLINEAR_OFFSET_PT = 2.0
END_GAP_PT = 6.0
# length check
LEN_ANGLE_DEG = 5.0
LEN_OVERLAP = 0.5
LEN_DIST_PT = 12.0
PT_TO_MM = 25.4 / 72
# gallery
CROP_PT = 600.0
CASES_PER_ROW = 3
ROWS = [
    "wrong_pen",
    "marked_beam_no_piece",
    "joist_taken_as_beam",
    "over_split",
    "under_split",
    "extra_non_steel",
    "columns_missed",
    "columns_extra",
    "unsized",
]

Pt = tuple[float, float]
Seg = tuple[float, float, float, float]


# ---- geometry ---------------------------------------------------------------------------------
def seg_dist(p: Pt, s: Seg) -> float:
    ax, ay, bx, by = s
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def angle(s: Seg) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def seg_len(s: Seg) -> float:
    return math.hypot(s[2] - s[0], s[3] - s[1])


def mid(s: Seg) -> Pt:
    return ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)


def one_to_one(points: list[Pt], targets: list[Any], dist, radius: float) -> dict[int, int]:
    """Symbol index -> target index: all pairs within the radius, nearest first, each used once."""
    pairs = sorted(
        (d, i, j)
        for i, p in enumerate(points)
        for j, t in enumerate(targets)
        if (d := dist(p, t)) <= radius
    )
    used_i: set[int] = set()
    used_j: set[int] = set()
    out = {}
    for _d, i, j in pairs:
        if i in used_i or j in used_j:
            continue
        used_i.add(i)
        used_j.add(j)
        out[i] = j
    return out


def joist_like(segs: list[Seg], ratio: float) -> set[int]:
    """Pieces in a run of at least 4 parallel pieces of similar length at an even spacing."""
    max_gap = RUN_MAX_SPACING_IN * 72.0 / ratio
    out: set[int] = set()
    for r, ref in enumerate(segs):
        a, L = angle(ref), seg_len(ref)
        if L == 0:
            continue
        ux, uy = (ref[2] - ref[0]) / L, (ref[3] - ref[1]) / L
        nx, ny = -uy, ux
        mates = [
            j
            for j, s in enumerate(segs)
            if angle_diff(angle(s), a) <= RUN_ANGLE_DEG
            and abs(seg_len(s) - L) <= RUN_LENGTH_TOL * L
        ]
        offs = sorted(((mid(segs[j])[0] * nx + mid(segs[j])[1] * ny), j) for j in mates)
        rows: list[tuple[float, list[int]]] = []
        for o, j in offs:
            if rows and o - rows[-1][0] <= ROW_MERGE_PT:
                rows[-1][1].append(j)
            else:
                rows.append((o, [j]))
        k = 0
        while k < len(rows) - 1:
            g0 = rows[k + 1][0] - rows[k][0]
            if g0 > max_gap:
                k += 1
                continue
            e = k + 1
            while e + 1 < len(rows) and abs((rows[e + 1][0] - rows[e][0]) - g0) <= (
                RUN_SPACING_TOL * g0
            ):
                e += 1
            if e - k + 1 >= RUN_MIN and r in {j for _, js in rows[k : e + 1] for j in js}:
                out.update(j for _, js in rows[k : e + 1] for j in js)
            k = e
    return out


def collinear_end_to_end(a: Seg, b: Seg) -> bool:
    if angle_diff(angle(a), angle(b)) > COLLINEAR_DEG:
        return False
    L = seg_len(a)
    if L == 0:
        return False
    nx, ny = -(a[3] - a[1]) / L, (a[2] - a[0]) / L
    off = max(
        abs((b[0] - a[0]) * nx + (b[1] - a[1]) * ny), abs((b[2] - a[0]) * nx + (b[3] - a[1]) * ny)
    )
    if off > COLLINEAR_OFFSET_PT:
        return False
    ends_a, ends_b = ((a[0], a[1]), (a[2], a[3])), ((b[0], b[1]), (b[2], b[3]))
    return min(math.dist(p, q) for p in ends_a for q in ends_b) <= END_GAP_PT


def pct(o: int, t: int) -> float | None:
    return None if not t else (o - t) / t


def within(o: int, t: int) -> bool:
    return abs(o - t) <= WITHIN * t


# ---- one page -----------------------------------------------------------------------------------
def page_eval(snap: dict, theirs: TheirPage, page: pymupdf.Page, dups: set[str]) -> dict[str, Any]:
    setup = snap["setup"]
    role = setup["role"]["value"]
    ratio = float(setup["scale"]["value"])
    pen = setup["pen_class"]["value"]
    pieces = [p for p in snap["pieces"] if p.get("page")]
    beams = [p for p in pieces if p["kind"] == "Beams" and p["type"] != "column"]
    cols = [p for p in pieces if p["type"] == "column"]
    bseg: list[Seg] = [tuple(p["page"]) for p in beams]  # type: ignore[misc]
    cpt: list[Pt] = [(p["page"][0], p["page"][1]) for p in cols]
    bsym = [(s.x, s.y) for s in theirs.symbols if s.prefix == BEAM]
    csym = [(s.x, s.y) for s in theirs.symbols if s.prefix == COLUMN]
    other = sum(1 for s in theirs.symbols if s.prefix not in (BEAM, COLUMN))
    rec: dict[str, Any] = {
        "role": role,
        "scale_source": setup["evidence"].get("p12c_person_setup", {}).get("scale_source"),
        "pen": pen,
        "ours_beams": len(beams),
        "ours_columns": len(cols),
        "ours_columns_dup": sum(p["member_id"] in dups for p in cols),
        "ours_joists": sum(p["kind"] == "Joist" for p in pieces),
        "theirs_B": len(bsym),
        "theirs_C": len(csym),
        "theirs_other": other,
    }
    if role == "framing":
        rec["beams_err"] = pct(len(beams), len(bsym))
        rec["beams_within"] = within(len(beams), len(bsym))
    else:
        rec["columns_err"] = pct(len(cols), len(csym))
        rec["columns_within"] = within(len(cols), len(csym))

    # pen check (framing): nearest line of at least 24 real inches to each B symbol
    pens: dict[float, dict[str, Any]] = {}
    if role == "framing":
        c = setup["crop"]["value"]
        box = (c["x0"], c["y0"], c["x1"], c["y1"])
        min_pt = PEN_MIN_IN * 72.0 / ratio
        lines = [
            ln
            for ln in lines_in_box(page_lines(page), box, displayed_size(page))
            if ln.length >= min_pt
        ]
        for r in RADII:
            near = collections.Counter()
            for p in bsym:
                best = min(
                    ((seg_dist(p, (ln.x0, ln.y0, ln.x1, ln.y1)), ln.klass) for ln in lines),
                    default=None,
                )
                near[best[1] if best and best[0] <= r else None] += 1
            classes = {k: v for k, v in near.items() if k is not None}
            right = max(sorted(classes), key=lambda k: classes[k]) if classes else None
            pens[r] = {
                "ours": near.get(pen, 0) if pen else 0,
                "other": sum(v for k, v in classes.items() if k != pen),
                "none": near.get(None, 0),
                "right_pen_is_ours": right is not None and right == pen,
                "right_pen_exists": right is not None,
            }
    rec["pen_check"] = {str(int(r)): v for r, v in pens.items()}

    # failure rows per radius, with cases (for the gallery) at the primary radius
    rows: dict[str, dict[str, int]] = {}
    cases: dict[str, list[Pt]] = {k: [] for k in ROWS}
    jl = joist_like(bseg, ratio) if role == "framing" else set()
    for r in RADII:
        n = dict.fromkeys(ROWS, 0)
        cs: dict[str, list[Pt]] = {k: [] for k in ROWS}
        if role == "framing":
            m = one_to_one(bsym, bseg, seg_dist, r)
            pc = pens[r]
            if pc["right_pen_exists"] and not pc["right_pen_is_ours"]:
                n["wrong_pen"] = len(bsym)
                cs["wrong_pen"] = list(bsym)
            unmatched_sym = [i for i in range(len(bsym)) if i not in m]
            n["marked_beam_no_piece"] = len(unmatched_sym)
            cs["marked_beam_no_piece"] = [bsym[i] for i in unmatched_sym]
            matched_pieces = set(m.values())
            un_p = [j for j in range(len(bseg)) if j not in matched_pieces]
            jp = [j for j in un_p if j in jl]
            n["joist_taken_as_beam"] = len(jp)
            cs["joist_taken_as_beam"] = [mid(bseg[j]) for j in jp]
            for p in bsym:
                near = [s for s in bseg if seg_dist(p, s) <= r]
                if any(
                    collinear_end_to_end(near[a], near[b])
                    for a in range(len(near))
                    for b in range(a + 1, len(near))
                ):
                    n["over_split"] += 1
                    cs["over_split"].append(p)
            nearest = collections.Counter()
            for p in bsym:
                best = min(((seg_dist(p, s), j) for j, s in enumerate(bseg)), default=None)
                if best and best[0] <= r:
                    nearest[best[1]] += 1
            us = [j for j, v in nearest.items() if v >= 2]
            n["under_split"] = len(us)
            cs["under_split"] = [mid(bseg[j]) for j in us]
            if pc["right_pen_is_ours"]:
                ex = [j for j in un_p if j not in jl]
                n["extra_non_steel"] = len(ex)
                cs["extra_non_steel"] = [mid(bseg[j]) for j in ex]
            uns = [j for j in matched_pieces if not beams[j]["profile"]]
            n["unsized"] = len(uns)
            cs["unsized"] = [mid(bseg[j]) for j in uns]
        else:
            m = one_to_one(csym, cpt, math.dist, r)
            miss = [i for i in range(len(csym)) if i not in m]
            n["columns_missed"] = len(miss)
            cs["columns_missed"] = [csym[i] for i in miss]
            got = set(m.values())
            ex = [j for j in range(len(cpt)) if j not in got]
            n["columns_extra"] = len(ex)
            cs["columns_extra"] = [cpt[j] for j in ex]
            uns = [j for j in got if not cols[j]["profile"]]
            n["unsized"] = len(uns)
            cs["unsized"] = [cpt[j] for j in uns]
        rows[str(int(r))] = n
        if r == PRIMARY:
            cases = cs
    rec["rows"] = rows
    rec["cases"] = {k: [[round(x, 1), round(y, 1)] for x, y in v] for k, v in cases.items()}

    # length check
    lens = []
    multi = 0
    cand = [
        (tuple(p["page"]), p) for p in pieces if p["kind"] in ("Beams", "Joist") and p["length_mm"]
    ]
    for ms in theirs.measures:
        if len(ms.points) != 2:
            multi += 1
            continue
        (ax, ay), (bx, by) = ms.points
        L = math.hypot(bx - ax, by - ay)
        if L == 0:
            continue
        theirs_mm = ms.value_mm if ms.value_mm else L * PT_TO_MM * ms.ratio
        ux, uy = (bx - ax) / L, (by - ay) / L
        m0 = ((ax + bx) / 2, (ay + by) / 2)
        best = None
        for s, p in cand:
            if angle_diff(angle(s), angle((ax, ay, bx, by))) > LEN_ANGLE_DEG:
                continue
            t0 = (s[0] - ax) * ux + (s[1] - ay) * uy
            t1 = (s[2] - ax) * ux + (s[3] - ay) * uy
            cover = max(0.0, min(max(t0, t1), L) - max(min(t0, t1), 0.0))
            if cover < LEN_OVERLAP * L:
                continue
            d = seg_dist(m0, s)
            if d <= LEN_DIST_PT and (best is None or d < best[0]):
                best = (d, p)
        lens.append(None if best is None else round((best[1]["length_mm"] - theirs_mm) / 25.4, 2))
    rec["length"] = {"paths_not_matched": multi, "errors_in": lens}
    return rec


# ---- gallery ----------------------------------------------------------------------------------
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _font(n: int):
    try:
        return ImageFont.truetype(FONT, n)
    except OSError:
        return ImageFont.load_default()


def _render(page: pymupdf.Page, box, zoom: float) -> Image.Image:
    clip = pymupdf.Rect(*box)  # get_pixmap takes the clip in displayed coordinates
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _panel(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    out = Image.new("RGB", size, (235, 235, 235))
    out.paste(img, (0, 0))
    return out


def gallery_image(
    path, row: str, job: str, dp: int, case: Pt, snap: dict, dpage, tpage, shift, rec
) -> None:
    w, h = displayed_size(dpage)
    half = CROP_PT / 2
    x0 = min(max(case[0] - half, 0.0), max(w - CROP_PT, 0.0))
    y0 = min(max(case[1] - half, 0.0), max(h - CROP_PT, 0.0))
    box = (x0, y0, min(x0 + CROP_PT, w), min(y0 + CROP_PT, h))
    zoom = 2.0
    size = (int(CROP_PT * zoom), int(CROP_PT * zoom))
    p1 = _panel(_render(dpage, box, zoom), size)
    p2 = Image.blend(p1, Image.new("RGB", size, (255, 255, 255)), 0.45)
    d = ImageDraw.Draw(p2)
    P = lambda x, y: ((x - box[0]) * zoom, (y - box[1]) * zoom)  # noqa: E731
    for p in snap["pieces"]:
        if not p.get("page"):
            continue
        a = P(p["page"][0], p["page"][1])
        if p["type"] == "column":
            d.rectangle([a[0] - 8, a[1] - 8, a[0] + 8, a[1] + 8], outline=(0, 191, 165), width=3)
            continue
        b = P(p["page"][2], p["page"][3])
        col = (
            (120, 120, 120)
            if p["kind"] == "Joist"
            else (255, 23, 68)
            if not p.get("profile")
            else (213, 0, 249)
        )
        d.line([a, b], fill=col, width=3)
    tw, th = displayed_size(tpage)
    tb = (box[0] - shift[0], box[1] - shift[1], box[2] - shift[0], box[3] - shift[1])
    tb = (max(tb[0], 0), max(tb[1], 0), min(tb[2], tw), min(tb[3], th))
    p3 = _panel(_render(tpage, tb, zoom), size) if tb[2] > tb[0] and tb[3] > tb[1] else None
    p3 = p3 or Image.new("RGB", size, (235, 235, 235))
    c = P(*case)
    for im in (p1, p2, p3):
        ImageDraw.Draw(im).ellipse(
            [c[0] - 60, c[1] - 60, c[0] + 60, c[1] + 60], outline=(0, 90, 255), width=5
        )
    gap = 16
    W, H = size[0] * 3 + gap * 4, size[1] + 110
    out = Image.new("RGB", (W, H), (255, 255, 255))
    dd = ImageDraw.Draw(out)
    for i, (im, t) in enumerate(((p1, "drawing"), (p2, "ours"), (p3, "their markup"))):
        x = gap + i * (size[0] + gap)
        dd.text((x, 6), t, fill=(40, 40, 40), font=_font(24))
        out.paste(im, (x, 38))
    cap = (
        f"{job}  page {dp + 1}  {rec['role']}  |  {row}  |  ours: beams {rec['ours_beams']},"
        f" columns {rec['ours_columns']}  |  their B {rec['theirs_B']}, C {rec['theirs_C']}"
    )
    dd.text((gap, H - 60), cap, fill=(20, 20, 20), font=_font(22))
    out.save(path, optimize=True)


# ---- the run ----------------------------------------------------------------------------------
def summarise(pages: list[dict], boxes: dict) -> dict[str, Any]:
    def med(v):
        v = [x for x in v if x is not None]
        return None if not v else round(statistics.median(v) * 100)

    out: dict[str, Any] = {}
    sets = {
        "seen": ({"seen"}, False),
        "dev": ({"dev"}, False),
        "strict": ({"strict"}, False),
        "dev+strict": ({"dev", "strict"}, False),
        "dev+strict, scale suspect out": ({"dev", "strict"}, True),
        "seen, scale suspect out": ({"seen"}, True),
        "strict, scale suspect out": ({"strict"}, True),
    }
    for name, (gs, drop) in sets.items():
        ps = [
            p
            for p in pages
            if p["group"] in gs and p["built"] and not (drop and p.get("scale_suspect"))
        ]
        fr = [p for p in ps if p["role"] == "framing"]
        cp = [p for p in ps if p["role"] == "column_plan"]
        out[name] = {
            "framing_pages": len(fr),
            "framing_within": sum(p["beams_within"] for p in fr),
            "column_pages": len(cp),
            "column_within": sum(p["columns_within"] for p in cp),
            "beams_median_abs": med(
                [abs(p["beams_err"]) for p in fr if p["beams_err"] is not None]
            ),
            "beams_median_signed": med([p["beams_err"] for p in fr]),
            "columns_median_abs": med(
                [abs(p["columns_err"]) for p in cp if p["columns_err"] is not None]
            ),
            "columns_median_signed": med([p["columns_err"] for p in cp]),
        }
        o = out[name]
        o["bar"] = (
            o["framing_pages"] > 0
            and o["column_pages"] > 0
            and 2 * o["framing_within"] >= o["framing_pages"]
            and 2 * o["column_within"] >= o["column_pages"]
        )
        rows = {}
        for r in RADII:
            rows[str(int(r))] = {k: sum(p["rows"][str(int(r))][k] for p in ps) for k in ROWS}
        o["failures"] = rows
        o["top3"] = sorted(ROWS, key=lambda k: (-rows["36"][k], ROWS.index(k)))[:3]
        errs = [e for p in ps for e in p["length"]["errors_in"]]
        got = [abs(e) for e in errs if e is not None]
        o["length"] = {
            "lines": len(errs),
            "no_piece": sum(e is None for e in errs),
            "paths_not_matched": sum(p["length"]["paths_not_matched"] for p in ps),
            "median_abs_in": round(statistics.median(got), 1) if got else None,
            "p90_abs_in": round(sorted(got)[max(0, math.ceil(0.9 * len(got)) - 1)], 1)
            if got
            else None,
            "median_signed_in": round(statistics.median([e for e in errs if e is not None]), 1)
            if got
            else None,
        }
        pen = {}
        for r in RADII:
            k = str(int(r))
            pen[k] = {
                "ours": sum(p["pen_check"].get(k, {}).get("ours", 0) for p in fr),
                "other": sum(p["pen_check"].get(k, {}).get("other", 0) for p in fr),
                "none": sum(p["pen_check"].get(k, {}).get("none", 0) for p in fr),
                "pages_right_pen_ours": sum(
                    p["pen_check"].get(k, {}).get("right_pen_is_ours", False) for p in fr
                ),
            }
        o["pen"] = pen
    return out


def main(argv: list[str]) -> None:
    cfg = load_config()
    OUT.mkdir(parents=True, exist_ok=True)
    boxes = json.loads((PRIVATE / "eval" / "summary_boxes.json").read_text())
    pages: list[dict] = []
    jobs: dict[str, dict] = {}
    gallery_src: list[tuple] = []
    with connect(cfg.database_url) as conn:
        for job in JOBS:
            row = conn.execute(
                "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                (project_name(job),),
            ).fetchone()
            if row is None:
                continue
            pid = row["id"]
            dups = {
                r["member_id"]
                for r in conn.execute(
                    "SELECT member_id FROM members WHERE project_id = %s AND build_run_id IS NOT"
                    " NULL AND COALESCE(kind_evidence->>'duplicate_of', '') <> ''",
                    (pid,),
                )
            }
            theirs = their_pages(job)
            stored = conn.execute(
                "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
            ).fetchone()["stored_path"]
            doc = pymupdf.open(cfg.upload_dir / stored)
            snaps = conn.execute(
                "SELECT s.page_index, b.setup, b.pieces FROM build_snapshots b JOIN sheets s"
                " ON s.id = b.sheet_id WHERE b.project_id = %s ORDER BY s.page_index",
                (pid,),
            ).fetchall()
            tot = {"columns": 0, "beams": 0}
            not_built = collections.Counter()
            for sn in snaps:
                tag = sn["setup"]["evidence"].get("p12c_person_setup") or {}
                if not tag.get("built"):
                    continue
                dp = sn["page_index"]
                base = {"job": job, "group": group(job), "page": dp + 1}
                if not sn["setup"]["built"]:
                    why = (
                        "no scale"
                        if tag.get("scale_source") == "none"
                        else "failed"
                        if sn["setup"]["failed"]
                        else "refused"
                    )
                    not_built[why] += 1
                    pages.append({**base, "built": False, "why": why, "role": tag.get("role")})
                    continue
                rec = page_eval(sn, theirs[dp], doc[dp], dups)
                pages.append({**base, "built": True, **rec})
                if rec["role"] == "column_plan":
                    tot["columns"] += rec["ours_columns"] - rec["ours_columns_dup"]
                tot["beams"] += rec["ours_beams"]
                gallery_src.append((job, dp, sn, theirs[dp], rec))
            summ = {
                r["kind"]: r["number"]
                for r in boxes[job]["rows"]
                if r["kind"] in ("Column", "Beams") and r["number"] is not None
            }
            jp = [p for p in pages if p["job"] == job and p["built"]]
            jobs[job] = {
                "group": group(job),
                "built": len(jp),
                "not_built": dict(not_built),
                "framing_within": [
                    sum(p["beams_within"] for p in jp if p["role"] == "framing"),
                    sum(p["role"] == "framing" for p in jp),
                ],
                "column_within": [
                    sum(p["columns_within"] for p in jp if p["role"] == "column_plan"),
                    sum(p["role"] == "column_plan" for p in jp),
                ],
                "ours_total": tot,
                "summary": {"columns": summ.get("Column"), "beams": summ.get("Beams")},
                "columns_on_framing_pages": {
                    "ours": sum(p["ours_columns"] for p in jp if p["role"] == "framing"),
                    "theirs_C": sum(p["theirs_C"] for p in jp if p["role"] == "framing"),
                },
            }
            doc.close()
        # the /BBMeasure check (tools/p12c_scale_check.py): a page whose scale disagreed with
        # every calibration of theirs on it is "scale suspect"
        sc = OUT / "scale_check.json"
        suspect = (
            {(r["job"], r["page"]) for r in json.loads(sc.read_text()) if r.get("agree") is False}
            if sc.exists()
            else set()
        )
        for p in pages:
            p["scale_suspect"] = (p["job"], p["page"]) in suspect
        summary = summarise(pages, boxes)
        made = []
        if "--gallery" in argv:
            tdocs: dict[str, pymupdf.Document] = {}
            for row in ROWS:
                picked: list[tuple] = []
                for pass_no in range(CASES_PER_ROW):
                    for job, dp, sn, th, rec in gallery_src:
                        cs = sorted(rec["cases"][row], key=lambda c: (c[1], c[0]))
                        if len(cs) > pass_no and len(picked) < CASES_PER_ROW:
                            picked.append((job, dp, sn, th, rec, cs[pass_no]))
                    if len(picked) >= CASES_PER_ROW:
                        break
                for k, (job, dp, sn, th, rec, case) in enumerate(picked, 1):
                    pid = conn.execute(
                        "SELECT f.stored_path FROM projects p JOIN project_files f ON"
                        " f.project_id = p.id WHERE p.name = %s ORDER BY p.created_at DESC"
                        " LIMIT 1",
                        (project_name(job),),
                    ).fetchone()["stored_path"]
                    tfile, tp = th.takeoff[0]
                    if tfile not in tdocs:
                        tdocs[tfile] = pymupdf.open(TAKEOFFS / tfile)
                    with pymupdf.open(cfg.upload_dir / pid) as d:
                        name = f"{row}-{k}.png"
                        gallery_image(
                            OUT / name, row, job, dp, tuple(case), sn, d[dp],
                            tdocs[tfile][tp], th.shift, rec,
                        )  # fmt: skip
                    made.append({"file": name, "row": row, "job": job, "page": dp + 1})
    (OUT / "eval.json").write_text(
        json.dumps({"pages": pages, "jobs": jobs, "summary": summary, "gallery": made}, indent=1)
    )
    print(json.dumps(summary, indent=1))
    for job, v in jobs.items():
        print(job, json.dumps(v))
    print("gallery images", len(made))


if __name__ == "__main__":
    main(sys.argv[1:])
