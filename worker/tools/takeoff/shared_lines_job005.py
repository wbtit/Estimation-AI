"""Exploratory: the 28 shared lines of job-005 (Phase 5b test project) against the takeoff markups of that
document: by page and page type, and how many count symbols / other markups lie on each shared line.
Counts only. usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.shared_lines_job005
"""

from __future__ import annotations

import collections
import json
import urllib.request

import numpy as np
import pymupdf

from tools.takeoff.common import TAKEOFFS
from tools.takeoff.geometry_study import dist_points_segments, vertices_of

API = "http://127.0.0.1:3000"
PID = "03fbf268-cc6c-44e2-91e8-ad49b916998a"  # the Phase 5b job-005 review test project


def get(p):
    return json.loads(urllib.request.urlopen(API + p, timeout=120).read())


def main() -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    name = next(k for k, v in inv.items() if v.get("match") == "job-005")
    pmap = {
        v: int(k) for k, v in inv[name]["page_map"].items()
    }  # drawing page index -> takeoff page index
    sheets = {s["id"]: s for s in get(f"/api/projects/{PID}/sheets")["sheets"]}
    members = [m for m in get(f"/api/projects/{PID}/members")["members"] if m["link"]["line"]]
    groups = collections.defaultdict(list)
    for m in members:
        ln = m["link"]["line"]
        a, b = tuple(round(x) for x in ln["p"]), tuple(round(x) for x in ln["q"])
        groups[(m["sheet_id"], min(a, b), max(a, b))].append(m)
    shared = {k: v for k, v in groups.items() if len(v) > 1}
    print("shared lines:", len(shared), "members:", sum(len(v) for v in shared.values()))
    by_page = collections.Counter()
    for (sid, _, _), v in shared.items():
        s = sheets[sid]
        by_page[(s["page_number"], s["page_type"]["effective"])] += 1
    print("shared lines by (page, page type):", dict(by_page))
    tdoc = pymupdf.open(TAKEOFFS / name)
    on_line = []
    for (sid, a, b), v in shared.items():
        s = sheets[sid]
        tp = pmap.get(s["page_index"])
        if tp is None:
            on_line.append((s["page_number"], len(v), None))
            continue
        tpage = tdoc[tp]
        seg = np.array([[a[0], a[1], b[0], b[1]]], dtype=float)
        c = collections.Counter()
        for an in tpage.annots() or []:
            vs = vertices_of(an, tpage) if (an.vertices) else []
            pts = np.array(
                vs if vs else [(an.rect.x0 + an.rect.x1) / 2, (an.rect.y0 + an.rect.y1) / 2]
            ).reshape(-1, 2)
            if an.rect.is_empty and not vs:
                continue
            if vs:
                cx, cy = np.mean(pts[:, 0]), np.mean(pts[:, 1])
            else:
                r = an.rect * tpage.rotation_matrix
                cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            d = dist_points_segments(np.array([[cx, cy]]), seg)[0, 0]
            if d <= 12:
                st = an.type[1]
                if st == "Polygon" and len(vs) in (3, 8):
                    st = "count symbol"
                c[st] += 1
        on_line.append((s["page_number"], len(v), dict(c)))
    n_sym = collections.Counter()
    for _, nmem, c in on_line:
        if c is None:
            n_sym["page not in takeoff"] += 1
            continue
        k = c.get("count symbol", 0)
        n_sym[f"count symbols within 12 pt: {min(k, 4)}{'+' if k >= 4 else ''}"] += 1
    print("per shared line:", dict(sorted(n_sym.items())))
    near_any = collections.Counter()
    for _, nmem, c in on_line:
        near_any[sum(c.values()) if c is not None else -1] += 1
    print(
        "markups of any subtype within 12 pt of a shared line (per line):",
        dict(sorted(near_any.items())),
    )
    for pg in sorted({k[0] for k in by_page}):
        sid = next(s_["id"] for s_ in sheets.values() if s_["page_number"] == pg)
        tp = pmap.get(sheets[sid]["page_index"])
        if tp is None:
            print(f"page {pg}: not in the takeoff file")
            continue
        sub = collections.Counter(a.type[1] for a in tdoc[tp].annots() or [])
        print(f"page {pg}: markups on the takeoff page by subtype:", dict(sub))
    print(
        "members vs count symbols on the same shared line (members, symbols):",
        sorted((nm, (c or {}).get("count symbol", None)) for _, nm, c in on_line),
    )


if __name__ == "__main__":
    main()
