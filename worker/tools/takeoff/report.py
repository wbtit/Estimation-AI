"""Counts-only tables for docs/PHASE5T_RESULTS.md from the private JSON files of the study tools."""

from __future__ import annotations

import collections
import json

from tools.takeoff.common import TAKEOFFS


def load(n):
    return json.loads((TAKEOFFS / n).read_text())


def bands(vals, edges):
    c = collections.Counter()
    for v in vals:
        for hi, name in edges:
            if v <= hi:
                c[name] += 1
                break
        else:
            c["beyond"] += 1
    return dict(c)


def main() -> None:
    g = load("geometry.json")
    rows = [dict(r, job=j) for j, v in g.items() for r in v["rows"]]
    print(
        "== M1 (pre-registered population: every Line/PolyLine markup of at least 3 pt on a page we can map)"
    )
    print(f"length markups {len(rows)} in {len(g)} jobs")
    for tol in ("6.0", "3.0", "12.0"):
        m = sum(v["by_tol"][tol]["matched"] for v in g.values())
        print(f"  matched at {tol} pt: {m} ({100 * m / len(rows):.1f}%)")
    meas = [r for r in rows if r["has_measure"]]
    print(
        f"== same, split by whether the markup has a measurement dictionary: with {len(meas)}, without {len(rows) - len(meas)}"
    )
    for tol in ("6.0", "3.0", "12.0"):
        k = f"match@{float(tol):g}"
        a = sum(1 for r in meas if r.get(k) in (True, "True"))
        b = sum(1 for r in rows if not r["has_measure"] and r.get(k) in (True, "True"))
        print(
            f"  at {tol}: with measurement {a}/{len(meas)} ({100 * a / max(len(meas), 1):.0f}%), without {b}/{len(rows) - len(meas)}"
        )
    lens = sorted(r["len_pt"] for r in rows)
    long_ = sum(1 for x in lens if x >= 1000)
    print(
        f"  markup length (pt) quartiles {lens[len(lens) // 4]}, {lens[len(lens) // 2]}, {lens[3 * len(lens) // 4]}; at least 1000 pt: {long_}"
    )
    mm = [r for r in meas if r.get("line_key")]
    um = [r for r in meas if r.get("unmatched")]
    print(
        "== measurement-subset (138 markups with a measurement dictionary): matched at 6 pt",
        len(mm),
        "; part-of-line bands",
        bands(
            [r["ratio"] for r in mm],
            [(0.25, "<0.25"), (0.75, "0.25-0.75"), (1.25, "0.75-1.25"), (1e9, ">1.25")],
        ),
        "; markups per line",
        dict(collections.Counter(collections.Counter(tuple(r["line_key"]) for r in mm).values())),
    )
    print(
        "   unmatched measured markups:",
        len(um),
        "reasons",
        dict(collections.Counter(r["unmatched"] for r in um)),
        "; on a line of ANY class (>=80% within 6 pt):",
        sum(1 for r in um if r["any_class_share"] >= 0.8),
    )
    ml = sorted(r["len_pt"] for r in meas)
    print(
        "   measured markup length (pt) quartiles",
        ml[len(ml) // 4],
        ml[len(ml) // 2],
        ml[3 * len(ml) // 4],
    )
    print("== M2 / M3 (matched markups)")
    for tol in ("6.0", "3.0", "12.0"):
        b = collections.Counter()
        pl = collections.Counter()
        for v in g.values():
            for k, n in v["by_tol"][tol]["bands"].items():
                b[k] += n
            for k, n in v["by_tol"][tol]["per_line"].items():
                pl[k] += n
        print(
            f"  {tol} pt: part-of-line bands {dict(b)}; markups per drawn line (lines with 1/2/3+) {dict(sorted(pl.items()))}"
        )
    m6 = [r for r in rows if r.get("line_key")]
    print(
        "  matched at 6 pt with a measurement dict:",
        sum(r["has_measure"] for r in m6),
        "of",
        len(m6),
    )
    print(
        "  matched markups whose line is shared in our system (study docs only):",
        collections.Counter(r.get("shared_in_system") for r in m6),
    )
    print("== M4 / M6")
    print(
        "  markups with a profile in subject or contents:",
        sum(r["profile"] for r in rows),
        "of",
        len(rows),
        "(matched:",
        sum(r["profile"] for r in m6),
        ")",
    )
    print("  M6 pairs:", sum(1 for r in rows if "m6" in r))
    print("== M5")
    a = [r["m5a_rel"] for r in rows if "m5a_rel" in r]
    print(
        "  (a) stored value vs geometric length, n =",
        len(a),
        bands(a, [(0.02, "within 2%"), (0.05, "within 5%"), (0.10, "within 10%")]),
    )
    b = [(r["m5b_rel"], r.get("shared_in_system")) for r in rows if r.get("m5b_rel") is not None]
    print(
        "  (b) markup length vs our line length, n =",
        len(b),
        bands([x for x, _ in b], [(0.02, "within 2%"), (0.05, "within 5%"), (0.10, "within 10%")]),
    )
    print("      by our trust flag:", collections.Counter(s for _, s in b))
    sc = [(r["ratio_markup"], r["ratio_ours"]) for r in rows if r["ratio_markup"]]
    agree = sum(1 for m, o in sc if o and abs(m - o) / o <= 0.02)
    print(
        f"  scale of the markup vs the page scale we read: {len(sc)} markups with a scale; page scale known {sum(1 for _, o in sc if o)}; agree within 2% {agree}"
    )
    print(
        "  distinct markup scales (ratio) :",
        dict(collections.Counter(round(m) for m, _ in sc).most_common(6)),
    )
    print("== unmatched reasons")
    un = collections.Counter()
    for v in g.values():
        for k, n in v["unmatched"].items():
            un[k] += n
    print(
        " ",
        dict(un),
        "; class source (pages):",
        dict(collections.Counter({k: n for v in g.values() for k, n in v["class_source"].items()})),
    )
    anyshare = [r["any_class_share"] for r in rows if r.get("unmatched")]
    print(
        "  unmatched markups that lie on a line of ANY class (>= 80% within 6 pt):",
        sum(1 for x in anyshare if x >= 0.8),
        "of",
        len(anyshare),
    )
    print("== per job (length markups, with measurement, matched@6)")
    for j, v in sorted(g.items()):
        rr = [r for r in rows if r["job"] == j]
        print(
            f"  {j}: {len(rr)}, {sum(r['has_measure'] for r in rr)}, {v['by_tol']['6.0']['matched']}"
        )
    c = load("count_study.json")
    print("== EXPLORATORY count symbols")
    tot = collections.Counter()
    for j, v in c.items():
        tot["symbols"] += v["symbols"]
        for k, n in v["near"].items():
            tot[f"near {k}"] += n
        for k, n in v["dist_bands"].items():
            tot[f"band {k}"] += n
        for k, n in v["symbols_per_line(<=12pt)"].items():
            tot[f"lines with {k}"] += n
        for k, n in v.get("kind", {}).items():
            tot[f"kind {k}"] += n
    for k, n in sorted(tot.items()):
        print("  ", k, n)


if __name__ == "__main__":
    main()
