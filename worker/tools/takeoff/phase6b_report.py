"""Phase 6b: pooled tables from phase6b_study.json (Parts B, C, D) and the Part E pictures."""

from __future__ import annotations

import collections
import json

import pymupdf

from tools.takeoff.common import PRIVATE, TAKEOFFS, drawing_documents
from tools.takeoff.phase6b_lib import page_agreement, prf, verdict

BASES = ("label_first", "line_with_label", "line_first")
RADII = (6, 12, 24)


def load() -> dict:
    return json.loads((TAKEOFFS / "phase6b_study.json").read_text())


def pooled(pages: list[dict], basis: str, mode: str) -> dict:
    syms = sum(p["theirs"] for p in pages)
    ours = sum(p["bases"][basis][mode]["pieces"] for p in pages)
    out: dict = {"pages": len(pages), "theirs": syms, "ours": ours}
    ag = [page_agreement(p["bases"][basis][mode]["pieces"], p["theirs"]) for p in pages]
    for k in ("equal", "within1", "within20"):
        out[k] = sum(a[k] for a in ag) / len(ag) if ag else None
        out[f"{k}_n"] = sum(a[k] for a in ag)
    for r in RADII:
        m = sum(p["bases"][basis][mode][f"matched_{r}"] for p in pages)
        P, R, F = prf(m, ours, syms)
        out[f"P{r}"], out[f"R{r}"], out[f"F{r}"] = P, R, F
        out[f"matched{r}"] = m
    out["verdict"] = verdict(out["within1"], out["P12"], out["R12"])
    return out


def fmt(x, pct=False) -> str:
    if x is None:
        return "-"
    return f"{x * 100:.1f}%" if pct else f"{x:.2f}"


def summary() -> dict:
    d = load()
    pages = d["pages"]
    vec = [p for p in pages if not p["raster"]]
    s: dict = {
        "n_pages": len(pages),
        "n_vector_pages": len(vec),
        "theirs": sum(p["theirs"] for p in pages),
    }
    s["bases"] = {
        b: {
            mode: {"all": pooled(pages, b, mode), "vector": pooled(vec, b, mode)}
            for mode in ("suggested", "oracle")
        }
        for b in BASES
    }
    # by colour (precision at 12 pt)
    s["by_colour"] = {}
    for b in ("label_first", "line_with_label"):
        cp, cm = collections.Counter(), collections.Counter()
        for p in pages:
            sc = p["bases"][b]["suggested"]
            cp.update(sc.get("colour_pieces", {}))
            cm.update(sc.get("colour_matched", {}))
        s["by_colour"][b] = {c: {"pieces": cp[c], "matched": cm[c]} for c in cp}
    # per job (suggested)
    s["per_job"] = {}
    for job in sorted({p["job"] for p in pages}):
        jp = [p for p in pages if p["job"] == job]
        s["per_job"][job] = {b: pooled(jp, b, "suggested") for b in BASES}
    # recall by their colour+shape group (suggested and oracle) for label-first and line-first
    groups = collections.defaultdict(lambda: collections.Counter())
    for p in pages:
        for sy in p["symbols"]:
            groups[sy["group"]]["n"] += 1
            groups[sy["group"]]["matched_label_first"] += int(sy["matched"])
    s["groups"] = {g: dict(c) for g, c in sorted(groups.items(), key=lambda kv: -kv[1]["n"])}
    # miss reasons (label-first, suggested, 12 pt)
    miss = collections.Counter(
        sy.get("reason") for p in pages for sy in p["symbols"] if not sy["matched"]
    )
    s["miss_reasons"] = dict(miss)
    s["piece_reasons"] = dict(
        collections.Counter(r for p in pages for r in p.get("piece_reasons", []))
    )
    s["extra_pieces_on_pages_without_symbols"] = sum(e["ours"] for e in d["extra"])
    # pre-Part-A (Stage 1 pieces, positions re-read)
    pre = [p for p in pages if p.get("pre_a")]
    syms = sum(p["theirs"] for p in pre)
    ours = sum(p["pre_a"]["pieces"] for p in pre)
    s["pre_a"] = {"pages": len(pre), "theirs": syms, "ours": ours}
    for r in RADII:
        m = sum(p["pre_a"][f"matched_{r}"] for p in pre)
        s["pre_a"][f"P{r}"], s["pre_a"][f"R{r}"], s["pre_a"][f"F{r}"] = prf(m, ours, syms)
    unmatched_pre = 0
    excluded_pre = 0
    for p in pre:
        un = p["theirs"] - p["pre_a"]["matched_12"]
        unmatched_pre += un
        if p.get("pre_a_sheet_excluded"):
            excluded_pre += un
    s["pre_a"]["unmatched_symbols"] = unmatched_pre
    s["pre_a"]["unmatched_on_excluded_sheets"] = excluded_pre
    # coverage limits (Part D)
    n = sum(p["theirs"] for p in pages)
    raster = sum(p["theirs"] for p in pages if p["raster"])
    sy = [sy for p in vec for sy in p["symbols"]]
    s["coverage"] = {
        "symbols": n,
        "on_raster_pages": raster,
        "vector_no_class_lines": sum(1 for x in sy if x["no_class_lines"]),
        "outside_view_box": sum(1 for x in sy if x["outside_box"]),
        "in_small_shape_no_line_12": sum(1 for x in sy if x["in_small_shape_no_line"]),
        "on_line_12": sum(1 for x in sy if x["on_line_12"]),
        "any_line_24": sum(1 for x in sy if x["any_line_24"]),
        "no_line_24": sum(1 for x in sy if not x["any_line_24"]),
    }
    s["line_class"] = dict(collections.Counter(x["line_class"] for x in sy))
    per_job_groups = collections.defaultdict(lambda: collections.Counter())
    for p in pages:
        per_job_groups[p["job"]]["n"] += p["theirs"]
        per_job_groups[p["job"]]["pages"] += 1
    s["symbols_per_job"] = {j: dict(c) for j, c in sorted(per_job_groups.items())}
    s["line_first_lines"] = {
        "lines": sum(p.get("line_first_lines", 0) for p in vec),
        "with_label": sum(p.get("line_first_with_label", 0) for p in vec),
    }
    s["consistency"] = {
        "pages": len(vec),
        "api_equals_inprocess": sum(
            1 for p in vec if p.get("api_drawn") == p.get("inproc_label_first")
        ),
    }
    (TAKEOFFS / "phase6b_summary.json").write_text(json.dumps(s, indent=1, default=str))
    return s


def report() -> None:
    s = summary()
    print("pages", s["n_pages"], "vector", s["n_vector_pages"], "symbols", s["theirs"])
    print(
        "\nbasis / mode / population: equal within1 within20 | ours theirs | P R F @6 @12 @24 | verdict"
    )
    for b in BASES:
        for mode in ("suggested", "oracle"):
            for pop in ("all", "vector"):
                x = s["bases"][b][mode][pop]
                print(
                    f"{b:16} {mode:9} {pop:6} {fmt(x['equal'], True):>7} {fmt(x['within1'], True):>7} {fmt(x['within20'], True):>7} | "
                    f"{x['ours']:5} {x['theirs']:5} | "
                    + " ".join(
                        f"{fmt(x['P%d' % r])}/{fmt(x['R%d' % r])}/{fmt(x['F%d' % r])}"
                        for r in RADII
                    )
                    + f" | {x['verdict']}"
                )
    for k in (
        "by_colour",
        "pre_a",
        "miss_reasons",
        "piece_reasons",
        "coverage",
        "line_class",
        "line_first_lines",
        "consistency",
        "groups",
        "extra_pieces_on_pages_without_symbols",
    ):
        print("\n" + k, json.dumps(s[k], indent=1, default=str))
    print("\nper job (label_first / line_with_label / line_first F12):")
    for j, v in s["per_job"].items():
        print(j, v["label_first"]["theirs"], *[f"{b}:{fmt(v[b]['F12'])}" for b in BASES])


# ---- Part E -------------------------------------------------------------------------------------
def shots() -> None:
    d = load()
    pages = [p for p in d["pages"] if p["theirs"] >= 10 and not p["raster"]]

    def worst(p: dict) -> float:
        return max(
            abs(p["bases"][b]["suggested"]["pieces"] - p["theirs"]) / p["theirs"] for b in BASES
        )

    ranked = sorted(pages, key=lambda p: (worst(p), p["job"], p["page"]))
    agree, disagree = ranked[:6], sorted(pages, key=lambda p: (-worst(p), p["job"], p["page"]))[:6]
    out = PRIVATE / "shots" / "phase6b"
    out.mkdir(parents=True, exist_ok=True)
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    by_job = {i["match"]: (n, i) for n, i in inv.items() if i.get("match")}
    listing = []
    from tools.takeoff import phase6b_study as st

    runs = json.loads((TAKEOFFS / "phase6b_projects.json").read_text())
    for tag, group in (("agree", agree), ("disagree", disagree)):
        for p in group:
            job, dp = p["job"], p["page"]
            name, info = by_job[job]
            tp = next(int(k) for k, v in info["page_map"].items() if v == dp)
            with pymupdf.open(TAKEOFFS / name) as tdoc, pymupdf.open(draws[job]) as ddoc:
                syms = st.their_symbols(tdoc[tp])
                page = ddoc[dp]
                data = st.project_data(runs[job]["project_id"])
                sheet = data["sheets"][dp]
                mem = [m for m in data["members"] if m["sheet_id"] == sheet["id"]]
                from src.linking.labels import page_labels
                from src.linking.lines import page_lines
                from src.linking.structural import lines_in_box, suggest_classes, class_table
                from src.review.auto_run import whole_sheet_box

                size = (page.rect.width, page.rect.height)
                bx = whole_sheet_box(*size)
                box = (bx["x0"], bx["y0"], bx["x1"], bx["y1"])
                in_view = lines_in_box(page_lines(page), box, size)
                classes = suggest_classes(class_table(in_view))
                structural = [ln for ln in in_view if ln.klass in classes]
                labels = page_labels(page, sheet["id"], data["marks"])
                counted = {
                    st.bbox_key(m["bbox"]): m
                    for m in mem
                    if m["bbox"]
                    and m["counting"] == "counted"
                    and m["status"]["color"] != "unlinked"
                }
                lab = [lb for lb in labels if st.bbox_key(lb.bbox) in counted]
                res = st.bases_for(lab, structural, {})
                inv_m = ~page.rotation_matrix

                def P(x, y, m=inv_m):
                    return pymupdf.Point(x, y) * m

                for s_ in structural:
                    if s_.length >= 12:
                        page.draw_line(
                            P(s_.x0, s_.y0), P(s_.x1, s_.y1), color=(1, 0.55, 0), width=1.2
                        )
                for pc in res["line_with_label"]:
                    if pc.line:
                        page.draw_line(
                            P(pc.line[0], pc.line[1]),
                            P(pc.line[2], pc.line[3]),
                            color=(0, 0.7, 0),
                            width=3,
                        )
                for pc in res["label_first"]:
                    if pc.box:
                        c = P((pc.box[0] + pc.box[2]) / 2, (pc.box[1] + pc.box[3]) / 2)
                        page.draw_circle(c, 7, color=(0.85, 0, 0), fill=(0.85, 0, 0), width=1)
                for sy in syms:
                    page.draw_circle(P(sy["x"], sy["y"]), 12, color=(0, 0.2, 1), width=2.5)
                zoom = min(2400 / max(page.rect.width, page.rect.height), 1.0)
                fn = f"{tag}-{job}-p{dp + 1}.png"
                page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).save(out / fn)
                listing.append(
                    (
                        tag,
                        job,
                        dp,
                        p["theirs"],
                        [p["bases"][b]["suggested"]["pieces"] for b in BASES],
                        fn,
                    )
                )
    (out / "INDEX.json").write_text(json.dumps(listing, indent=1))
    for row in listing:
        print(row)
