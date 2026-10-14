"""Phase 9 Part B1/B2: which annotation fields of the marked-up PDFs carry steel sizes (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase9_markups fields
Counts and patterns only on stdout (no annotation text is printed); per-file summaries go to the
git-ignored fixtures/private/takeoffs/phase9_fields.json. Definitions: docs/PHASE9_PREREGISTRATION.md.
"""

from __future__ import annotations

import collections
import json
import math
import sys

import pymupdf

from tools.takeoff import phase9_lib as P
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.geometry_study import vertices_of

SLOTS = 15
TAG_RADIUS = 60.0  # nearest-symbol fallback for a tag with no reply-to entry (Phase 5t)
OUT = TAKEOFFS / "phase9_fields.json"


def matched_files() -> list[tuple[str, dict]]:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    return [(n, i) for n, i in sorted(inv.items()) if i.get("match")]


def raw_string(doc: pymupdf.Document, xref: int, key: str) -> str | None:
    """A text entry of an annotation: a string, or a stream (rich text)."""
    t, v = doc.xref_get_key(xref, key)
    if t == "null":
        return None
    if t == "xref":
        n = int(v.split()[0])
        try:
            return (doc.xref_stream(n) or b"").decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - an unreadable stream is an empty field
            return None
    return v


def column_slots(doc: pymupdf.Document, xref: int) -> list[str | None]:
    t, v = doc.xref_get_key(xref, "BSIColumnData")
    if t == "null":
        return [None] * SLOTS
    if t == "xref":
        v = doc.xref_object(int(v.split()[0]))
    s = P.parse_pdf_strings(v)
    return [*s[:SLOTS], *([None] * (SLOTS - len(s)))]


def category(a: pymupdf.Annot, page: pymupdf.Page) -> str:
    st = a.type[1]
    if st == "Polygon":
        return "Polygon-symbol" if len(vertices_of(a, page)) in (3, 8) else "Polygon-other"
    return st if st in {"FreeText", "Square", "Highlight", "Line", "Ink", "Circle"} else "other"


def field_values(doc: pymupdf.Document, a: pymupdf.Annot) -> dict[str, str | None]:
    info = a.info
    out: dict[str, str | None] = {
        "Subj": info.get("subject"),
        "Contents": info.get("content"),
        "RC": P.rich_text_plain(raw_string(doc, a.xref, "RC")),
    }
    for k, v in enumerate(column_slots(doc, a.xref)):
        out[f"slot {k:02d}"] = v
    return out


def collect(name: str, info: dict) -> dict:
    """Per category and field the values of one file (kept in memory only), the tag links and the
    colour sets. `mapped` marks markups on pages that map to a page of our drawing document."""
    doc = pymupdf.open(TAKEOFFS / name)
    mapped_pages = {int(k) for k in info["page_map"]}
    vals: dict = collections.defaultdict(lambda: collections.defaultdict(list))
    colours: dict = collections.defaultdict(set)
    n_cat: collections.Counter = collections.Counter()
    has: collections.Counter = collections.Counter()
    sym_fields: dict[int, dict] = {}
    tag_fields: dict[int, tuple] = {}
    for pno, page in enumerate(doc):
        syms: list[tuple[int, float, float]] = []
        tags: list[tuple[int, float, float, int | None]] = []
        for a in page.annots() or []:
            cat = category(a, page)
            fv = field_values(doc, a)
            popn = ("all", "mapped") if pno in mapped_pages else ("all",)
            for p in popn:
                n_cat[(p, cat)] += 1
                for f, v in fv.items():
                    vals[(p, cat)][f].append(v)
            c = a.colors
            colours[cat].add((tuple(c.get("stroke") or ()), tuple(c.get("fill") or ())))
            keys = set(doc.xref_get_keys(a.xref))
            has[(cat, "OC")] += "OC" in keys
            has[(cat, "T")] += bool((a.info.get("title") or "").strip())
            if cat == "Polygon-symbol":
                v = vertices_of(a, page)
                syms.append(
                    (
                        a.xref,
                        sum(p[0] for p in v) / len(v),
                        sum(p[1] for p in v) / len(v),
                    )
                )
                sym_fields[a.xref] = {"fv": fv, "mapped": pno in mapped_pages}
            elif cat == "FreeText":
                r = a.rect * page.rotation_matrix
                irt = None
                t, val = doc.xref_get_key(a.xref, "IRT")
                if t == "xref":
                    irt = int(val.split()[0])
                tags.append((a.xref, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, irt))
                tag_fields[a.xref] = (fv, pno in mapped_pages)
        sym_ids = {s[0] for s in syms}
        for xr, cx, cy, irt in tags:
            link = "none"
            parent = None
            if irt in sym_ids:
                link, parent = "reply", irt
            elif syms:
                nearest = min(syms, key=lambda s: math.hypot(s[1] - cx, s[2] - cy))
                if math.hypot(nearest[1] - cx, nearest[2] - cy) <= TAG_RADIUS:
                    link, parent = "nearest", nearest[0]
            tag_fields[xr] = (*tag_fields[xr], link, parent)
    return {
        "vals": vals,
        "n_cat": n_cat,
        "colours": colours,
        "has": has,
        "tags": tag_fields,
        "syms": sym_fields,
    }


def run_fields() -> None:
    files = matched_files()
    per_file: list[dict] = []
    for name, info in files:
        c = collect(name, info)
        summ: dict = {}
        for (popn, cat), fields in c["vals"].items():
            for f, vs in fields.items():
                summ[f"{popn}|{cat}|{f}"] = P.summarize_values(vs)
        # tags that belong to a count symbol, by link kind
        link_n = collections.Counter(t[2] for t in c["tags"].values())
        tag_vals: dict = collections.defaultdict(list)
        for fv, mapped, link, _parent in c["tags"].values():
            if link != "none":
                for p in ("all", "mapped") if mapped else ("all",):
                    for f, v in fv.items():
                        tag_vals[(p, f)].append(v)
        for (p, f), vs in tag_vals.items():
            summ[f"{p}|Tag-of-symbol|{f}"] = P.summarize_values(vs)
        per_file.append(
            {
                "n_cat": {f"{p}|{k}": v for (p, k), v in c["n_cat"].items()},
                "summ": summ,
                "link": dict(link_n),
                "colours": {k: len(v) for k, v in c["colours"].items()},
                "has": {f"{k}|{kk}": v for (k, kk), v in c["has"].items()},
            }
        )
        print(f"  file {len(per_file)}/{len(files)} done", file=sys.stderr)
    OUT.write_text(json.dumps(per_file, indent=1))
    report(per_file)


def report(per_file: list[dict]) -> None:
    keys = sorted({k for pf in per_file for k in pf["summ"]})
    cats = sorted({k.split("|")[1] for k in keys})
    print("files:", len(per_file))
    for popn in ("all", "mapped"):
        print(f"\n== population: {popn} ==")
        tot = collections.Counter()
        for pf in per_file:
            for k, v in pf["n_cat"].items():
                if k.startswith(popn + "|"):
                    tot[k.split("|")[1]] += v
        print("markups per category:", dict(tot))
        for cat in cats:
            fields = sorted({k.split("|")[2] for k in keys if k.startswith(f"{popn}|{cat}|")})
            print(f"\n[{cat}]")
            print(
                "field      n      filled%  distinct(sum)  kinds(filled)  any-size(whole)% contains% dims-only% files>=50%"
            )
            for f in fields:
                parts = [
                    pf["summ"][f"{popn}|{cat}|{f}"]
                    for pf in per_file
                    if f"{popn}|{cat}|{f}" in pf["summ"]
                ]
                m = P.merge_summaries(parts)
                if m["n"] == 0:
                    continue
                per_file_share = {
                    str(i): (p["any_whole"] / p["n"] if p["n"] else None)
                    for i, p in enumerate(parts)
                }
                nf = sum(1 for s in per_file_share.values() if s is not None and s >= 0.5)
                kinds = ",".join(f"{k}:{v}" for k, v in sorted(m["kinds"].items()))
                print(
                    f"{f:9s} {m['n']:6d} {100 * m['filled'] / m['n']:7.1f} {m['distinct_sum']:9d}  "
                    f"{kinds:40s} {100 * m['any_whole'] / m['n']:6.1f} {100 * m['any_contains'] / m['n']:7.1f} "
                    f"{100 * m['dims_only_whole'] / m['n']:6.1f}  {nf}"
                )
                if m["whole"] and f in ("Subj", "Contents", "RC") or m["any_whole"]:
                    print("          whole by class:", m["whole"], " contains:", m["contains"])
    print("\nlinks of tags to symbols (summed over files):")
    lk = collections.Counter()
    for pf in per_file:
        lk.update(pf["link"])
    print(dict(lk))
    print("distinct (stroke, fill) colours per category, per file (min, median, max):")
    for cat in cats:
        xs = sorted(pf["colours"].get(cat, 0) for pf in per_file)
        print(f"  {cat}: {xs[0]}, {xs[len(xs) // 2]}, {xs[-1]}")
    print("layer entry (OC) and author (T) filled, share of the category (all files):")
    for cat in cats:
        n = sum(v for pf in per_file for k, v in pf["n_cat"].items() if k == f"all|{cat}")
        oc = sum(v for pf in per_file for k, v in pf["has"].items() if k == f"{cat}|OC")
        t = sum(v for pf in per_file for k, v in pf["has"].items() if k == f"{cat}|T")
        if n:
            print(f"  {cat}: OC {100 * oc / n:.1f}%, T {100 * t / n:.1f}%")


# --- exploratory extras (post-hoc, labelled as such in the results) ---------------------------------


def run_extras() -> None:
    """Value of the numeric slots, tag-code patterns, and whether colour or subject predicts the
    tag prefix (a kind letter). Letters of prefixes and numbers are printed, never other text."""
    import re

    slot_vals: collections.Counter = collections.Counter()
    shapes: collections.Counter = collections.Counter()
    prefix: collections.Counter = collections.Counter()
    pur = {
        "colour": [0, 0, 0, 0],
        "subject": [0, 0, 0, 0],
    }  # modal, tags, groups, tags in groups of 5+
    for name, info in matched_files():
        doc = pymupdf.open(TAKEOFFS / name)
        for page in doc:
            by_xref = {}
            for a in page.annots() or []:
                if category(a, page) == "Polygon-symbol":
                    by_xref[a.xref] = a
            groups_c: dict = collections.defaultdict(list)
            groups_s: dict = collections.defaultdict(list)
            for a in page.annots() or []:
                if a.type[1] == "Polygon" and a.xref in by_xref:
                    sl = column_slots(doc, a.xref)
                    for k in (8, 13):
                        if sl[k]:
                            slot_vals[(k, sl[k])] += 1
                if a.type[1] != "FreeText":
                    continue
                t, val = doc.xref_get_key(a.xref, "IRT")
                if t != "xref" or int(val.split()[0]) not in by_xref:
                    continue
                parent = by_xref[int(val.split()[0])]
                code = (a.info.get("content") or "").strip()
                m = re.fullmatch(r"([A-Za-z]{1,4})[-\s]?(\d+)([A-Za-z]?)", code)
                shapes["letters+number" if m else "other pattern"] += 1
                if m:
                    pre = m.group(1).upper()
                    prefix[pre] += 1
                    c = parent.colors
                    groups_c[(tuple(c.get("stroke") or ()), tuple(c.get("fill") or ()))].append(pre)
                    groups_s[parent.info.get("subject")].append(pre)
            for g, key in ((groups_c, "colour"), (groups_s, "subject")):
                for lst in g.values():
                    mode = collections.Counter(lst).most_common(1)[0][1]
                    pur[key][2] += 1
                    if len(lst) >= 5:  # a group of 1 to 4 is trivially pure; counted apart
                        pur[key][0] += mode
                        pur[key][3] += len(lst)
                    pur[key][1] += len(lst)
    print("numeric slot values on symbols (slot, value): count ->", dict(slot_vals.most_common(8)))
    print("tag code shape:", dict(shapes))
    print("tag prefix letters (top 14):", dict(prefix.most_common(14)))
    print(
        "tags whose prefix equals the modal prefix of their page-and-key group, groups of 5+ only:",
        {
            k: (round(m / t5, 3) if t5 else None, "tags in 5+ groups", t5, "of", t, "groups", g)
            for k, (m, t, g, t5) in pur.items()
        },
    )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "fields":
        run_fields()
    elif len(sys.argv) > 1 and sys.argv[1] == "extras":
        run_extras()
    else:
        print(__doc__)
