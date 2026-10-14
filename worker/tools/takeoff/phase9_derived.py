"""Phase 9 Part B2: the derived route and the total-count cross-check (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase9_derived
Each count symbol of the marked-up PDFs gets the size of the nearest size label of the drawing's
text layer within 80 pt (docs/PHASE9_PREREGISTRATION.md section 2). Agreement figures exist for
job-018 only (the only job with a finished quantity takeoff). Counts only on stdout; the tables go
to the git-ignored fixtures/private/takeoffs/phase9_derived.json.
"""

from __future__ import annotations

import collections
import json
import math
import re

import pymupdf

from tools.takeoff import phase8_eval as P8
from tools.takeoff import phase8_eval_lib as E
from tools.takeoff import phase9_lib as P
from tools.takeoff.common import TAKEOFFS, drawing_documents
from tools.takeoff.geometry_study import vertices_of
from tools.takeoff.phase6c_trace import RUNS, connect
from tools.takeoff.phase9_markups import matched_files

RADIUS = 80.0
JOB = "job-018"
OUT = TAKEOFFS / "phase9_derived.json"


def size_labels(page: pymupdf.Page) -> list[tuple[str, float, float]]:
    """(canonical size, cx, cy) of every text line holding a steel size, in the rotated frame."""
    out = []
    m = page.rotation_matrix
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"])
            canon = P.canonical_from_text(text)
            if canon:
                r = pymupdf.Rect(ln["bbox"]) * m
                out.append((canon, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
    return out


def symbols(page: pymupdf.Page) -> list[tuple[float, float]]:
    out = []
    for a in page.annots() or []:
        if a.type[1] == "Polygon":
            v = vertices_of(a, page)
            if len(v) in (3, 8):
                out.append((sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)))
    return out


def assign(syms, labels, radius=RADIUS):
    """size of the nearest label within `radius` (ties: the first), or None."""
    res = []
    for sx, sy in syms:
        best, bd = None, radius
        for canon, lx, ly in labels:
            d = math.hypot(lx - sx, ly - sy)
            if d <= bd:
                best, bd = canon, d
        res.append(best)
    return res


def size_key(size: str) -> str:
    """Comparison key: inch and foot marks removed (they are formatting, not part of the size)."""
    return re.sub(r"[\"']", "", size)


def theirs_all_profile_rows() -> list[dict]:
    """Every profile row (shape code and dimension size) with a numeric quantity, any kind."""
    rows = json.loads(P8.ROWS.read_text())["rows"]
    out = []
    for r in rows:
        q = E.num(r.get("qty"))
        size = E.canonical_size(r.get("shape"), r.get("size"))
        if q is None or size is None:
            continue
        out.append({"qty": q, "size": size_key(size), "tokens": E.ref_tokens(r.get("ref"))})
    return out


def main() -> None:
    draws = drawing_documents()
    files = matched_files()
    cover: dict = {}
    tables: dict = {}
    sym_by_page: dict = {}
    for name, info in files:
        job = info["match"]
        ddoc = pymupdf.open(draws[job])
        tdoc = pymupdf.open(TAKEOFFS / name)
        n_sym = n_sized = 0
        unmapped_syms = 0
        by_size: collections.Counter = collections.Counter()
        by_page_size: collections.Counter = collections.Counter()
        pm = {int(k): v for k, v in info["page_map"].items()}
        for tp, page in enumerate(tdoc):
            syms = symbols(page)
            if tp not in pm:
                unmapped_syms += len(syms)
                continue
            dp = pm[tp]
            labels = size_labels(ddoc[dp])
            got = assign(syms, labels)
            sym_by_page.setdefault(job, {})[dp] = len(syms)
            for s in got:
                n_sym += 1
                if s:
                    n_sized += 1
                    by_size[s] += 1
                    by_page_size[(dp, s)] += 1
        cover[job] = {
            "symbols_on_our_pages": n_sym,
            "symbols_elsewhere": unmapped_syms,
            "with_size": n_sized,
            "without_size": n_sym - n_sized,
            "distinct_sizes": len(by_size),
        }
        tables[job] = {
            "by_size": dict(by_size),
            "by_page_size": {f"{p}|{s}": v for (p, s), v in by_page_size.items()},
        }
    print("coverage per job (symbols on our pages, with a size within 80 pt):")
    tot = collections.Counter()
    for job, c in cover.items():
        print(f"  {job}: {c}")
        tot.update({k: v for k, v in c.items()})
    print(
        "all jobs:",
        dict(tot),
        f"share sized {tot['with_size'] / max(1, tot['symbols_on_our_pages']):.3f}",
    )

    # ---- cross-check, job-018
    theirs, tinfo = P8.load_theirs()
    for r in theirs:
        r["size"] = size_key(r["size"])
    pid = json.loads(RUNS.read_text())[JOB]["project_id"]
    conn = connect()
    tokens = {t for r in theirs for t in r["tokens"]}
    token_page, id_of = P8.map_sheets(conn, pid, tokens)
    w = P8.weights(conn)
    for r in theirs:
        pages = {token_page.get(t) for t in r["tokens"]}
        r["fully_mapped"] = bool(r["tokens"]) and None not in pages
        r["pages"] = sorted(p for p in pages if p is not None)
        r["single_page"] = r["pages"][0] if r["fully_mapped"] and len(r["pages"]) == 1 else None
    mapped_pages = {p for p in token_page.values() if p is not None}
    t = tables[JOB]
    result: dict = {"coverage": cover, "theirs_info": tinfo}
    for scope, pages in (("S1", mapped_pages), ("S2", set(id_of))):
        ours_by_size: collections.Counter = collections.Counter()
        ours_by_ps: collections.Counter = collections.Counter()
        for key, v in t["by_page_size"].items():
            p, s = key.split("|", 1)
            if int(p) in pages:
                ours_by_size[s] += v
                ours_by_ps[(int(p), s)] += v
        th_size = P8.tally(theirs, lambda r: r["size"], lambda r: r["qty"])
        g1 = E.group_metrics(th_size, dict(ours_by_size))
        wt = E.weight_error(th_size, dict(ours_by_size), w)
        t_single = [r for r in theirs if r["single_page"] is not None]
        sp = {r["single_page"] for r in t_single}
        g3 = E.group_metrics(
            P8.tally(t_single, lambda r: (r["single_page"], r["size"]), lambda r: r["qty"]),
            {k: v for k, v in ours_by_ps.items() if k[0] in sp},
        )
        fam = lambda sz: re.match(r"[A-Z]+", sz.replace("PL:", "PL")).group(0)  # noqa: E731
        result[scope + "_per_size"] = sorted(
            (fam(sz), th_size.get(sz, 0), ours_by_size.get(sz, 0))
            for sz in set(th_size) | set(ours_by_size)
        )
        result[scope] = {
            "G1": g1,
            "G3": g3,
            "weight": wt,
            "reading": E.reading(g1["theirs_keys"]["within20"], wt["absolute"]),
        }
    # ---- total-count cross-check (no size needed)
    allrows = theirs_all_profile_rows()
    sym_pages = sym_by_page.get(JOB, {})
    total_syms_s1 = sum(v for p, v in sym_pages.items() if p in mapped_pages)
    total_syms_s2 = sum(sym_pages.values())
    token_rows = [dict(r, pages={token_page.get(x) for x in r["tokens"]}) for r in allrows]
    single = [
        r for r in token_rows if r["tokens"] and None not in r["pages"] and len(r["pages"]) == 1
    ]
    per_page_theirs = collections.Counter()
    for r in single:
        per_page_theirs[next(iter(r["pages"]))] += r["qty"]
    pairs = [(per_page_theirs[p], sym_pages.get(p, 0)) for p in sorted(per_page_theirs)]
    result["totals"] = {
        "symbols_on_mapped_pages_S1": total_syms_s1,
        "symbols_on_all_our_pages_S2": total_syms_s2,
        "theirs_main_steel_qty": sum(r["qty"] for r in theirs),
        "theirs_all_profile_rows_qty": sum(r["qty"] for r in allrows),
        "single_page_pages": len(pairs),
        "single_page_theirs_qty": sum(a for a, _ in pairs),
        "symbols_on_those_pages": sum(b for _, b in pairs),
        "pages_symbols_within_20pct": sum(1 for a, b in pairs if a and abs(b - a) <= 0.2 * a),
        "pages_symbols_exact": sum(1 for a, b in pairs if a == b),
    }
    OUT.write_text(json.dumps(result, indent=1, default=str))
    print(json.dumps({k: result[k] for k in ("S2", "totals")}, indent=1, default=str))
    print("per size (family, theirs, ours), S2:", result["S2_per_size"])


if __name__ == "__main__":
    main()
