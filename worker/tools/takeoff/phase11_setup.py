"""Phase 11 Part C, step 1: propose the per-page setup on the job-018 copy, render one picture per
candidate page, write the owner's template, and stop (docs/PHASE11_PREREGISTRATION.md, sections 2
and 3).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase11_setup

Read-only on the database (one read-only transaction). Writes only git-ignored files:
fixtures/private/shots/phase11/setup-pNN.png and fixtures/private/study/phase11_setup.json (refuses
to overwrite a template the owner has started to fill). Prints counts only, never page text.
"""

from __future__ import annotations

import json
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from src.build.clean import clean
from src.build.columns import find_glyphs
from src.build.geom import Box
from src.build.grids import crossings, find_bubbles, find_grid_lines
from src.build.job import _text_lines
from src.build.segments import crop, page_text_lines, parse_page
from src.config import load_config
from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from tools.takeoff import phase8_eval as P8
from tools.takeoff.common import PRIVATE

SHOTS = PRIVATE / "shots" / "phase11"
STUDY = PRIVATE / "study"
TEMPLATE = STUDY / "phase11_setup.json"
PROJECT = STUDY / "phase11_project.json"
CROP_MARGIN_PT = 36.0
WHOLE_MARGIN, WHOLE_RIGHT = 0.025, 0.14  # Phase 5b whole-sheet view box
ROLE_OF_GUESS = {"foundation_plan": "column_plan", "framing_plan": "framing"}
TOS_RE = re.compile(r"T\.?\s*O\.?\s*S|T/S", re.IGNORECASE)
LONG_SIDE_PX = 3000
OWNER_FIELDS = ("role", "crop_ok", "crop", "pen_class_ok", "pen_class", "scale_ok", "scale_ratio",
                "tos_mm", "tos_raw", "column_plan_page")  # fmt: skip


def whole_sheet_box(w: float, h: float) -> Box:
    return (w * WHOLE_MARGIN, h * WHOLE_MARGIN, w * (1 - WHOLE_RIGHT), h * (1 - WHOLE_MARGIN))


def propose(page: pymupdf.Page, text) -> dict:
    w, h = page.rect.width, page.rect.height
    if page.rotation in (90, 270):
        w, h = h, w
    full = (0.0, 0.0, w, h)
    ps = crop(parse_page(page), full)
    cl = clean(ps, text)
    bubbles = find_bubbles(ps, text, full)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    anchors = [b for g in grid for b in g.bubbles]
    if anchors:
        box = (
            max(0.0, min(b.centre[0] - b.radius for b in anchors) - CROP_MARGIN_PT),
            max(0.0, min(b.centre[1] - b.radius for b in anchors) - CROP_MARGIN_PT),
            min(w, max(b.centre[0] + b.radius for b in anchors) + CROP_MARGIN_PT),
            min(h, max(b.centre[1] + b.radius for b in anchors) + CROP_MARGIN_PT),
        )
        crop_rule = "grid_bubbles"
    else:
        box, crop_rule = whole_sheet_box(w, h), "fallback_whole_sheet"
    in_crop = lines_in_box(page_lines(page), box, (w, h))
    table = class_table(in_crop)
    pen = suggest_classes(table)
    cross = crossings(grid)
    text_in = [
        t for t in text if box[0] <= t.centre[0] <= box[2] and box[1] <= t.centre[1] <= box[3]
    ]
    glyphs = find_glyphs(crop(ps, box), box, bubbles, text_in, cross)
    return {
        "size": (w, h),
        "crop": box,
        "crop_rule": crop_rule,
        "pen_class": pen[0] if pen else None,
        "pen_lines": [ln for ln in in_crop if pen and ln.klass == pen[0]],
        "bubbles": bubbles,
        "grid": grid,
        "crossings": cross,
        "glyphs": glyphs,
        "tos_hints": [t.text for t in text_in if TOS_RE.search(t.text)][:5],
        "classes": [{"key": c.key, "lines": c.lines} for c in table[:12]],
    }


def render(page: pymupdf.Page, prop: dict, legend: list[str], path) -> None:
    w, h = prop["size"]
    zoom = LONG_SIDE_PX / max(w, h)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), annots=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = Image.blend(img, Image.new("RGB", img.size, (255, 255, 255)), 0.7)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=22)

    def z(p):
        return (p[0] * zoom, p[1] * zoom)

    for ln in prop["pen_lines"]:
        d.line([z((ln.x0, ln.y0)), z((ln.x1, ln.y1))], fill=(220, 30, 30), width=4)
    for g in prop["grid"]:
        d.line([z(g.p0), z(g.p1)], fill=(0, 150, 60), width=3)
        for b in g.bubbles:
            cx, cy = z(b.centre)
            d.text((cx + b.radius * zoom + 4, cy - 12), g.label, fill=(0, 120, 40), font=font)
    for b in prop["bubbles"]:
        cx, cy = z(b.centre)
        r = b.radius * zoom
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 150, 60), width=3)
    for gl in prop["glyphs"]:
        x0, y0 = z(gl.box[:2])
        x1, y1 = z(gl.box[2:])
        colour = (160, 0, 200) if gl.at_grid else (255, 140, 0)
        d.rectangle([x0 - 3, y0 - 3, x1 + 3, y1 + 3], outline=colour, width=3)
    x0, y0 = z(prop["crop"][:2])
    x1, y1 = z(prop["crop"][2:])
    step = 24
    for x in range(int(x0), int(x1), step):  # dashed crop box
        d.line([(x, y0), (min(x + 12, x1), y0)], fill=(0, 70, 220), width=5)
        d.line([(x, y1), (min(x + 12, x1), y1)], fill=(0, 70, 220), width=5)
    for y in range(int(y0), int(y1), step):
        d.line([(x0, y), (x0, min(y + 12, y1))], fill=(0, 70, 220), width=5)
        d.line([(x1, y), (x1, min(y + 12, y1))], fill=(0, 70, 220), width=5)
    keys = [
        ((0, 70, 220), "proposed crop (dashed)"),
        ((220, 30, 30), "proposed beam pen class"),
        ((0, 150, 60), "grid lines, bubbles, labels"),
        ((160, 0, 200), "column glyph at a grid crossing"),
        ((255, 140, 0), "other glyph candidate"),
    ]
    rows = legend + [""] + [t for _, t in keys]
    bw, bh = 640, 28 * len(rows) + 16
    d.rectangle([8, 8, 8 + bw, 8 + bh], fill=(255, 255, 255), outline=(0, 0, 0), width=2)
    for i, t in enumerate(rows):
        y = 16 + 28 * i
        k = i - len(legend) - 1
        if 0 <= k < len(keys):
            d.rectangle([18, y + 4, 36, y + 22], fill=keys[k][0])
            d.text((44, y), t, fill=(0, 0, 0), font=font)
        else:
            d.text((18, y), t, fill=(0, 0, 0), font=font)
    img.save(path)


def main() -> None:
    if TEMPLATE.exists():
        existing = json.loads(TEMPLATE.read_text())
        if any(p.get(f) not in (None, "") for p in existing.get("pages", []) for f in OWNER_FIELDS):
            sys.exit("the template already holds owner answers; not overwritten")
    pid = json.loads(PROJECT.read_text())["copy_project_id"]
    theirs, _ = P8.load_theirs()
    tokens = {t for r in theirs for t in r["tokens"]}
    config = load_config()
    from src.db import connect

    SHOTS.mkdir(parents=True, exist_ok=True)
    out_pages = []
    with connect(config.database_url) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        mapping, sheet_of = P8.map_sheets(conn, pid, tokens)
        pages = sorted({p for p in mapping.values() if p is not None})
        file = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
        ).fetchone()
        sheets = {
            r["page_index"]: r
            for r in conn.execute("SELECT * FROM sheets WHERE project_id = %s", (pid,))
        }
        texts = {p: _text_lines(conn, str(sheets[p]["id"])) for p in pages}
        conn.rollback()
    with pymupdf.open(config.upload_dir / file["stored_path"]) as doc:
        for p in pages:
            s = sheets[p]
            page = doc[p]
            text = texts[p] or page_text_lines(page)
            prop = propose(page, text)
            role = ROLE_OF_GUESS.get(s["page_type_guess"], "skip")
            ratio = s["scale_override_ratio"] or s["scale_parsed_ratio"]
            ratio = None if ratio is None else float(ratio)
            n_at = sum(g.at_grid for g in prop["glyphs"])
            legend = [
                f"page {p}   proposed role: {role}",
                f"pen class: {prop['pen_class'] or 'none qualifies'}",
                f"scale ratio: {ratio if ratio is not None else 'none stored'}",
                f"crop rule: {prop['crop_rule']}",
                f"bubbles {len(prop['bubbles'])}, grid lines {len(prop['grid'])},"
                f" crossings {len(prop['crossings'])}",
                f"glyphs {len(prop['glyphs'])} ({n_at} at a crossing)",
            ]
            path = SHOTS / f"setup-p{p:02d}.png"
            render(page, prop, legend, path)
            out_pages.append(
                {
                    "page": p,
                    "sheet_id": str(s["id"]),
                    "proposed": {
                        "role": role,
                        "crop": [round(v, 1) for v in prop["crop"]],
                        "crop_rule": prop["crop_rule"],
                        "pen_class": prop["pen_class"],
                        "scale_ratio": ratio,
                        "tos_hints": prop["tos_hints"],
                        "grid_labels": sorted(g.label for g in prop["grid"]),
                        "classes_in_crop": prop["classes"],
                    },
                    "picture": str(path.relative_to(PRIVATE.parent.parent)),
                    **{f: None for f in OWNER_FIELDS},
                }
            )
            print(
                f"page {p}: role {role}, grid lines {len(prop['grid'])}, crossings"
                f" {len(prop['crossings'])}, glyphs {len(prop['glyphs'])}, pen"
                f" {'yes' if prop['pen_class'] else 'none'}, crop {prop['crop_rule']}"
            )
    template = {
        "how_to_fill": {
            "who": "your name as it should be stored as the confirmer",
            "role": "column_plan, framing or skip (proposed.role is only a guess)",
            "crop_ok": "true to accept proposed.crop; or leave false/null and give crop",
            "crop": "[x0, y0, x1, y1] in displayed page points, when you correct the crop",
            "pen_class_ok": "true to accept proposed.pen_class; or give pen_class",
            "pen_class": "width bucket|colour|solid or dash, e.g. 1.5-2.5|black|solid",
            "scale_ok": "true to accept proposed.scale_ratio; or give scale_ratio",
            "scale_ratio": "real / drawn, e.g. 96 for 1/8 inch = 1 foot",
            "tos_mm": "top of steel of the page in mm (required for framing pages)",
            "tos_raw": "optional: the T.O.S. as written",
            "column_plan_page": "framing pages: the page index of their column plan, or 'none'",
            "note": "an empty field is NOT a confirmation; such a page is not built",
        },
        "who": None,
        "pages": out_pages,
    }
    STUDY.mkdir(parents=True, exist_ok=True)
    TEMPLATE.write_text(json.dumps(template, indent=1))
    print(f"pages {len(out_pages)}; template written; pictures in {SHOTS.name}")


if __name__ == "__main__":
    main()
