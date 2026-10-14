"""Phase 9 Part C: why the 62-piece size of job-018 is invisible (diagnostic, read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase9_invisible
Needs the read-only API on PHASE6B_API (default http://127.0.0.1:3100). Definitions are in
docs/PHASE9_PREREGISTRATION.md section 3 and its addendum. The sizes are named only by family on
stdout; no drawing text is printed (patterns and counts only). Writes the git-ignored
fixtures/private/takeoffs/phase9_invisible.json.
"""

from __future__ import annotations

import collections
import json
import math
import re
import statistics
from fractions import Fraction

import pymupdf

from src.linking.lines import page_lines
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff import phase8_eval as P8
from tools.takeoff import phase9_lib as P
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_study import project_data
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

JOB = "job-018"
OUT = TAKEOFFS / "phase9_invisible.json"
NEIGH_PT = 120.0
ANCHOR_PT = 80.0
LEADER_PT = 24.0
HALF_WIDTHS = (150.0, 300.0, 600.0)

PATTERNS = {
    "@ spacing": re.compile(r"@"),
    "TYP": re.compile(r"\bTYP\b", re.IGNORECASE),
    "EQ SP": re.compile(r"\bEQ\.?\s*SP|\bEQUALLY\b|\bEQ\.", re.IGNORECASE),
    "O.C.": re.compile(r"\bO\.?\s?C\.?(?![A-Za-z])", re.IGNORECASE),
    "U.N.O.": re.compile(r"\bU\.?\s?N\.?\s?O\b", re.IGNORECASE),
    "count (n)": re.compile(r"\(\s*\d+\s*\)"),
}


def norm(s: str | None) -> str:
    return re.sub(r"[\s\"']", "", (s or "").upper()).replace("×", "X")


def frac_variants(d: Fraction) -> set[str]:
    """Ways a dimension is written: fraction or integer, and decimals with and without leading 0."""
    out = {str(d.numerator) if d.denominator == 1 else f"{d.numerator}/{d.denominator}"}
    f = float(d)
    for fmt in ("{:g}", "{:.2f}", "{:.3f}", "{:.4f}"):
        s = fmt.format(f)
        out.add(s)
        out.add(s.lstrip("0") if s.startswith("0.") else s)
    return {o for o in out if o}


def size_variants(size: str) -> tuple[list[str], list[str], str, list[list[str]]]:
    """(full strings, dimensions-only strings, family, per-dimension variants) of a canonical size."""
    prof = find_profiles(size)
    fam = re.match(r"[A-Z]+", size).group(0)
    dims = prof[0].dims if prof else ()
    per_dim = [sorted(frac_variants(d)) for d in dims]
    fulls, onlys = [], []
    combos = [[]]
    for v in per_dim:
        combos = [c + [x] for c in combos for x in v]
    for c in combos[:400]:
        fulls.append(fam + "X".join(c))
        onlys.append("X".join(c))
    if len(per_dim) > 2:  # the first two dimensions alone ("8X8" of "8X8X1/2")
        for a in per_dim[0]:
            for b in per_dim[1]:
                onlys.append(f"{a}X{b}")
    return fulls, onlys, fam, per_dim


def classify(items: list[dict], fulls, onlys, fam, per_dim) -> list[dict]:
    """For each item: its class ('full', 'dims', 'fragment' or None) in the order of the registered test."""
    out = []
    first = sorted({fam + v for v in per_dim[0]}) if per_dim else []
    for it in items:
        n = norm(it["text"])
        cls = None
        if any(f in n for f in fulls):
            cls = "full"
        elif any(o in n for o in onlys):
            cls = "dims"
        elif any(n.endswith(p) or n.endswith(p + "X") for p in first):
            # family and the first dimension at the end: is the rest in a neighbour on the baseline?
            for nb in items:
                if nb is it or abs(nb["cy"] - it["cy"]) > 6 or not (0 <= nb["x0"] - it["x1"] <= 20):
                    continue
                nn = norm(nb["text"])
                rest = [x for v in per_dim[1:] for x in v]
                if any(nn.startswith(x) or nn.startswith("X" + x) for x in rest):
                    cls = "fragment"
                    break
        out.append(dict(it, cls=cls))
    return out


def seg_dist(px: float, py: float, ln) -> float:
    ax, ay, bx, by = ln.x0, ln.y0, ln.x1, ln.y1
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def box_seg_dist(box, ln) -> float:
    """Smallest distance from a box to a segment (0 when they overlap or touch)."""
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    best = seg_dist(cx, cy, ln)
    for px, py in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        best = min(best, seg_dist(px, py, ln))
    for px, py in ((ln.x0, ln.y0), (ln.x1, ln.y1)):
        qx = min(max(px, x0), x1)
        qy = min(max(py, y0), y1)
        best = min(best, math.hypot(px - qx, py - qy))
    return best


def analyse(
    size: str, qty: float, conn, pid: str, pages_of_size: set[int], sheets, members, pdf
) -> dict:
    fulls, onlys, fam, per_dim = size_variants(size)
    members_of_size = [m for m in members if (m["profile"] or "").upper().replace(" ", "") == size]
    res: dict = {
        "family": fam,
        "takeoff_qty": qty,
        "members_with_profile": len(members_of_size),
        "members_linked": sum(1 for m in members_of_size if m["status"]["color"] != "unlinked"),
    }
    # ---- C1: text classes per page
    per_page: dict = {}
    occurrences: list[dict] = []
    parser_read = parser_not = 0
    for page_index, sh in sorted(sheets.items()):
        rows = conn.execute(
            "SELECT text, x0, y0, x1, y1, methods, level FROM text_items WHERE sheet_id = %s"
            " AND text IS NOT NULL AND (level = 'line' OR level IS NULL)",
            (sh["id"],),
        ).fetchall()
        items = [
            {
                "text": r["text"],
                "x0": float(r["x0"]),
                "y0": float(r["y0"]),
                "x1": float(r["x1"]),
                "y1": float(r["y1"]),
                "cx": (float(r["x0"]) + float(r["x1"])) / 2,
                "cy": (float(r["y0"]) + float(r["y1"])) / 2,
                "src": "stroke" if "glyph" in (r["methods"] or []) else "text layer",
            }
            for r in rows
        ]
        cl = classify(items, fulls, onlys, fam, per_dim)
        c = collections.Counter((x["src"], x["cls"]) for x in cl if x["cls"])
        per_page[page_index] = {f"{s}|{k}": v for (s, k), v in c.items()}
        for x in cl:
            if x["cls"] == "full":
                occurrences.append(dict(x, page=page_index, sheet_id=sh["id"], items=items))
                got = [p for p in find_profiles(x["text"]) if p.family == fam]
                if got and any(
                    [str(d) for d in p.dims] == [str(d) for d in find_profiles(size)[0].dims]
                    for p in got
                ):
                    parser_read += 1
                else:
                    parser_not += 1
    on = lambda pg: per_page.get(pg, {})  # noqa: E731
    res["text_classes_by_page"] = {pg: v for pg, v in sorted(per_page.items()) if v}
    res["pages_of_size"] = sorted(pages_of_size)
    res["page_facts"] = {}
    for pg in sorted(pages_of_size):
        sid = sheets[pg]["id"]
        cnt = conn.execute(
            "SELECT count(*) FILTER (WHERE level = 'line') AS pdf_lines,"
            " count(*) FILTER (WHERE 'glyph' = ANY(methods)) AS glyph,"
            " count(*) FILTER (WHERE text IS NULL) AS unread FROM text_items WHERE sheet_id = %s",
            (sid,),
        ).fetchone()
        res["page_facts"][pg] = dict(cnt)
    res["text_classes_on_those_pages"] = {pg: on(pg) for pg in sorted(pages_of_size)}
    total: collections.Counter = collections.Counter()
    for v in per_page.values():
        total.update(v)
    res["text_classes_project_total"] = dict(total)
    res["pages_with_full_text_anywhere"] = sorted(
        pg for pg, v in per_page.items() if any(k.endswith("|full") for k in v)
    )
    res["full_occurrences_total"] = len(occurrences)
    res["full_occurrences_on_those_pages"] = sum(
        1 for o in occurrences if o["page"] in pages_of_size
    )
    res["parser_reads_occurrence"] = parser_read
    res["parser_does_not_read_occurrence"] = parser_not
    where = (
        "text layer"
        if any(o["src"] == "text layer" for o in occurrences)
        else ("stroke" if occurrences else "nowhere")
    )
    res["found_in"] = where

    # ---- C1: surrounding patterns of each full occurrence
    own = collections.Counter()
    near = collections.Counter()
    words5 = 0
    linked = touching = 0
    mem_pos = [
        (
            m["sheet_id"],
            (m["bbox"]["x0"] + m["bbox"]["x1"]) / 2,
            (m["bbox"]["y0"] + m["bbox"]["y1"]) / 2,
            m,
        )
        for m in members
        if m.get("bbox")
    ]
    lines_cache: dict[int, list] = {}
    for o in occurrences:
        for name, rx in PATTERNS.items():
            own[name] += bool(rx.search(o["text"]))
        nb = " ".join(
            i["text"]
            for i in o["items"]
            if i is not o and math.hypot(i["cx"] - o["cx"], i["cy"] - o["cy"]) <= NEIGH_PT
        )
        for name, rx in PATTERNS.items():
            near[name] += bool(rx.search(o["text"] + " " + nb))
        words5 += len(o["text"].split()) >= 5
        o["member"] = next(
            (
                m
                for sid, mx, my, m in mem_pos
                if sid == o["sheet_id"] and math.hypot(mx - o["cx"], my - o["cy"]) <= 10
            ),
            None,
        )
        linked += bool(o["member"] and o["member"]["status"]["color"] != "unlinked")
        pg = o["page"]
        if pg not in lines_cache:
            lines_cache[pg] = [ln for ln in page_lines(pdf[pg]) if ln.length >= 3.0]
        box = (o["x0"], o["y0"], o["x1"], o["y1"])
        touching += any(box_seg_dist(box, ln) <= LEADER_PT for ln in lines_cache[pg])
    n = len(occurrences)
    res["patterns"] = {
        "occurrences": n,
        "own line": dict(own),
        "own line + text within 120 pt": dict(near),
        "own line has 5+ words": words5,
        "member found at the label": sum(1 for o in occurrences if o["member"]),
        "label linked to a line by our linking": linked,
        "a line of any class within 24 pt of the label": touching,
    }

    # ---- C2: parallel lines in the region
    anchored = 0
    counts = {w: [] for w in HALF_WIDTHS}
    anchor_kind = collections.Counter()
    for o in occurrences:
        lines = lines_cache[o["page"]]
        a = None
        m = o["member"]
        if m and m["link"]["line"]:
            p, q = m["link"]["line"]["p"], m["link"]["line"]["q"]
            a = min(
                lines,
                key=lambda ln: min(
                    math.hypot(ln.x0 - p[0], ln.y0 - p[1]) + math.hypot(ln.x1 - q[0], ln.y1 - q[1]),
                    math.hypot(ln.x0 - q[0], ln.y0 - q[1]) + math.hypot(ln.x1 - p[0], ln.y1 - p[1]),
                ),
                default=None,
            )
            anchor_kind["linked line"] += a is not None
        if a is None and lines:
            best = min(lines, key=lambda ln: seg_dist(o["cx"], o["cy"], ln))
            if seg_dist(o["cx"], o["cy"], best) <= ANCHOR_PT:
                a = best
                anchor_kind["nearest line within 80 pt"] += 1
        if a is None:
            anchor_kind["no anchor"] += 1
            continue
        anchored += 1
        arr = [[ln.x0, ln.y0, ln.x1, ln.y1] for ln in lines]
        klass = [ln.klass for ln in lines]
        for w in HALF_WIDTHS:
            counts[w].append(
                P.parallel_lines_in_region(
                    [a.x0, a.y0, a.x1, a.y1], arr, w, klass=klass, anchor_klass=a.klass
                )
            )
    res["anchors"] = dict(anchor_kind)
    res["region"] = {}
    for w, cs in counts.items():
        if not cs:
            res["region"][int(w)] = None
            continue
        med = statistics.median(cs)
        res["region"][int(w)] = {
            "occurrences_with_anchor": len(cs),
            "parallel lines min/median/max": [min(cs), med, max(cs)],
            "occurrences x median": n * med,
            "ratio to takeoff": (n * med / qty) if qty else None,
            "band": P.ratio_band(n * med / qty if qty else None),
        }
    res["ratio_occurrences_alone"] = (n / qty) if qty else None
    res["ratio_occurrences_alone_band"] = P.ratio_band(n / qty if qty else None)
    return res


def main() -> None:
    theirs, _ = P8.load_theirs()
    by = P8.tally(theirs, lambda r: r["size"], lambda r: r["qty"])
    ranked = sorted(by.items(), key=lambda x: -x[1])
    subject = next(s for s, q in ranked if q == 62)
    control = ranked[0][0]
    pid = json.loads(RUNS.read_text())[JOB]["project_id"]
    conn = connect()
    tokens = {t for r in theirs for t in r["tokens"]}
    token_page, id_of = P8.map_sheets(conn, pid, tokens)
    sheets = {
        r["page_index"]: {"id": str(r["id"])}
        for r in conn.execute("SELECT id, page_index FROM sheets WHERE project_id = %s", (pid,))
    }
    data = project_data(pid)
    members = data["members"]
    pdf = pymupdf.open(stored_pdf(conn, pid))
    out: dict = {}
    for label, size in (("subject", subject), ("control", control)):
        rows = [r for r in theirs if r["size"] == size]
        pages = {token_page.get(t) for r in rows for t in r["tokens"]}
        pages_of = {p for p in pages if p is not None}
        info = {
            "rows": len(rows),
            "row_quantities": [r["qty"] for r in rows],
            "references_per_row": [len(r["tokens"]) for r in rows],
            "unmapped_references": sum(
                1 for r in rows for t in r["tokens"] if token_page.get(t) is None
            ),
        }
        qty = sum(r["qty"] for r in rows)
        res = analyse(size, qty, conn, pid, pages_of, sheets, members, pdf)
        out[label] = {"rows": info, **res}
        print(f"== {label} ({res['family']}) ==")
        print(json.dumps(out[label], indent=1, default=str))
    OUT.write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
