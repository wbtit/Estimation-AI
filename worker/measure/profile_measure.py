"""Profile from callout: measurement on a stored page (read-only; ids and counts only).

    cd worker && .venv/bin/python -m measure.profile_measure columns --sheet <prefix> --truth <json>
    cd worker && .venv/bin/python -m measure.profile_measure beams --sheet <prefix> --ratio <r>
        --truth <json> [--pen <pen class>]

Pre-registration: worker/prereg/PHASE0_PROFILE_CALLOUT_PREREGISTRATION.md.

`columns` (Addendum 1: every column is re-resolved): the truth is the owner's corrected final
profile of every column of the page
(api/src/scripts/export-profiles.ts). TODAY = the profile the system stored (a Find similar match
copies the example's profile); NEW = what the new path gives the same column: its own label, else
the view's TYP label, else the stored (example) profile, from the labels read out of the page's REAL
PDF text (src/build/read_labels_job.view_texts, the job's own code, nothing stored) and the same
`resolve_profile` rules as the API. A profile chosen in the palette is a default, so Find similar
matches and drawn columns are all re-resolved (Addendum 1).
`beams`: the REAL `build_page` (the learned beam style as in the Review 4 measurement) on the page;
each built beam's profile is the profile of its attached label; the beams are matched to the truth
beams (angle within 3 deg, midpoint offset <= 6 pt, overlap >= 50 %, one to one); TODAY is the same
build with the TYP beam rule off (the base engine).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent
sys.path.insert(0, str(WORKER))


def key(profile: str | None) -> str | None:
    """A profile however it is written: family plus the numbers (a fraction equals its decimal)."""
    if not profile:
        return None
    import re
    from fractions import Fraction

    m = re.match(r"^([A-Z]+)(.*)$", profile.strip().upper())
    if not m:
        return profile
    parts = []
    for t in m.group(2).split("X"):
        try:
            mm = re.match(r"^(\d+)-(\d+)/(\d+)$", t)
            v = (
                int(mm.group(1)) + Fraction(int(mm.group(2)), int(mm.group(3)))
                if mm
                else Fraction(t)
            )
            parts.append(str(round(float(v), 6)))
        except (ValueError, ZeroDivisionError):
            parts.append(t)
    return f"{m.group(1)}:{'|'.join(parts)}"


def _connect():
    import psycopg
    from dotenv import load_dotenv
    from psycopg.rows import dict_row

    load_dotenv(ROOT / ".env")
    conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def _sheet(conn, prefix: str) -> dict[str, Any]:
    return conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s JOIN project_files f ON f.project_id ="
        " s.project_id WHERE s.id::text LIKE %s",
        (prefix + "%",),
    ).fetchone()


def columns(args: argparse.Namespace) -> dict[str, Any]:
    import pymupdf

    from src.build.profile_labels import CatalogIndex, read_page_labels, resolve_profile
    from src.build.read_labels_job import view_texts

    conn = _connect()
    page = _sheet(conn, args.sheet)
    truth = json.loads(Path(args.truth).read_text())
    cols = [t for t in truth if t["type"] == "column"]
    upload = ROOT / os.environ.get("UPLOAD_DIR", "uploads")
    t0 = time.perf_counter()
    catalog = CatalogIndex(conn)
    with pymupdf.open(upload / page["stored_path"]) as doc:
        views = view_texts(conn, str(page["id"]), page, doc[page["page_index"]])
    labels_by_view = {
        str(v.id): read_page_labels(inside, segs, catalog) for v, inside, segs, _n in views
    }
    first = str(next(v.id for v, *_ in views if v.first))
    t1 = time.perf_counter()
    rows = []
    for c in cols:
        view = str(c["view"]) if c.get("view") else first
        labels = labels_by_view.get(view) or labels_by_view[first]
        stored = c["stored_profile"]
        # Addendum 1: a profile chosen in the palette before placing a column is a DEFAULT (source
        # example): its own label replaces it, for a Find similar match and for a drawn column. Only
        # a profile typed on the member is the person's (those typed edits ARE the truth here).
        got = resolve_profile(tuple(c["a"]), labels, stored)
        new, source = got["profile"], got["source"]
        conf = (got["link"] or {}).get("confidence")
        rows.append(
            {
                "truth": key(c["profile"]),
                "today": key(stored),
                "new": key(new),
                "source": source,
                "confidence": conf,
                "matched": c.get("symbol_source") == "find_similar",
            }
        )
    t2 = time.perf_counter()
    n = len(rows)

    def pct(k: str) -> float:
        return round(100 * sum(r[k] == r["truth"] for r in rows) / n, 1)

    fixed = sum(r["today"] != r["truth"] and r["new"] == r["truth"] for r in rows)
    broken = sum(r["today"] == r["truth"] and r["new"] != r["truth"] for r in rows)
    by_source: dict[str, dict[str, int]] = {}
    for r in rows:
        s = by_source.setdefault(r["source"] or "none", {"n": 0, "correct": 0})
        s["n"] += 1
        s["correct"] += r["new"] == r["truth"]
    return {
        "sheet": str(page["id"])[:8],
        "columns": n,
        "find_similar_matches": sum(r["matched"] for r in rows),
        "labels_on_page": sum(len(v) for v in labels_by_view.values()),
        "percent_correct_today": pct("today"),
        "percent_correct_new": pct("new"),
        "fixed": fixed,
        "broken": broken,
        "still_wrong": sum(r["new"] != r["truth"] for r in rows),
        "by_source": by_source,
        "pass": pct("new") >= 95.0 and broken == 0,
        "seconds_read_labels": round(t1 - t0, 3),
        "seconds_link_all_columns": round(t2 - t1, 4),
    }


def _ang(a, b) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def _match(truth: list[dict], found: list[tuple]) -> dict[int, int]:
    """truth index -> found index, one to one, best overlap first (Review 4 rule)."""
    cands = []
    for i, t in enumerate(truth):
        ta, tb = tuple(t["a"]), tuple(t["b"])
        tl = math.dist(ta, tb) or 1.0
        ux, uy = (tb[0] - ta[0]) / tl, (tb[1] - ta[1]) / tl
        for j, (fa, fb) in enumerate(found):
            d = abs(_ang(ta, tb) - _ang(fa, fb)) % 180.0
            if min(d, 180.0 - d) > 3.0:
                continue
            ts = sorted([(p[0] - ta[0]) * ux + (p[1] - ta[1]) * uy for p in (fa, fb)])
            ov = max(0.0, min(tl, ts[1]) - max(0.0, ts[0]))
            mx, my = (fa[0] + fb[0]) / 2 - ta[0], (fa[1] + fb[1]) / 2 - ta[1]
            if abs(-uy * mx + ux * my) <= 6.0 and ov >= 0.5 * tl:
                cands.append((-ov, i, j))
    cands.sort()
    ti, fj, out = set(), set(), {}
    for _, i, j in cands:
        if i not in ti and j not in fj:
            ti.add(i)
            fj.add(j)
            out[i] = j
    return out


def beams(args: argparse.Namespace) -> dict[str, Any]:
    import pymupdf

    from src.build import profile_config
    from src.build.beam_lines import beam_lines
    from src.build.clean import clean
    from src.build.double_line import BeamStyle, centrelines, learn_style
    from src.build.page import Setup, build_page
    from src.build.segments import crop, page_text_lines, parse_page

    conn = _connect()
    page = _sheet(conn, args.sheet)
    truth = [t for t in json.loads(Path(args.truth).read_text()) if t["type"] in ("beam", "brace")]
    upload = ROOT / os.environ.get("UPLOAD_DIR", "uploads")
    out: dict[str, Any] = {"sheet": str(page["id"])[:8], "truth_beams": len(truth)}
    with pymupdf.open(upload / page["stored_path"]) as doc:
        pg = doc[page["page_index"]]
        box = (0.0, 0.0, float(page["width_pt"]), float(page["height_pt"]))
        text = page_text_lines(pg)
        ps = crop(parse_page(pg), box)
        cleaned = clean(ps, text)
        dashed = centrelines(ps)
        pens = [args.pen] if args.pen else [f"{w}|black|solid" for w in ("0.25-0.5", "0.1-0.25")]
        best = None
        for pen in pens:
            lines = beam_lines(ps, cleaned.keep, pen)
            for ln in sorted(lines, key=lambda x: -x.length):
                mid = ((ln.p0[0] + ln.p1[0]) / 2, (ln.p0[1] + ln.p1[1]) / 2)
                got = learn_style(lines, mid, pen, args.ratio, dashed)
                if got.style == "double" and (best is None or len(lines) > best[2]):
                    best = (pen, got, len(lines))
                    break
        if best is None:
            return {**out, "error": "no double-line style learned"}
        pen, learned, _n = best
        style = BeamStyle("double", learned.gap_min_pt, learned.gap_max_pt, True)

        def run(typ: bool) -> dict[str, Any]:
            old = profile_config.TYP_SCOPE
            profile_config.TYP_SCOPE = "view_family" if typ else "glyph_signature"
            try:
                setup = Setup(box, args.ratio, None, pen, "framing", pens=(pen,),
                              column_mode="click_first", beam_style=style)  # fmt: skip
                pb = build_page(pg, setup, text=text)
            finally:
                profile_config.TYP_SCOPE = old
            found = [(p.a, p.b) for p in pb.supports.pieces]
            m = _match(truth, found)
            res = {"correct": 0, "wrong": 0, "no_label": 0, "sources": {}}
            per = {}
            for i, j in m.items():
                att = pb.piece_labels[j]
                got_key = key(att.label.canonical) if att.label and att.label.canonical else None
                ok = got_key is not None and got_key == key(truth[i]["profile"])
                per[i] = got_key
                if got_key is None:
                    res["no_label"] += 1
                elif ok:
                    res["correct"] += 1
                else:
                    res["wrong"] += 1
                src = att.source or "none"
                res["sources"][src] = res["sources"].get(src, 0) + 1
            return {"matched": len(m), "found": len(found), **res, "_per": per}

        base, new = run(False), run(True)
    n = len(truth)
    fixed = sum(
        1
        for i, g in new["_per"].items()
        if g == key(truth[i]["profile"]) and base["_per"].get(i) != g
    )
    broken = sum(
        1
        for i, g in base["_per"].items()
        if g == key(truth[i]["profile"]) and new["_per"].get(i) != g
    )
    for r in (base, new):
        r.pop("_per")
        r["percent_of_truth_correct"] = round(100 * r["correct"] / n, 1) if n else None
        r["percent_of_matched_correct"] = (
            round(100 * r["correct"] / r["matched"], 1) if r["matched"] else None
        )
    return {**out, "ratio": args.ratio, "pen": pen, "today": base, "new": new,
            "fixed": fixed, "broken": broken}  # fmt: skip


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("columns")
    c.add_argument("--sheet", required=True)
    c.add_argument("--truth", required=True)
    b = sub.add_parser("beams")
    b.add_argument("--sheet", required=True)
    b.add_argument("--ratio", type=float, required=True)
    b.add_argument("--truth", required=True)
    b.add_argument("--pen")
    for p in (c, b):
        p.add_argument("--json")
    a = ap.parse_args()
    res = columns(a) if a.cmd == "columns" else beams(a)
    print(json.dumps(res, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
