"""STEP 1: choose up to 8 documents and their pages, by structure only. Writes selection.json.

Documents: one per producer category first, then greedy farthest-point on structural features
(pages, text volume, circles, chained dashes, layers, file size). Pages: the plan-like pages are the
large pages with the most profile-pattern hits; schedule, legend and elevation pages are found by
generic keyword and pattern counts. The result is recorded before any link result is looked at.
"""

import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
from src.pdf_scan.scale import normalize  # noqa: E402
from src.text_layer.parsers.elevation import find_elevations  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

HEADER = ("MARK", "SIZE", "QTY", "QUANTITY", "LENGTH", "WEIGHT", "PROFILE", "ELEV")
N_DOCS = 8
N_PLAN_PAGES = 4
FEATURES = (
    "pages",
    "median_chars_per_page",
    "circles",
    "exploded_dash_segments",
    "ocg_layers",
    "file_mb",
)


def feature_vector(row: dict) -> list[float]:
    return [math.log1p(float(row[k] or 0)) for k in FEATURES]


def choose_docs(inv: dict[str, dict], candidates: list[str]) -> list[str]:
    vecs = {i: feature_vector(inv[i]) for i in candidates}
    cols = list(zip(*vecs.values(), strict=True))
    lo, hi = [min(c) for c in cols], [max(c) for c in cols]
    norm = {
        i: [(v - a) / (b - a) if b > a else 0.0 for v, a, b in zip(vec, lo, hi, strict=True)]
        for i, vec in vecs.items()
    }
    chosen: list[str] = []
    for cat in ("Bluebeam", "AutoCAD", "other", "unknown"):
        pool = sorted(i for i in candidates if inv[i]["producer_category"] == cat)
        if not pool:
            continue
        if not chosen:
            chosen.append(pool[0])
        else:
            chosen.append(max(pool, key=lambda i: min(math.dist(norm[i], norm[c]) for c in chosen)))
    while len(chosen) < min(N_DOCS, len(candidates)):
        rest = sorted(i for i in candidates if i not in chosen)
        chosen.append(max(rest, key=lambda i: min(math.dist(norm[i], norm[c]) for c in chosen)))
    return sorted(chosen)


def page_stats(page) -> dict:
    text = page.get_text("text")
    clean = normalize(text.replace("\n", " "))
    profiles = len(find_profiles(clean))
    upper = clean.upper()
    return {
        "profile_hits": profiles,
        "header_words": sum(1 for k in HEADER if re.search(rf"\b{k}", upper)),
        "legend_word": bool(re.search(r"\bLEGEND\b", upper)),
        "elevation_notes": len(find_elevations(clean)),
        "elevation_word": len(re.findall(r"\bELEVATION", upper)),
        "words": len(text.split()),
    }


def doc_page_stats(jid: str) -> tuple[list[int], dict[int, dict]]:
    with common.open_doc(jid) as doc:
        pages = common.large_pages(doc)
        return pages, {i: page_stats(doc[i]) for i in pages}


def main() -> None:
    inv = common.inventory_rows()
    rows = common.doc_rows()
    candidates = sorted(
        i
        for i, r in rows.items()
        if r.get("status") in ("kept", "near-duplicate") and inv[i]["text_layer"] == "yes"
    )
    all_stats = {jid: doc_page_stats(jid) for jid in candidates}
    # a document needs at least 3 plan-like pages (3 or more profile hits) to be studied
    eligible = [
        jid
        for jid in candidates
        if sum(1 for st in all_stats[jid][1].values() if st["profile_hits"] >= 3) >= 3
    ]
    print(f"candidates: {len(candidates)}  eligible (3+ plan-like pages): {len(eligible)}")
    docs = choose_docs(inv, eligible)
    selection: dict[str, dict] = {}
    for jid in docs:
        pages, stats = all_stats[jid]
        plan = sorted(pages, key=lambda i: (-stats[i]["profile_hits"], i))[:N_PLAN_PAGES]
        plan = [i for i in plan if stats[i]["profile_hits"] >= 3]
        schedule = [i for i in pages if stats[i]["header_words"] >= 3 and i not in plan][:2]
        legend = [i for i in pages if stats[i]["legend_word"] and i not in plan][:2]
        elevation = [
            i
            for i in pages
            if stats[i]["elevation_notes"] >= 6 and i not in plan + schedule + legend
        ][:2]
        selection[jid] = {
            "producer_category": inv[jid]["producer_category"],
            "large_pages": len(pages),
            "plan_pages": sorted(plan),
            "schedule_pages": schedule,
            "legend_pages": legend,
            "elevation_pages": elevation,
            "page_stats": {
                str(i): stats[i] for i in sorted({*plan, *schedule, *legend, *elevation})
            },
        }
    out = common.STUDY / "selection.json"
    out.write_text(json.dumps({"documents": docs, "selection": selection}, indent=1))
    for jid, s in selection.items():
        print(
            jid, s["producer_category"], "plan", len(s["plan_pages"]), "schedule",
            len(s["schedule_pages"]), "legend", len(s["legend_pages"]), "elevation",
            len(s["elevation_pages"]),
        )  # fmt: skip


if __name__ == "__main__":
    main()
