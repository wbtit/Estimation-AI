"""Render a page crop with the column-like shapes (columns.py) boxed, for visual false-positive review."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import columns  # noqa: E402
import common  # noqa: E402
import pymupdf  # noqa: E402
import render  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--page", type=int, required=True)
    ap.add_argument("--box")
    ap.add_argument("--zoom", type=float, default=1.0)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    shapes = columns.detect_shapes(a.job, a.page)
    with common.open_doc(a.job) as doc:
        r = doc[a.page].rect
    clip = pymupdf.Rect(*(float(v) for v in a.box.split(","))) if a.box else r
    ov = [
        {
            "kind": "box",
            "bbox": s["bbox"],
            "colour": (230, 0, 0) if not s["filled"] else (0, 90, 230),
        }
        for s in shapes
    ]
    img = render.render(a.job, a.page, clip, a.zoom, False, ov)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(a.out)
    print("shapes", len(shapes), "image", img.size)


if __name__ == "__main__":
    main()
