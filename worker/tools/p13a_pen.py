"""Phase 13a: the "right pen" test (docs/PHASE13A_PREREGISTRATION.md; DEV jobs only, read-only).

  PYTHONPATH=. .venv/bin/python -m tools.p13a_pen

The pre-registration's hash (worker/prereg/PHASE13A.sha256) is verified first; the run stops when
it differs. Every page the Phase 12c-A run built is rebuilt IN MEMORY with the engine's
`build_page`, the 12c-A setup read back from its copy (nothing is written to the database), once per
pen mode: A auto pen (must reproduce the stored 12c-A counts, else the run stops), B simulated click
(the first of up to 3 estimator B marks in reading order with a candidate line within 36 pt), C best
pen (an UPPER BOUND: the candidate pen whose beam count is closest to theirs). The 12c-A measures
and failure table (`tools.p12c_eval.page_eval`) score each mode. Column counts must be the same in
every mode (the pen only affects beams), else the run stops. Writes the private
fixtures/private/eval/p13a/pen.json and the local docs/PHASE13A_RESULTS.md; prints counts only.
"""

from __future__ import annotations

import collections
import json
import statistics
import sys
from typing import Any

import pymupdf

from src.build.job import BEAM_KIND, COLUMN_KIND, JOIST_KIND, _column_plan, _legend, _size_fields
from src.build.job import _text_lines as stored_text_lines
from src.build.page import Setup, build_page
from src.build.pieces import length_mm
from src.build.propose import displayed_size
from src.build.views import load_views, pick_view
from src.config import load_config
from src.db import connect
from src.linking.lines import page_lines
from src.linking.structural import lines_in_box
from src.pdf_scan.analyze import analyze_page
from tools.p12c_eval import PEN_MIN_IN, RADII, ROWS, page_eval, seg_dist
from tools.p12c_lib import BEAM, JOBS, TheirPage, group, project_name, their_pages
from tools.prereg import verify
from tools.takeoff.common import PRIVATE, ROOT

PREREG = ROOT / "docs" / "PHASE13A_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE13A.sha256"
OUT = PRIVATE / "eval" / "p13a" / "pen.json"
DOC = ROOT / "docs" / "PHASE13A_RESULTS.md"

CLICK_PT = 36.0  # B: a click hits a candidate line within this distance of the mark
CLICK_TRIES = 3  # B: up to this many marks, in reading order
CLICK_INFO_PT = (12.0, 24.0, 36.0, 48.0)  # B: hit rates for information (36 pt is B's own)
PRECISION_FLAG = 0.5  # C: a passing page whose 36 pt match precision is below this is flagged
WITHIN = 0.2
VERDICT_GROUPS = ("dev", "strict")
MODES = ("A", "B", "C")

Mark = tuple[float, float]
Cand = tuple[tuple[float, float, float, float], str]  # (segment, pen class)


# --- pure rules (synthetic tests in tests/test_p13a_pen.py) -------------------------------------


def reading_order(marks: list[Mark]) -> list[Mark]:
    """Smallest y first, then smallest x (drawing coordinates)."""
    return sorted(marks, key=lambda m: (m[1], m[0]))


def nearest_pen(mark: Mark, cands: list[Cand], radius: float) -> str | None:
    best = min(((seg_dist(mark, seg), pen) for seg, pen in cands), default=None)
    return best[1] if best is not None and best[0] <= radius else None


def click_pen(
    marks: list[Mark], cands: list[Cand], radius: float = CLICK_PT, tries: int = CLICK_TRIES
) -> tuple[str | None, int | None]:
    """(pen, 1-based try that hit) of the simulated click; (None, None) when every try missed."""
    for k, m in enumerate(reading_order(marks)[:tries], start=1):
        pen = nearest_pen(m, cands, radius)
        if pen is not None:
            return pen, k
    return None, None


def best_pen(counts: dict[str, int], theirs: int, auto: str | None) -> str | None:
    """The pen whose beam count is closest to theirs; ties: the auto pen, then the class name."""
    if not counts:
        return None
    return min(counts, key=lambda p: (abs(counts[p] - theirs), p != auto, p))


def right_pen(marks: list[Mark], cands: list[Cand], radius: float) -> str | None:
    """12c-A pen check: the pen class nearest to the most B marks within `radius`."""
    near = collections.Counter(nearest_pen(m, cands, radius) for m in marks)
    near.pop(None, None)
    return max(sorted(near), key=lambda k: near[k]) if near else None


def within(ours: int, theirs: int) -> bool:
    return theirs > 0 and abs(ours - theirs) <= WITHIN * theirs


def gap_closed(a: int, b: int, c: int) -> float | None:
    """(B - A) / (C - A); None when C = A (no gap a pen could close)."""
    return None if c == a else (b - a) / (c - a)


def precision_recall(
    theirs: int, unmatched_theirs: int, ours: int
) -> tuple[float | None, float | None]:
    matched = theirs - unmatched_theirs
    return (matched / ours if ours else None), (matched / theirs if theirs else None)


# --- in-memory build ------------------------------------------------------------------------------


def pieces_of(pb, ratio: float) -> list[dict[str, Any]]:
    """The page build as the 12c-A snapshot pieces (the store step's kinds)."""
    out = []
    for p, att in zip(pb.supports.pieces, pb.piece_labels, strict=True):
        joist = att.size_state == "joist"
        out.append(
            {
                "member_id": "",
                "kind": JOIST_KIND if joist else BEAM_KIND,
                "type": "joist" if joist else "beam",
                "page": [p.a[0], p.a[1], p.b[0], p.b[1]],
                "profile": _size_fields(att).get("profile"),
                "length_mm": round(length_mm(p.a, p.b, ratio), 1),
            }
        )
    for g, att in zip(pb.columns, pb.column_labels, strict=True):
        out.append(
            {
                "member_id": "",
                "kind": COLUMN_KIND,
                "type": "column",
                "page": [g.centre[0], g.centre[1], g.centre[0], g.centre[1]],
                "profile": _size_fields(att).get("profile"),
                "length_mm": None,
            }
        )
    return out


def counts(pieces: list[dict]) -> tuple[int, int]:
    beams = sum(1 for p in pieces if p["kind"] == BEAM_KIND and p["type"] != "column")
    return beams, sum(1 for p in pieces if p["type"] == "column")


class Page:
    """One 12c-A built page with everything a rebuild needs (read from the copy, read-only)."""

    def __init__(self, conn, pid: str, sheet_id: str, snap: dict, page: pymupdf.Page):
        self.snap, self.page = snap, page
        s = snap["setup"]
        c = s["crop"]["value"]
        self.box = (float(c["x0"]), float(c["y0"]), float(c["x1"]), float(c["y1"]))
        self.ratio = float(s["scale"]["value"])
        self.role = s["role"]["value"]
        self.auto = s["pen_class"]["value"]
        run = conn.execute(
            "SELECT inputs FROM build_runs WHERE sheet_id = %s AND status = 'done'"
            " ORDER BY finished_at DESC LIMIT 1",
            (sheet_id,),
        ).fetchone()
        self.inputs = dict(run["inputs"] or {})
        view = pick_view(load_views(conn, sheet_id), self.inputs.get("view_id"))
        self.view_pens = tuple(p["pen_class"] for p in view.pens)
        self.text = stored_text_lines(conn, sheet_id) or None
        self.legend = _legend(conn, pid)
        self.plan = None
        if self.role == "framing" and self.inputs.get("column_plan_sheet_id"):
            self.plan, _, why = _column_plan(
                conn, pid, view, {"column_plan_sheet_id": self.inputs["column_plan_sheet_id"]}
            )
            if why:
                raise SystemExit(f"column plan of a 12c-A page cannot be read: {why}")
        self.tos = s["tos"]["value_mm"]
        self.cache: dict[str | None, list[dict]] = {}

    def build(self, pen: str | None, as_stored: bool = False) -> list[dict]:
        key = "__stored__" if as_stored else pen
        if key not in self.cache:
            setup = Setup(
                self.box,
                self.ratio,
                self.tos,
                pen,
                self.role,
                str(self.inputs.get("crossing_rule") or "family"),
                pens=self.view_pens if as_stored else ((pen,) if pen else ()),
            )
            pb = build_page(self.page, setup, self.text, self.legend, self.plan)
            self.cache[key] = pieces_of(pb, self.ratio)
        return self.cache[key]

    def candidates(self) -> list[Cand]:
        min_pt = PEN_MIN_IN * 72.0 / self.ratio
        lines = lines_in_box(page_lines(self.page), self.box, displayed_size(self.page))
        return [((ln.x0, ln.y0, ln.x1, ln.y1), ln.klass) for ln in lines if ln.length >= min_pt]


def score(pg: Page, pieces: list[dict], pen: str | None, theirs: TheirPage) -> dict[str, Any]:
    """The 12c-A measures of a page with `pieces` built with `pen`."""
    setup = json.loads(json.dumps(pg.snap["setup"]))
    setup["pen_class"]["value"] = pen
    return page_eval({"setup": setup, "pieces": pieces}, theirs, pg.page, set())


# --- run ------------------------------------------------------------------------------------------


def run_page(pg: Page, theirs: TheirPage) -> dict[str, Any]:
    stored = pg.snap["pieces"]
    want = counts([p for p in stored if p.get("page")])
    got = counts(pg.build(pg.auto, as_stored=True))
    rec: dict[str, Any] = {"guard": {"stored": want, "rebuilt": got, "same": want == got}}
    if want != got:
        return rec
    marks = [(s.x, s.y) for s in theirs.symbols if s.prefix == BEAM]
    rec["modes"] = {
        "A": {"pen": pg.auto, **score(pg, pg.build(pg.auto, as_stored=True), pg.auto, theirs)}
    }
    if pg.role != "framing":
        for m in ("B", "C"):
            rec["modes"][m] = {**rec["modes"]["A"]}
        rec["columns_same"] = True
        return rec
    cands = pg.candidates()
    pen_b, tried = click_pen(marks, cands)
    click = {
        "first_try_hit": tried == 1,
        "hit_within_3": tried is not None,
        "fallback": tried is None,
        "try": tried,
        "info": {
            str(int(r)): {
                "first": click_pen(marks, cands, r, 1)[1] is not None,
                "within_3": click_pen(marks, cands, r)[1] is not None,
            }
            for r in CLICK_INFO_PT
        },
    }
    rp = right_pen(marks, cands, CLICK_PT)
    click["right_pen_exists"] = rp is not None
    click["non_beam_pen"] = pen_b is not None and rp is not None and pen_b != rp
    b_pen = pen_b if pen_b is not None else pg.auto
    b_pieces = pg.build(b_pen) if pen_b is not None else pg.build(pg.auto, as_stored=True)
    rec["modes"]["B"] = {"pen": b_pen, "click": click, **score(pg, b_pieces, b_pen, theirs)}
    pens = sorted({pen for _, pen in cands})
    tried_counts = {p: counts(pg.build(p))[0] for p in pens}
    c_pen = best_pen(tried_counts, len(marks), pg.auto)
    c_used = c_pen if c_pen is not None else pg.auto  # no candidate line: the auto build
    c_pieces = pg.build(c_pen) if c_pen is not None else pg.build(pg.auto, as_stored=True)
    c = {"pen": c_used, "pens_tried": len(pens), **score(pg, c_pieces, c_used, theirs)}
    unmatched = c["rows"]["36"]["marked_beam_no_piece"]
    c["precision"], c["recall"] = precision_recall(c["theirs_B"], unmatched, c["ours_beams"])
    c["right_count_wrong_lines"] = bool(
        c["beams_within"] and c["precision"] is not None and c["precision"] < PRECISION_FLAG
    )
    rec["modes"]["C"] = c
    cols = {m: rec["modes"][m]["ours_columns"] for m in MODES}
    rec["columns_same"] = len(set(cols.values())) == 1
    return rec


def med(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def summarise(
    pages: list[dict], mode: str, groups: tuple[str, ...], with_no_text: bool = True
) -> dict:
    ps = [p for p in pages if p["group"] in groups and (with_no_text or p["text_layer"])]
    fr = [p for p in ps if p["role"] == "framing"]
    cp = [p for p in ps if p["role"] == "column_plan"]
    m = lambda p: p["modes"][mode]  # noqa: E731
    over = sum(max(0, m(p)["ours_beams"] - m(p)["theirs_B"]) for p in fr)
    under = sum(max(0, m(p)["theirs_B"] - m(p)["ours_beams"]) for p in fr)
    out = {
        "framing_pages": len(fr),
        "beams_within": sum(bool(m(p)["beams_within"]) for p in fr),
        "column_pages": len(cp),
        "columns_within": sum(bool(m(p)["columns_within"]) for p in cp),
        "beams_median_signed": med([m(p)["beams_err"] for p in fr]),
        "beams_median_abs": med(
            [abs(m(p)["beams_err"]) for p in fr if m(p)["beams_err"] is not None]
        ),
        "columns_median_signed": med([m(p)["columns_err"] for p in cp]),
        "beams_over": over,
        "beams_under": under,
        "rows": {
            str(int(r)): {k: sum(m(p)["rows"][str(int(r))][k] for p in ps) for k in ROWS}
            for r in RADII
        },
    }
    out["bar_met"] = (
        out["framing_pages"] > 0
        and out["column_pages"] > 0
        and out["beams_within"] * 2 >= out["framing_pages"]
        and out["columns_within"] * 2 >= out["column_pages"]
    )
    if mode == "C":
        tp = sum(m(p)["theirs_B"] - m(p)["rows"]["36"]["marked_beam_no_piece"] for p in fr)
        out["precision"] = round(tp / sum(m(p)["ours_beams"] for p in fr), 3) if fr else None
        out["recall"] = round(tp / sum(m(p)["theirs_B"] for p in fr), 3) if fr else None
        flagged = [p for p in fr if m(p)["right_count_wrong_lines"]]
        out["flagged_right_count_wrong_lines"] = len(flagged)
        out["beams_within_without_flagged"] = out["beams_within"] - len(flagged)
        out["framing_pages_without_flagged"] = len(fr) - len(flagged)
    if mode == "B":
        clicks = [m(p)["click"] for p in fr]
        out["click"] = {
            "first_try_hit": sum(c["first_try_hit"] for c in clicks),
            "hit_within_3": sum(c["hit_within_3"] for c in clicks),
            "fallback": sum(c["fallback"] for c in clicks),
            "non_beam_pen": sum(c["non_beam_pen"] for c in clicks),
            "info": {
                r: {
                    "first": sum(c["info"][r]["first"] for c in clicks),
                    "within_3": sum(c["info"][r]["within_3"] for c in clicks),
                }
                for r in (str(int(x)) for x in CLICK_INFO_PT)
            },
        }
    return out


def main(argv: list[str]) -> None:
    digest = verify(PREREG, PREREG_HASH)
    if argv[:1] == ["report"]:  # the doc again from the saved JSON
        DOC.write_text(report(json.loads(OUT.read_text())))
        return
    print("pre-registration verified:", digest[:12])
    cfg = load_config()
    pages: list[dict] = []
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        for job in JOBS:  # the 15 DEV jobs of 12c-A (none is locked)
            row = conn.execute(
                "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                (project_name(job),),
            ).fetchone()
            pid = str(row["id"])
            theirs = their_pages(job)
            stored = conn.execute(
                "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
            ).fetchone()["stored_path"]
            snaps = conn.execute(
                "SELECT s.id AS sheet_id, s.page_index, b.setup, b.pieces FROM build_snapshots b"
                " JOIN sheets s ON s.id = b.sheet_id WHERE b.project_id = %s ORDER BY s.page_index",
                (pid,),
            ).fetchall()
            with pymupdf.open(cfg.upload_dir / stored) as doc:
                for sn in snaps:
                    tag = sn["setup"]["evidence"].get("p12c_person_setup") or {}
                    if not tag.get("built") or not sn["setup"]["built"]:
                        continue
                    dp = sn["page_index"]
                    pg = Page(conn, pid, str(sn["sheet_id"]), sn, doc[dp])
                    rec = run_page(pg, theirs[dp])
                    rec.update(
                        job=job,
                        group=group(job),
                        page=dp + 1,
                        role=pg.role,
                        text_layer=analyze_page(doc[dp]).has_text_layer,
                    )
                    pages.append(rec)
                    print(
                        f"{job} p{dp + 1} {pg.role}:",
                        "guard ok" if rec["guard"]["same"] else "guard DIFFERS",
                        flush=True,
                    )
    bad = [(p["job"], p["page"], p["guard"]) for p in pages if not p["guard"]["same"]]
    if bad:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"stopped": "guard", "pages": pages}, indent=1, default=str))
        raise SystemExit(
            f"guard: mode A differs from the stored 12c-A counts on {len(bad)} page(s): {bad}"
        )
    cols = [(p["job"], p["page"]) for p in pages if not p["columns_same"]]
    if cols:
        OUT.write_text(json.dumps({"stopped": "columns", "pages": pages}, indent=1, default=str))
        raise SystemExit(f"sanity: column counts differ across modes on {cols}")
    groups = {
        "verdict (dev + strict)": VERDICT_GROUPS,
        "dev": ("dev",),
        "strict": ("strict",),
        "seen": ("seen",),
        "all": ("dev", "strict", "seen"),
    }
    summary = {
        g: {
            "with_no_text": {m: summarise(pages, m, gs) for m in MODES},
            "text_only": {m: summarise(pages, m, gs, with_no_text=False) for m in MODES},
        }
        for g, gs in groups.items()
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"prereg_sha256": digest, "pages": pages, "summary": summary}, indent=1, default=str
        )
    )
    v = summary["verdict (dev + strict)"]["with_no_text"]
    for m in MODES:
        s = v[m]
        print(
            f"mode {m}: beams {s['beams_within']}/{s['framing_pages']},"
            f" columns {s['columns_within']}/{s['column_pages']},"
            f" bar {'met' if s['bar_met'] else 'not met'}"
        )
    DOC.write_text(report(json.loads(OUT.read_text())))
    print("wrote", OUT.relative_to(ROOT), DOC.relative_to(ROOT))


# --- report ---------------------------------------------------------------------------------------


def _pct(x: float | None, sign: bool = True) -> str:
    if x is None:
        return "—"
    return f"{x * 100:+.0f}%" if sign else f"{x * 100:.0f}%"


def _mode_rows(sm: dict) -> list[str]:
    out = [
        "| Mode | Beam pages within 20% | Column pages within 20% | Median signed (beams)"
        " | Median abs (beams) | Over / under (beams) | Bar |",
        "|---|---|---|---|---|---|---|",
    ]
    names = {"A": "A auto pen", "B": "B simulated click", "C": "C best pen (UPPER BOUND)"}
    for m in MODES:
        s = sm[m]
        out.append(
            f"| {names[m]} | {s['beams_within']} of {s['framing_pages']}"
            f" | {s['columns_within']} of {s['column_pages']} | {_pct(s['beams_median_signed'])}"
            f" | {_pct(s['beams_median_abs'], sign=False)} | {s['beams_over']} / {s['beams_under']}"
            f" | {'met' if s['bar_met'] else 'not met'} |"
        )
    return out


def report(d: dict) -> str:
    S = d["summary"]
    v = S["verdict (dev + strict)"]["with_no_text"]
    a, b, c = (v[m]["beams_within"] for m in MODES)
    gap = gap_closed(a, b, c)
    ck = v["B"]["click"]
    n_fr = v["A"]["framing_pages"]
    rows_c = {k: n for k, n in v["C"]["rows"]["36"].items() if k != "wrong_pen"}
    top = sorted(rows_c.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
    no_text = sum(not p["text_layer"] for p in d["pages"])
    lines = [
        "# Phase 13a results: the right pen test (DEV jobs only)",
        "",
        f"Pre-registration `docs/PHASE13A_PREREGISTRATION.md`, sha256 {d['prereg_sha256'][:12]}"
        " (verified at the start of the run). Read-only: every 12c-A page rebuilt in memory; the"
        " guard (mode A = the stored 12c-A counts) held on every page, and column counts were the"
        " same in every mode. Job ids only. C is an UPPER BOUND (it looks at the answer).",
        "",
        "## Verdict in plain words",
        "",
        "- Bar (A / B / C): "
        + " / ".join("met" if v[m]["bar_met"] else "not met" for m in MODES)
        + (
            ': "detection needs work" in every mode.'
            if not any(v[m]["bar_met"] for m in MODES)
            else "."
        ),
        f"- **The one click closes {'none' if not gap else f'{gap * 100:.0f}%'} of the gap.**"
        " Clicking next to an estimator mark lands on a long line, but often not a steel line"
        f" ({ck['non_beam_pen']} of {ck['hit_within_3']} hits picked a pen other than the right"
        " pen); those pens turn many non-steel lines into beams."
        if gap is not None
        else "- No pen could close any gap.",
        f"- **Even the best pen (upper bound) passes only {c} of {n_fr}**, and most of those passes"
        " are the right count on mostly wrong lines; with them left out it passes"
        f" {v['C']['beams_within_without_flagged']} of {v['C']['framing_pages_without_flagged']}."
        " So the pen is not the main problem: the errors that remain are not pen problems.",
        "",
        "## Verdict set (Phase 7 dev + strict held-out)",
        "",
        *_mode_rows(v),
        "",
        f"- **Gap closed by the one click (beams):** ({b} - {a}) / ({c} - {a}) = "
        + ("no gap a pen could close" if gap is None else f"{gap * 100:.0f}%")
        + ". The simulated click passes the same number of pages as the auto pen.",
        f"- **Click:** first-try hit {ck['first_try_hit']} of {n_fr} framing pages, hit within 3"
        f" marks {ck['hit_within_3']} of {n_fr}, fallback to the auto pen {ck['fallback']};"
        f" clicked a pen that is not the right pen (12c-A pen check) on {ck['non_beam_pen']} of the"
        f" {ck['hit_within_3']} hits. For information, first try / within 3: "
        + ", ".join(f"{r} pt {x['first']} / {x['within_3']}" for r, x in ck["info"].items())
        + ".",
        f"- **C sanity (36 pt one-to-one):** precision {v['C']['precision']}, recall"
        f" {v['C']['recall']} over the framing pages; {v['C']['flagged_right_count_wrong_lines']}"
        f" of C's {c} passing pages have precision below 50% (right count, mostly wrong lines);"
        f" without them C passes {v['C']['beams_within_without_flagged']} of"
        f" {v['C']['framing_pages_without_flagged']}.",
        '- **Left even with the best pen** (mode C failure table at 36 pt, "Wrong pen" left'
        " out): " + "; ".join(f"{k} {n}" for k, n in top) + ".",
        f"- **Pages without a text layer:** {no_text} of the {len(d['pages'])} built pages, so the"
        " tables with and without them are the same.",
        "",
        "## Failure table at 36 pt, per mode (verdict set)",
        "",
        "| Row | A | B | C (upper bound) |",
        "|---|---|---|---|",
        *(f"| {k} | " + " | ".join(str(v[m]["rows"]["36"][k]) for m in MODES) + " |" for k in ROWS),
        "",
        "## Other groups (information)",
        "",
    ]
    for g in ("dev", "strict", "seen", "all"):
        lines += [f"**{g}**", "", *_mode_rows(S[g]["with_no_text"]), ""]
    lines += [
        "## Per page",
        "",
        "| Job | Page | Role | Their B / C | A | B | C (upper bound) | Pen A / B / C | Click"
        " | C pens tried | C precision / recall | Flag |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for p in d["pages"]:
        m = p["modes"]
        key = "ours_beams" if p["role"] == "framing" else "ours_columns"
        theirs = f"{m['A']['theirs_B']} / {m['A']['theirs_C']}"
        pens = " / ".join(str(m[x]["pen"] or "—") for x in MODES) if p["role"] == "framing" else "—"
        ck = m["B"].get("click")
        click = (
            "—"
            if not ck
            else "fallback"
            if ck["fallback"]
            else f"hit (try {ck['try']})" + (", not the right pen" if ck["non_beam_pen"] else "")
        )
        pr = (
            f"{_r(m['C'].get('precision'))} / {_r(m['C'].get('recall'))}"
            if p["role"] == "framing"
            else "—"
        )
        flag = "right count, wrong lines" if m["C"].get("right_count_wrong_lines") else ""
        lines.append(
            f"| {p['job']} | {p['page']} | {p['role']} | {theirs} | {m['A'][key]} | {m['B'][key]}"
            f" | {m['C'][key]} | {pens} | {click} | {m['C'].get('pens_tried', '—')} | {pr}"
            f" | {flag} |"
        )
    return "\n".join(lines) + "\n"


def _r(x: float | None) -> str:
    return "—" if x is None else f"{x:.2f}"


if __name__ == "__main__":
    main(sys.argv[1:])
