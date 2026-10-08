"""Tables from fixtures/private/study/phase5b_calibration.json (counts only, no text).

usage: python scripts/calibration/phase5b_report.py
"""

from __future__ import annotations

import collections
import json
import os
from pathlib import Path

STUDY = Path(__file__).resolve().parents[2] / "fixtures" / "private" / "study"
DATA = json.loads((STUDY / os.environ.get("CALIBRATION_OUT", "phase5b_calibration.json")).read_text())
RUNS = ("suggested_classes", "study_classes")
COLORS = ("green", "amber", "red")


def labels(job: str, run: str) -> list[dict]:
    return [r for r in DATA[job][run]["rows"] if not r.get("excluded")]


def table(rows: list[dict], key: str = "color") -> dict:
    out = {c: [0, 0] for c in COLORS}  # [correct, incorrect]
    for r in rows:
        if r["state"] == "linked" and r[key] in out:
            out[r[key]][0 if r["correct"] else 1] += 1
    return out


def line(name: str, rows: list[dict]) -> str:
    t = table(rows)
    n = len(rows)
    linked = sum(1 for r in rows if r["state"] == "linked")
    unl = sum(1 for r in rows if r["state"] == "unlinked")
    nov = sum(1 for r in rows if r["state"] == "not_in_view")
    ok = sum(1 for r in rows if r.get("correct"))
    cells = "  ".join(f"{c}: {t[c][0]}/{t[c][0] + t[c][1]}" for c in COLORS)
    return f"{name:9} n={n:3} top1 {ok:3} ({100 * ok / max(n, 1):.0f}%)  linked {linked:3} unlinked {unl:3} not-in-view {nov:2} | {cells}"


def main() -> None:
    print("Parity: production top-1 on VALIDATION labels vs the Phase 4e study (study classes confirmed)")
    tot_s = tot_p = tot_n = 0
    for job in DATA:
        rows = labels(job, "study_classes")
        ok = sum(1 for r in rows if r.get("correct"))
        s = DATA[job]["study"]
        sug = sum(1 for r in labels(job, "suggested_classes") if r.get("correct"))
        print(f"  {job}: study {s['correct']}/{s['n']}  production(study classes) {ok}/{len(rows)}  production(suggested classes) {sug}/{len(rows)}")
        tot_s += s["correct"]
        tot_p += ok
        tot_n += len(rows)
    print(f"  pooled: study {tot_s}/{tot_n}  production(study classes) {tot_p}/{tot_n}")
    for run in RUNS:
        print(f"\nColor of the proposal against the gold ({run}); cells = correct/total among linked labels")
        pooled: list[dict] = []
        for job in DATA:
            rows = labels(job, run)
            pooled += rows
            print("  " + line(job, rows))
        print("  " + line("POOLED", pooled))
        shared = sum(1 for r in pooled if r.get("shared_line"))
        print(f"  (of the pooled labels, {shared} sit on a shared line and show amber for that reason)")
        print("  by the SYSTEM color (before shared-line and human steps):")
        t = table(pooled, "system_color")
        print("   ", "  ".join(f"{c}: {t[c][0]}/{t[c][0] + t[c][1]}" for c in COLORS))
    print("\nColor mix on the whole gold pages (every member on those pages)")
    for run in RUNS:
        print(f" {run}:")
        pooled: collections.Counter = collections.Counter()
        for job in DATA:
            mix = DATA[job][run]["page_mix"]
            pooled.update(mix)
            print(f"   {job}: {mix}")
        print(f"   POOLED: {dict(pooled)}")
    print("\nWhat the harness did for the scale and the view, per page")
    kinds: collections.Counter = collections.Counter()
    for job in DATA:
        row = {p: v["scale"] + " | " + v.get("view", "-") + (" | switched to include" if v.get("switched_to_include") else "") for p, v in DATA[job]["pages"].items()}
        for v in DATA[job]["pages"].values():
            kinds[v["scale"].split(" (")[0]] += 1
            kinds["view: " + v.get("view", "-")] += 1
            if v.get("switched_to_include"):
                kinds["switched to include in takeoff"] += 1
        print(f"  {job}: {row}")
    print("  totals:", dict(kinds))


if __name__ == "__main__":
    main()
