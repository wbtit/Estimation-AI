"""Render page overviews and crops, optionally with reconstructed lines coloured by stroke class.

    render.py page --job J --page N --out FILE [--long-side 2400] [--classes]
    render.py crop --job J --page N --box x0,y0,x1,y1 --out FILE [--zoom 3] [--classes]
    render.py classes --job J --page N        (prints the class table: counts only)

Boxes are in displayed page points (rotation applied). Output images belong in
fixtures/private/study/ (git-ignored). Nothing is printed except counts.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import pymupdf  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

PALETTE = [(220, 30, 30), (30, 90, 220), (20, 160, 60), (230, 130, 0), (150, 40, 200),
           (0, 170, 190), (200, 0, 140), (110, 110, 0), (120, 70, 20), (90, 90, 90)]  # fmt: skip


def load_dump(job: str, page: int) -> dict:
    return json.loads((common.doc_dir(job) / f"page_{page}.json").read_text())


def class_colours(dump: dict) -> dict[str, tuple[int, int, int]]:
    return {k: PALETTE[i % len(PALETTE)] for i, k in enumerate(dump["classes"])}


def render(job: str, page_no: int, clip: pymupdf.Rect | None, zoom: float, classes: bool,
           overlays: list[dict] | None = None) -> Image.Image:  # fmt: skip
    with common.open_doc(job) as doc:
        page = doc[page_no]
        clip = clip or page.rect
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    draw = ImageDraw.Draw(img)

    def px(x: float, y: float) -> tuple[float, float]:
        return ((x - clip.x0) * zoom, (y - clip.y0) * zoom)

    if classes:
        dump = load_dump(job, page_no)
        colours = class_colours(dump)
        for x0, y0, x1, y1, w, col, layer, dashed, n in dump["lines"]:
            if (
                max(x0, x1) < clip.x0
                or min(x0, x1) > clip.x1
                or max(y0, y1) < clip.y0
                or min(y0, y1) > clip.y1
            ):
                continue
            klass = (
                f"{__import__('linework').width_bucket(w)}|{col}|{'dash' if dashed else 'solid'}"
            )
            draw.line(
                [px(x0, y0), px(x1, y1)],
                fill=colours.get(klass, (0, 0, 0)),
                width=max(1, round(zoom)),
            )
    for o in overlays or []:
        if o["kind"] == "box":
            b = o["bbox"]
            draw.rectangle(
                [px(b[0], b[1]), px(b[2], b[3])],
                outline=tuple(o["colour"]),
                width=max(2, round(zoom)),
            )
        elif o["kind"] == "line":
            draw.line(
                [px(*o["p"]), px(*o["q"])], fill=tuple(o["colour"]), width=max(2, round(zoom * 1.5))
            )
        if o.get("text"):
            pos = px(
                *(
                    o.get("text_at") or (o["bbox"][0], o["bbox"][1])
                    if o["kind"] == "box"
                    else o["p"]
                )
            )
            draw.text((pos[0] + 2, pos[1] - 12), str(o["text"]), fill=tuple(o["colour"]))
    return img


def legend(job: str, page_no: int) -> list[str]:
    dump = load_dump(job, page_no)
    return [f"{k}: {v['lines']} lines, {v['length_pt']:.0f} pt" for k, v in dump["classes"].items()]


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("page", "crop", "classes"):
        p = sub.add_parser(name)
        p.add_argument("--job", required=True)
        p.add_argument("--page", type=int, required=True)
        if name != "classes":
            p.add_argument("--out", type=Path, required=True)
            p.add_argument("--classes", action="store_true")
        if name == "page":
            p.add_argument("--long-side", type=int, default=2400)
        if name == "crop":
            p.add_argument("--box", required=True)
            p.add_argument("--zoom", type=float, default=3.0)
    args = ap.parse_args()
    if args.cmd == "classes":
        dump = load_dump(args.job, args.page)
        colours = class_colours(dump)
        for k, v in dump["classes"].items():
            print(f"{k}\tlines={v['lines']}\tlength_pt={v['length_pt']}\tcolour={colours[k]}")
        return
    if args.cmd == "page":
        with common.open_doc(args.job) as doc:
            r = doc[args.page].rect
        zoom = args.long_side / max(r.width, r.height)
        img = render(args.job, args.page, None, zoom, args.classes)
    else:
        x0, y0, x1, y1 = (float(v) for v in args.box.split(","))
        img = render(args.job, args.page, pymupdf.Rect(x0, y0, x1, y1), args.zoom, args.classes)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(args.out)
    print("wrote", img.size[0], "x", img.size[1])


if __name__ == "__main__":
    main()
