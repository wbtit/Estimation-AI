"""Write the reconstructed lines, closed shapes, stroke-class table and text for one page.

    python -I page_dump.py --job job-002 --pages 3,5,7   (all selected pages when omitted)
Outputs go to fixtures/private/study/<job>/page_<n>.json (git-ignored); stdout is counts only.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import linework  # noqa: E402


def dump_page(job: str, idx: int) -> dict:
    with common.open_doc(job) as doc:
        page = doc[idx]
        segs, shapes = linework.page_segments(page)
        lines, stats = linework.reconstruct(segs)
        classes: dict[str, dict] = {}
        layers = Counter(ln.layer for ln in lines if ln.layer)
        for ln in lines:
            c = classes.setdefault(ln.klass, {"lines": 0, "length_pt": 0.0, "layers": Counter()})
            c["lines"] += 1
            c["length_pt"] += ln.length
            if ln.layer:
                c["layers"][ln.layer] += 1
        out = {
            "job": job,
            "page": idx,
            "size": [page.rect.width, page.rect.height],
            "rotation": page.rotation,
            "stats": stats,
            "lines": [ln.to_json() for ln in lines],
            "shapes": [{**s, "bbox": [round(v, 2) for v in s["bbox"]]} for s in shapes],
            "classes": {
                k: {"lines": v["lines"], "length_pt": round(v["length_pt"], 1), "layers_used": len(v["layers"])}
                for k, v in sorted(classes.items(), key=lambda kv: -kv[1]["length_pt"])
            },
            "distinct_layers": len(layers),
        }
    path = common.doc_dir(job) / f"page_{idx}.json"
    path.write_text(json.dumps(out))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--pages")
    args = ap.parse_args()
    sel = json.loads((common.STUDY / "selection.json").read_text())["selection"][args.job]
    pages = (
        [int(p) for p in args.pages.split(",")]
        if args.pages
        else sorted({*sel["plan_pages"], *sel["schedule_pages"], *sel["legend_pages"], *sel["elevation_pages"]})
    )
    for p in pages:
        d = dump_page(args.job, p)
        print(args.job, "page", p, "lines", len(d["lines"]), "shapes", len(d["shapes"]),
              "classes", len(d["classes"]), "segments", d["stats"]["segments"],
              "dash_chains", d["stats"]["dash_chains"])  # fmt: skip


if __name__ == "__main__":
    main()
