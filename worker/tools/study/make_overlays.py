"""STEP 4b: candidates and annotation overlays for the sampled labels (needs structural_classes.json).

For each sampled label: the nearest structural lines (candidates.py, distance only) and an overlay
image: the label box in red, candidates numbered and coloured (no rule output is shown). Writes
labels_candidates.json and fixtures/private/study/<job>/overlays/<label_id>.png. stdout: counts only.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidates  # noqa: E402
import common  # noqa: E402
import pymupdf  # noqa: E402
import render  # noqa: E402
from PIL import ImageDraw, ImageFont  # noqa: E402

HALF = 130.0  # crop half-size in points
ZOOM = 4.0
COLOURS = [
    (30, 90, 220),
    (20, 160, 60),
    (230, 130, 0),
    (150, 40, 200),
    (0, 170, 190),
    (200, 0, 140),
]
RED = (230, 0, 0)


def overlay(job: str, label: dict, cands: list[dict], out: Path) -> None:
    b = label["bbox"]
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    clip = pymupdf.Rect(cx - HALF, cy - HALF, cx + HALF, cy + HALF)
    ov = [{"kind": "box", "bbox": b, "colour": RED}]
    for c in cands:
        col = COLOURS[(c["cand"] - 1) % len(COLOURS)]
        ov.append({"kind": "line", "p": c["p"], "q": c["q"], "colour": col})
    img = render.render(job, label["page"], clip, ZOOM, False, ov)
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=22)
    for c in cands:
        col = COLOURS[(c["cand"] - 1) % len(COLOURS)]
        # number badge at the point of the candidate closest to the label centre
        px, py = c["p"]
        qx, qy = c["q"]
        dx, dy = qx - px, qy - py
        t = max(0.0, min(1.0, ((cx - px) * dx + (cy - py) * dy) / (dx * dx + dy * dy or 1.0)))
        x, y = (px + t * dx - clip.x0) * ZOOM, (py + t * dy - clip.y0) * ZOOM
        draw.rectangle([x - 4, y - 4, x + 22, y + 24], fill=(255, 255, 255), outline=col)
        draw.text((x, y - 2), str(c["cand"]), fill=col, font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs")
    args = ap.parse_args()
    data = json.loads((common.STUDY / "labels_sample.json").read_text())
    jobs = args.jobs.split(",") if args.jobs else list(data)
    result: dict[str, dict] = {}
    cache: dict[tuple[str, int], list[dict]] = {}
    for job in jobs:
        struct = candidates.load_structural(job)
        n_none = 0
        for lab in data[job]["sample"]:
            key = (job, lab["page"])
            if key not in cache:
                cache[key] = candidates.structural_lines_for(
                    job, lab["page"], struct.get(lab["page"], set())
                )
            cands = candidates.candidates_for(lab, cache[key])
            n_none += not cands
            result[lab["label_id"]] = {"candidates": cands}
            overlay(job, lab, cands, common.doc_dir(job) / "overlays" / f"{lab['label_id']}.png")
        print(job, "labels", len(data[job]["sample"]), "without candidates", n_none)
    path = common.STUDY / "labels_candidates.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(result)
    path.write_text(json.dumps(old))


if __name__ == "__main__":
    main()
