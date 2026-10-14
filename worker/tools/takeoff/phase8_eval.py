"""Phase 8 Part A: quantity-level evaluation against the estimator's finished takeoff (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase8_eval
Needs the read-only API on PHASE6B_API (default http://127.0.0.1:3100). Theirs: the registered
columns already extracted to fixtures/private/target/rows.json. Ours: the members of the Phase 6b
project of the same job. Writes fixtures/private/takeoffs/phase8_eval.json; prints counts only (no
workbook text). Definitions: docs/PHASE8_PREREGISTRATION.md.
"""

from __future__ import annotations

import collections
import json

from tools.takeoff import kind_study
from tools.takeoff import phase8_eval_lib as E
from tools.takeoff.common import PRIVATE, TAKEOFFS
from tools.takeoff.phase6b_study import project_data
from tools.takeoff.phase6c_trace import RUNS, connect

JOB = "job-018"
ROWS = PRIVATE / "target" / "rows.json"
OUT = TAKEOFFS / "phase8_eval.json"
EDITION = "aisc-v16.0"


def load_theirs() -> tuple[list[dict], dict]:
    rows = json.loads(ROWS.read_text())["rows"]
    data = [r for r in rows if E.num(r.get("qty")) is not None]
    out, drop = [], collections.Counter()
    for r in data:
        size = E.canonical_size(r.get("shape"), r.get("size"))
        if size is None:
            drop["not a profile row (no shape or no dimension size)"] += 1
            continue
        kind, group = kind_study.kind_of(r.get("name"))
        if group in (kind_study.MISC, kind_study.EXCL):
            drop[f"dropped by kind group {group}"] += 1
            continue
        out.append(
            {
                "qty": E.num(r["qty"]),
                "size": size,
                "kind": kind if group == kind_study.MAIN else "unmapped",
                "tokens": E.ref_tokens(r.get("ref")),
            }
        )
    return out, {"data_rows": len(data), "kept": len(out), "dropped": dict(drop)}


def map_sheets(conn, pid: str, tokens: set[str]) -> tuple[dict, dict]:
    pages = conn.execute(
        "SELECT id, page_index, width_pt, height_pt FROM sheets WHERE project_id = %s", (pid,)
    ).fetchall()
    lines, sizes = {}, {}
    for p in pages:
        lines[p["page_index"]] = [
            (t["text"] or "", t["x0"], t["y0"], t["x1"], t["y1"])
            for t in conn.execute(
                "SELECT text, x0, y0, x1, y1 FROM text_items WHERE sheet_id = %s AND level = 'line'",
                (p["id"],),
            )
        ]
        sizes[p["page_index"]] = (p["width_pt"], p["height_pt"])
    return E.map_tokens(sorted(tokens), lines, sizes), {
        p["page_index"]: str(p["id"]) for p in pages
    }


def weights(conn) -> dict[str, float]:
    rows = conn.execute(
        "SELECT shape_name, weight_lb_per_ft FROM catalog_shapes WHERE edition = %s", (EDITION,)
    ).fetchall()
    return {
        r["shape_name"].upper().replace(" ", ""): float(r["weight_lb_per_ft"])
        for r in rows
        if r["weight_lb_per_ft"] is not None
    }


def ours_members(pid: str, page_of: dict[str, int]) -> tuple[list[dict], dict]:
    data = project_data(pid)
    out, skip = [], collections.Counter()
    for m in data["members"]:
        if (
            m["deleted"]
            or m["merged_into"] is not None
            or m["not_member"] is not None
            or m["existing"]
        ):
            skip["deleted, merged, not a member or existing"] += 1
            continue
        if m["type"] == "joist" or m["counting"] != "counted":
            skip["joist or not counted kind"] += 1
            continue
        scope = (m["kind"] or {}).get("scope")
        if scope not in (None, "main"):
            skip["kind scope not main"] += 1
            continue
        if not m["profile"]:
            skip["no profile"] += 1
            continue
        sl = m["shared_line"]
        linked = m["status"]["color"] != "unlinked"
        out.append(
            {
                "page": page_of.get(m["sheet_id"]),
                "size": m["profile"].upper().replace(" ", ""),
                "kind": (m["kind"] or {}).get("name") or "unmapped",
                "linked": linked,
                "label_q": m["quantity"],
                "line_q": m["quantity"] if (sl is None or sl["line_piece"]) else 0,
            }
        )
    return out, dict(skip)


def tally(items: list[tuple], keyf, qf) -> dict:
    d: dict = collections.defaultdict(float)
    for it in items:
        d[keyf(it)] += qf(it)
    return {k: v for k, v in d.items() if v > 0}


def evaluate(theirs_rows, ours, pages_scope, w) -> dict:
    """All groupings for one scope. `ours` rows are already restricted to the scope's pages."""
    res: dict = {}
    t_all = theirs_rows
    t_single = [r for r in t_all if r["single_page"] is not None]
    variants = {
        "display": [(x, x["line_q"]) for x in ours if x["linked"]],
        "label": [(x, x["label_q"]) for x in ours if x["linked"]],
        "B1 naive label count": [(x, 1) for x in ours],
    }
    # B2: each distinct size on a sheet counts 1
    seen = {(x["page"], x["size"]): x for x in ours}
    variants["B2 distinct sizes per sheet"] = [(x, 1) for x in seen.values()]
    for vname, items in variants.items():
        v: dict = {}
        v["G1"] = E.group_metrics(
            tally(t_all, lambda r: r["size"], lambda r: r["qty"]),
            tally(items, lambda it: it[0]["size"], lambda it: it[1]),
        )
        v["G2"] = E.group_metrics(
            tally(t_all, lambda r: (r["kind"], r["size"]), lambda r: r["qty"]),
            tally(items, lambda it: (it[0]["kind"], it[0]["size"]), lambda it: it[1]),
        )
        sp = {r["single_page"] for r in t_single}
        its = [it for it in items if it[0]["page"] in sp]
        v["G3"] = E.group_metrics(
            tally(t_single, lambda r: (r["single_page"], r["size"]), lambda r: r["qty"]),
            tally(its, lambda it: (it[0]["page"], it[0]["size"]), lambda it: it[1]),
        )
        v["G4"] = E.group_metrics(
            tally(t_single, lambda r: (r["single_page"], r["kind"], r["size"]), lambda r: r["qty"]),
            tally(its, lambda it: (it[0]["page"], it[0]["kind"], it[0]["size"]), lambda it: it[1]),
        )
        v["weight"] = E.weight_error(
            tally(t_all, lambda r: r["size"], lambda r: r["qty"]),
            tally(items, lambda it: it[0]["size"], lambda it: it[1]),
            w,
        )
        v["reading"] = E.reading(v["G1"]["theirs_keys"]["within20"], v["weight"]["absolute"])
        res[vname] = v
    return res


def main() -> None:
    theirs, tinfo = load_theirs()
    pid = json.loads(RUNS.read_text())[JOB]["project_id"]
    conn = connect()
    tokens = {t for r in theirs for t in r["tokens"]}
    token_page, id_of = map_sheets(conn, pid, tokens)
    page_of = {sid: p for p, sid in id_of.items()}
    for r in theirs:
        pages = {token_page.get(t) for t in r["tokens"]}
        r["fully_mapped"] = bool(r["tokens"]) and None not in pages
        r["pages"] = sorted(p for p in pages if p is not None)
        r["single_page"] = r["pages"][0] if r["fully_mapped"] and len(r["pages"]) == 1 else None
    w = weights(conn)
    ours, oskip = ours_members(pid, page_of)
    mapped_pages = {p for p in token_page.values() if p is not None}
    info = {
        "theirs": tinfo,
        "theirs_qty": sum(r["qty"] for r in theirs),
        "tokens": len(tokens),
        "tokens_mapped": sum(1 for p in token_page.values() if p is not None),
        "rows_fully_mapped": sum(r["fully_mapped"] for r in theirs),
        "rows_single_page": sum(r["single_page"] is not None for r in theirs),
        "rows_with_no_token": sum(not r["tokens"] for r in theirs),
        "qty_fully_mapped": sum(r["qty"] for r in theirs if r["fully_mapped"]),
        "pages_total": len(id_of),
        "pages_mapped": len(mapped_pages),
        "ours_skipped": oskip,
        "ours_counted_members": len(ours),
        "ours_no_page": sum(x["page"] is None for x in ours),
        "theirs_sizes": len({r["size"] for r in theirs}),
        "theirs_sizes_without_weight": len({r["size"] for r in theirs if r["size"] not in w}),
        "ours_sizes": len({x["size"] for x in ours}),
        "ours_sizes_without_weight": len({x["size"] for x in ours if x["size"] not in w}),
    }
    out = {
        "info": info,
        "S1": evaluate(theirs, [x for x in ours if x["page"] in mapped_pages], mapped_pages, w),
        "S2": evaluate(theirs, ours, set(id_of), w),
    }
    OUT.write_text(json.dumps(out, indent=1, default=str))
    print(json.dumps(info, indent=1, default=str))
    f = lambda v: "none" if v is None else f"{v:.2f}"  # noqa: E731
    for scope in ("S1", "S2"):
        print("==", scope)
        for vname, v in out[scope].items():
            row = []
            for g in ("G1", "G2", "G3", "G4"):
                m = v[g]
                tk = m["theirs_keys"]
                row.append(
                    f"{g}: n={tk['n']} ex={f(tk['exact'])} w1={f(tk['within1'])} w20={f(tk['within20'])} err={f(m['error_rate'])}"
                )
            wt = v["weight"]
            print(
                f"{vname:34s} ours_total={v['G1']['ours_total']:.0f} theirs_total={v['G1']['theirs_total']:.0f} | "
                + " | ".join(row)
                + f" | weight signed={f(wt['signed'])} abs={f(wt['absolute'])} | {v['reading']}"
            )


if __name__ == "__main__":
    main()
