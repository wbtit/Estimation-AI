"""Phase 7 Part B: render the result tables (markdown) from the private result json.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_partb_report > out.md
Only aggregate counts and ratios are printed (no names, no drawing text).
"""

from __future__ import annotations

import json

from tools.takeoff.common import TAKEOFFS

BASES = (
    ("label_first", "label-first"),
    ("line_with_label", "line with label"),
    ("line_first", "line first"),
)


def f(v, nd=2):
    return "none" if v is None else f"{v:.{nd}f}"


def main() -> None:
    d = json.loads((TAKEOFFS / "phase7_partb.json").read_text())
    t, c = d["tables"], d["controls"]
    print(
        "### B1. Reconciliation with the Phase 6b figures (greedy, suggested class, matched at 12 / 24 pt)"
    )
    print("| basis | recomputed | Phase 6b published |")
    print("|---|---|---|")
    for key, name in BASES:
        r = d["reconcile_6b"][key]
        print(
            f"| {name} | {r['recomputed']['12']} / {r['recomputed']['24']} | {r['published_6b']['12']} / {r['published_6b']['24']} |"
        )
    for scope, title in (
        ("all", "all 136 pages"),
        ("without_largest_two", "without the two largest jobs (job-012, job-015)"),
    ):
        for mode, mtitle in (
            ("suggested", "suggested class"),
            ("oracle", "oracle class (upper bound)"),
        ):
            print(f"\n### B2. {title}, {mtitle}: matching rule and distance, P / R / F1 by radius")
            print(
                "| basis | matching | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |"
            )
            print("|---|---|---|---|---|---|---|---|")
            for key, name in BASES:
                for m, mname in (
                    ("greedy_geometry", "greedy, geometry (= Phase 6b)"),
                    ("hungarian_geometry", "exact, geometry"),
                    ("hungarian_point", "exact, point (label centre / line midpoint)"),
                ):
                    x = t[f"{mode}|{key}|{m}|{scope}"]
                    ag = f"{x['equal'] * 100:.0f}% / {x['within1'] * 100:.0f}% / {x['within20'] * 100:.0f}%"
                    print(
                        f"| {name} | {mname} | {x['pieces']:,} | {f(x['P12'])} / {f(x['R12'])} / {f(x['F12'])}"
                        f" | {f(x['P24'])} / {f(x['R24'])} | {f(x['P36'])} / {f(x['R36'])} | {ag} | {x['verdict']} |"
                    )
    for scope, title in (
        ("all", "all 136 pages"),
        ("without_largest_two", "without the two largest jobs"),
    ):
        print(
            f"\n### B3. Chance controls, {title} (exact matching, geometry distance; mean of 20 replicates, sd in brackets)"
        )
        print(
            "| basis | class | radius | real P / R | uniform P / R | displaced P / R | real R minus larger control R | real P over larger control P | carries information (registered guide) |"
        )
        print("|---|---|---|---|---|---|---|---|---|")
        for mode in ("suggested", "oracle"):
            for key, name in BASES:
                real = t[f"{mode}|{key}|hungarian_geometry|{scope}"]
                u, s = c[f"{mode}|{key}|uniform|{scope}"], c[f"{mode}|{key}|displaced|{scope}"]
                for r in (12, 24, 36):
                    rc = max(u[f"R{r}"][0], s[f"R{r}"][0])
                    pc = max(u[f"P{r}"][0], s[f"P{r}"][0])
                    verdict = ""
                    if r == 12:
                        ok = real["R12"] - rc >= 0.10 and real["P12"] >= 1.5 * pc
                        verdict = "yes" if ok else "no"
                    print(
                        f"| {name} | {mode} | {r} | {f(real[f'P{r}'])} / {f(real[f'R{r}'])}"
                        f" | {f(u[f'P{r}'][0])} ({f(u[f'P{r}'][1], 3)}) / {f(u[f'R{r}'][0])} ({f(u[f'R{r}'][1], 3)})"
                        f" | {f(s[f'P{r}'][0])} ({f(s[f'P{r}'][1], 3)}) / {f(s[f'R{r}'][0])} ({f(s[f'R{r}'][1], 3)})"
                        f" | {real[f'R{r}'] - rc:+.3f} | {real[f'P{r}'] / pc:.2f} | {verdict} |"
                    )
    print("\n### B4. Per job, exact matching, geometry distance, suggested class, 12 pt")
    print(
        "| job | their symbols | label-first pieces / P / R | line with label pieces / P / R | line first pieces / P / R |"
    )
    print("|---|---|---|---|---|")
    jobs = sorted({k.split("|")[1] for k in d["per_job"]})
    for j in jobs:
        cells = []
        for key, _ in BASES:
            x = d["per_job"][f"{key}|{j}"]
            cells.append(f"{x['pieces']:,} / {f(x['P12'])} / {f(x['R12'])}")
        print(f"| {j} | {d['per_job']['label_first|' + j]['theirs']} | " + " | ".join(cells) + " |")
    print(
        "\n### B5. Label-only pieces (counted labels with no linked line), matched by the label point"
    )
    lo = d["label_only"]
    print(
        f"{lo['pieces']:,} label-only pieces on {lo['pages_with']} of 136 pages; by job: "
        + ", ".join(f"{k} {v}" for k, v in lo["by_job"].items() if v)
    )
    print(
        "\n| scope | basis | linked pieces only: pieces, matched 12 / 24 / 36 pt | plus label-only points: pieces, matched 12 / 24 / 36 pt |"
    )
    print("|---|---|---|---|")
    for scope in ("all", "without_largest_two"):
        for key, name in BASES[:2]:
            a = t[f"suggested|{key}|hungarian_geometry|{scope}"]
            b = t[f"suggested|{key}|hungarian_geometry_plus_label_only|{scope}"]
            print(
                f"| {scope.replace('_', ' ')} | {name} | {a['pieces']:,}: {a['m12']} / {a['m24']} / {a['m36']} | {b['pieces']:,}: {b['m12']} / {b['m24']} / {b['m36']} |"
            )


if __name__ == "__main__":
    main()
