"""Phase 7 Part C: render the result tables (markdown) from the private result jsons.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_partc_report > out.md
Aggregate counts and ratios only. Reads the single held-out result and the frozen dev run (rev4).
"""

from __future__ import annotations

import json

from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase7_cgrammar_run import REASONS

NAMES = {
    "linear": "linear: main spans",
    "columns": "columns: main glyphs",
    "combined": "combined: spans + columns",
    "linear_v1": "sens.: v1 main rule (>= 1 end, any role)",
    "linear_all": "sens.: every span kept (v1 keep-everything)",
    "columns_all": "sens.: every glyph",
    "combined_braces": "sens.: combined + brace signs",
}


def f(v, nd=2):
    return "none" if v is None else f"{v:.{nd}f}"


def block(d: dict, side: str, scope: str, title: str) -> None:
    s = d["summary"][scope]
    print(f"\n#### {title}")
    print(
        "| piece set | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |"
    )
    print("|---|---|---|---|---|---|---|")
    for k, name in NAMES.items():
        t = s["sets"][k]
        print(
            f"| {name} | {t['pieces']:,} | {f(t['P12'])} / {f(t['R12'])} / {f(t['F12'])} | {f(t['P24'])} / {f(t['R24'])}"
            f" | {f(t['P36'])} / {f(t['R36'])} | {t['equal'] * 100:.0f}% / {t['within1'] * 100:.0f}% / {t['within20'] * 100:.0f}% | {t['verdict']} |"
        )
    c = s["sets"]["combined"]
    print(
        "\n| chance control (combined set, 20 replicates) | P / R at 12 pt | P / R at 24 pt | P / R at 36 pt |"
    )
    print("|---|---|---|---|")
    print(
        f"| real symbols | {f(c['P12'])} / {f(c['R12'])} | {f(c['P24'])} / {f(c['R24'])} | {f(c['P36'])} / {f(c['R36'])} |"
    )
    for kind in ("uniform", "displaced"):
        x = s["controls"][kind]
        cells = [f"{f(x[str(r)]['P'][0])} / {f(x[str(r)]['R'][0])}" for r in (12, 24, 36)]
        print(f"| {kind} | " + " | ".join(cells) + " |")
    rc = max(s["controls"][k]["12"]["R"][0] for k in ("uniform", "displaced"))
    pc = max(s["controls"][k]["12"]["P"][0] for k in ("uniform", "displaced"))
    ok = c["R12"] - rc >= 0.10 and c["P12"] >= 1.5 * pc
    print(
        f"\nRegistered reading guide at 12 pt: recall gap over the larger control {c['R12'] - rc:+.3f} (needs +0.10), precision ratio {c['P12'] / pc:.2f} (needs 1.5): **{'signal over chance' if ok else 'no signal over chance'}**."
    )
    print(
        f"\nMatched at 12 pt by kind: {s['matched_by_type_12']}. Pages with a usable grid: {s['pages_with_grid']} of {s['sets']['combined']['pages']}."
    )
    print("\n| miss reason for each symbol (one, fixed order) | symbols | share |")
    print("|---|---|---|")
    tot = sum(s["reasons"].values())
    for r in REASONS:
        n = s["reasons"].get(r, 0)
        print(f"| {r} | {n:,} | {100 * n / tot:.1f}% |")
    print(f"\nOverlapping flags (not exclusive, of {tot:,} symbols): {s['flags']}.")
    st = s["stats"]
    print(
        f"\nParse and grammar counts: {st['prims']:,} primitives, {st['segs']:,} straight segments, {st['forms']:,} Form XObject calls, {st['bubbles']} bubbles, {st['grid_lines']} grid lines, {st['glyphs']:,} glyphs ({st['glyphs_main']:,} main), {st['spans']:,} spans ({st['spans_main']:,} main, {st['spans_v1_main']:,} under the v1 rule), {st['braces']} brace signs. Segments consumed before chaining: {s['consumed']}."
    )


def main() -> None:
    held = json.loads((TAKEOFFS / "phase7_c_held-out_final.json").read_text())
    dev = json.loads((TAKEOFFS / "phase7_c_dev_rev4.json").read_text())
    print("### C1. Held-out (single run, 6 jobs, 52 pages)")
    block(held, "held-out", "all", "all held-out pages")
    block(held, "held-out", "without_largest", "held-out without job-015")
    print("\n### C2. Dev (frozen rules, 10 jobs, 84 pages; for comparison only)")
    block(dev, "dev", "all", "all dev pages")
    block(dev, "dev", "without_largest", "dev without job-012")
    print("\n### C3. Per job, combined set, exact matching, 12 pt")
    print("| side | job | their symbols | pieces | P | R | F1 |")
    print("|---|---|---|---|---|---|---|")
    for side, d in (("held-out", held), ("dev", dev)):
        for j, t in sorted(d["summary"]["per_job"].items()):
            print(
                f"| {side} | {j} | {t['theirs']} | {t['pieces']:,} | {f(t['P12'])} | {f(t['R12'])} | {f(t['F12'])} |"
            )


if __name__ == "__main__":
    main()
