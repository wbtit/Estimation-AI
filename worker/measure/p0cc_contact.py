"""Phase 0 column orientation: contact sheets (read-only).

One numbered cell per column: the drawing crop, the marker the app draws today (the stored
rotation: `main`) and the new marker (green = orientation clear, amber = unsure). The owner ticks
the wrong ones; that is the ground truth for "% of markers matching the drawn symbol, before and
after".

    cd worker && .venv/bin/python -m measure.p0cc_contact --json <dry-run json> --project <id> \
        --page-index <n> --out <folder> --name <file stem>

The json is the output of `npm run orientation:backfill -- --project <id> --page N --json out`
(a dry run). The database is opened READ ONLY; only the page's PDF is read. The pictures go to a
git-ignored folder (fixtures/private/contact/): they contain the drawing, never commit them.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

PANEL = 150  # px per panel
WINDOW_PT = 46.0  # the crop is this many page points across
COLS = 3  # cells per row
SIZE_IN = {  # default real sizes [width, depth] in inches (the json has no section)
    "w_shape": (10.0, 12.0),
    "w_cover_plates": (12.0, 12.5),
    "hss_square": (8.0, 8.0),
    "hss_rect": (4.0, 8.0),
    "hss_round": (8.0, 8.0),
}
GREEN, AMBER, BLUE = (0, 160, 70), (255, 145, 0), (41, 121, 255)


def glyph(family: str, w: float, h: float) -> list[list[tuple[float, float]]]:
    """Outlines (web vertical at rotation 0) centred on (0, 0): an I, a double box, a circle."""
    x, y = w / 2, h / 2
    t = max(min(w, h) * 0.12, 0.3)
    if family in ("w_shape", "w_cover_plates"):
        tw = t / 2
        return [[(-x, -y), (x, -y), (x, -y + t), (tw, -y + t), (tw, y - t), (x, y - t), (x, y),
                 (-x, y), (-x, y - t), (-tw, y - t), (-tw, -y + t), (-x, -y + t)]]  # fmt: skip
    if family in ("hss_square", "hss_rect"):
        return [[(-x, -y), (x, -y), (x, y), (-x, y)],
                [(-x + t, -y + t), (x - t, -y + t), (x - t, y - t), (-x + t, y - t)]]  # fmt: skip
    r = min(x, y)
    return [[(r * math.cos(a / 12 * math.pi), r * math.sin(a / 12 * math.pi)) for a in range(24)]]


def draw_marker(d: ImageDraw.ImageDraw, c: tuple[float, float], family: str, rotation_cw: float,
                z: float, ratio: float, colour: tuple[int, int, int]) -> None:  # fmt: skip
    k = 72.0 / ratio
    w_in, h_in = SIZE_IN.get(family, SIZE_IN["w_shape"])
    cs, sn = math.cos(math.radians(rotation_cw)), math.sin(math.radians(rotation_cw))
    for ring in glyph(family, w_in * k, h_in * k):
        pts = [(c[0] + (x * cs - y * sn) * z, c[1] + (x * sn + y * cs) * z) for x, y in ring]
        d.line([*pts, pts[0]], fill=colour, width=2)
    # the web direction as a line through the centre (the axis the 3D step will read)
    ext = max(w_in, h_in) * k * 0.9 * z
    wx, wy = -math.sin(math.radians(rotation_cw)), -math.cos(math.radians(rotation_cw))
    d.line([(c[0] - wx * ext, c[1] - wy * ext), (c[0] + wx * ext, c[1] + wy * ext)], fill=colour,
           width=1)  # fmt: skip


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--page-index", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", required=True)
    a = ap.parse_args(argv[1:])
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.config import load_config
    from src.db import connect

    cfg = load_config()
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        stored = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (a.project,)
        ).fetchone()["stored_path"]
    rows = json.loads(Path(a.json).read_text())
    rows.sort(key=lambda r: (round(r["a"][1] / 40), r["a"][0]))  # reading order on the page
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = PANEL / WINDOW_PT
    index = []
    cells: list[Image.Image] = []
    with pymupdf.open(cfg.upload_dir / stored) as doc:
        page = doc[a.page_index]
        for n, r in enumerate(rows, start=1):
            cx, cy = r["a"]
            clip = pymupdf.Rect(cx - WINDOW_PT / 2, cy - WINDOW_PT / 2, cx + WINDOW_PT / 2,
                                cy + WINDOW_PT / 2)  # fmt: skip
            pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=clip, alpha=False)
            base = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize(
                (PANEL, PANEL)
            )
            before, after = base.copy(), base.copy()
            c = (PANEL / 2, PANEL / 2)
            fam, ratio = r["family"], float(r["scale_ratio"])
            rot_before = float(r["rotation_deg"] or 0.0)
            draw_marker(ImageDraw.Draw(before), c, fam, rot_before, z, ratio, BLUE)
            rd = r["reading"]
            deg = rd["deg"]
            colour = GREEN if rd["state"] == "clear" else AMBER
            if deg is not None:
                draw_marker(ImageDraw.Draw(after), c, fam, (90.0 - deg) % 180.0, z, ratio, colour)
            cell = Image.new("RGB", (PANEL * 3 + 8, PANEL + 22), (255, 255, 255))
            for k, im in enumerate((base, before, after)):
                cell.paste(im, (k * (PANEL + 4), 22))
            dd = ImageDraw.Draw(cell)
            shown = f"{deg:g}" if deg is not None else "?"
            label = (
                f"#{n}  {r['tag'] or ''}  new web {shown} deg {rd['state']}"
                f"  (main {rot_before:g} cw)"
            )
            dd.text((2, 4), label, fill=(0, 0, 0))
            cells.append(cell)
            index.append({"n": n, "id": r["id"], "tag": r["tag"], "a": r["a"], "family": fam,
                          "main_rotation_cw": rot_before, "new_web_deg": deg,
                          "new_state": rd["state"], "reason": rd["reason"]})  # fmt: skip
    per_sheet = COLS * 8
    files = []
    for s0 in range(0, len(cells), per_sheet):
        chunk = cells[s0 : s0 + per_sheet]
        rows_n = math.ceil(len(chunk) / COLS)
        w, h = chunk[0].size
        sheet = Image.new("RGB", (COLS * (w + 10), rows_n * (h + 6)), (235, 235, 235))
        for i, im in enumerate(chunk):
            sheet.paste(im, ((i % COLS) * (w + 10), (i // COLS) * (h + 6)))
        f = out / f"{a.name}_{s0 // per_sheet + 1}.png"
        sheet.save(f)
        files.append(str(f))
    (out / f"{a.name}_index.json").write_text(json.dumps(index, indent=1))
    print(
        f"{len(cells)} columns on {len(files)} sheet(s): " + ", ".join(Path(f).name for f in files)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
