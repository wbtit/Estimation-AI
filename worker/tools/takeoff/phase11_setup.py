"""Phase 11 Part C, step 1: propose the per-page setup on the job-018 copy, render one picture per
candidate page, write the owner's template, and stop (docs/PHASE11_PREREGISTRATION.md, sections 2
and 3).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase11_setup            # proposals + template
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase11_setup --check    # read the owner's points

The owner may correct a crop with `crop_px` and a pen class with `beam_point_px`, both in the pixel
coordinates of setup-pNN.png. `--check` converts them (crop: pixels / px_per_pt; pen: the class of
the nearest extracted line within PEN_POINT_MAX_PX of the point), writes the results under
`derived` in the owner's file (a .bak copy first; owner fields are never changed) and renders
setup-pNN-check.png with the converted crop and the picked class, for the owner to confirm
(`pen_point_ok`). Read-only on the database. Writes only git-ignored files. Prints counts only.
"""

from __future__ import annotations

import json
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from src.build.clean import clean
from src.build.columns import find_glyphs
from src.build.geom import Box, point_seg_dist
from src.build.grids import crossings, find_bubbles, find_grid_lines
from src.build.job import _text_lines
from src.build.segments import crop, page_text_lines, parse_page
from src.config import load_config
from src.linking.lines import Line, page_lines
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
PEN_POINT_MAX_PX = 10.0
OWNER_FIELDS = ("role", "crop_ok", "crop_px", "pen_class_ok", "beam_point_px", "pen_point_ok",
                "pen_class", "scale_ok", "scale_ratio", "tos_mm", "tos_raw",
                "column_plan_page")  # fmt: skip


def whole_sheet_box(w: float, h: float) -> Box:
    return (w * WHOLE_MARGIN, h * WHOLE_MARGIN, w * (1 - WHOLE_RIGHT), h * (1 - WHOLE_MARGIN))


def px_per_pt(w: float, h: float) -> float:
    """Pixels per page point of the setup pictures (the long side is LONG_SIDE_PX)."""
    return LONG_SIDE_PX / max(w, h)


def px_box_to_pt(box_px, zoom: float, size: tuple[float, float]) -> Box:
    """A box given in picture pixels, as displayed page points; corners may come in any order.
    Raises ValueError for a box that is not 4 numbers, is empty or lies outside the page."""
    if not isinstance(box_px, list | tuple) or len(box_px) != 4:
        raise ValueError("crop_px needs four numbers [x0, y0, x1, y1]")
    x0, y0, x1, y1 = (float(v) / zoom for v in box_px)
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise ValueError("crop_px is empty")
    w, h = size
    if x0 < -1 or y0 < -1 or x1 > w + 1 or y1 > h + 1:
        raise ValueError("crop_px is outside the picture")
    return (max(0.0, x0), max(0.0, y0), min(w, x1), min(h, y1))


def nearest_line(lines: list[Line], point_px, zoom: float) -> tuple[Line, float] | None:
    """The extracted line nearest to a picture point, within PEN_POINT_MAX_PX; ties go to the
    longer line. Returns (line, distance in pixels) or None."""
    if not isinstance(point_px, list | tuple) or len(point_px) != 2:
        raise ValueError("beam_point_px needs two numbers [x, y]")
    pt = (float(point_px[0]) / zoom, float(point_px[1]) / zoom)
    best = None
    for ln in lines:
        d = point_seg_dist(pt, (ln.x0, ln.y0), (ln.x1, ln.y1)) * zoom
        if d <= PEN_POINT_MAX_PX:
            key = (round(d, 6), -ln.length, ln.klass)
            if best is None or key < best[0]:
                best = (key, ln, d)
    return None if best is None else (best[1], best[2])


def propose(page: pymupdf.Page, text, box_override=None, pen_override=None) -> dict:
    w, h = page.rect.width, page.rect.height
    if page.rotation in (90, 270):
        w, h = h, w
    full = (0.0, 0.0, w, h)
    ps = crop(parse_page(page), full)
    cl = clean(ps, text)
    bubbles = find_bubbles(ps, text, full)
    grid, _ = find_grid_lines(ps, cl.keep, bubbles)
    anchors = [b for g in grid for b in g.bubbles]
    if box_override is not None:
        box, crop_rule = tuple(box_override), "owner_crop_px"
    elif anchors:
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
    pen = [pen_override] if pen_override else suggest_classes(table)
    cross = crossings(grid)
    cross_dir = crossings(grid, "direction")
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
        "crossings_direction": cross_dir,
        "glyphs": glyphs,
        "tos_hints": [t.text for t in text_in if TOS_RE.search(t.text)][:5],
        "classes": [{"key": c.key, "lines": c.lines} for c in table[:12]],
    }


def render(page: pymupdf.Page, prop: dict, legend: list[str], path, point_px=None,
           what: str = "proposed") -> None:  # fmt: skip
    w, h = prop["size"]
    zoom = px_per_pt(w, h)
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
    if point_px is not None:
        px, py = float(point_px[0]), float(point_px[1])
        r = PEN_POINT_MAX_PX
        d.ellipse([px - r, py - r, px + r, py + r], outline=(0, 0, 0), width=3)
        d.line([(px - 3 * r, py), (px + 3 * r, py)], fill=(0, 0, 0), width=2)
        d.line([(px, py - 3 * r), (px, py + 3 * r)], fill=(0, 0, 0), width=2)
    keys = [
        ((0, 70, 220), f"{what} crop (dashed)"),
        ((220, 30, 30), f"{what} beam pen class"),
        ((0, 150, 60), "grid lines, bubbles, labels"),
        ((160, 0, 200), "column glyph at a grid crossing"),
        ((255, 140, 0), "other glyph candidate"),
    ]
    if point_px is not None:
        keys.append(((0, 0, 0), "your beam point (10 px circle)"))
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


def _context():
    """(stored PDF path, candidate pages, sheet rows by page, text lines by page); read-only."""
    from src.db import connect

    pid = json.loads(PROJECT.read_text())["copy_project_id"]
    theirs, _ = P8.load_theirs()
    tokens = {t for r in theirs for t in r["tokens"]}
    config = load_config()
    with connect(config.database_url) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        mapping, _ = P8.map_sheets(conn, pid, tokens)
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
    return config.upload_dir / file["stored_path"], pages, sheets, texts


def _legend(p: int, role: str, prop: dict, ratio, what: str) -> list[str]:
    n_at = sum(g.at_grid for g in prop["glyphs"])
    return [
        f"page {p}   {what} role: {role}",
        f"pen class: {prop['pen_class'] or 'none qualifies'}",
        f"scale ratio: {ratio if ratio is not None else 'none stored'}",
        f"crop rule: {prop['crop_rule']}",
        f"bubbles {len(prop['bubbles'])}, grid lines {len(prop['grid'])}",
        f"crossings {len(prop['crossings'])} (frozen rule),"
        f" {len(prop['crossings_direction'])} by direction (deviation run)",
        f"glyphs {len(prop['glyphs'])} ({n_at} at a crossing, frozen rule)",
    ]


HOW_TO_FILL = {
    "who": "your name as it should be stored as the confirmer",
    "role": "column_plan, framing or skip (proposed.role is only a guess)",
    "crop_ok": "true to accept proposed.crop",
    "crop_px": "or a corrected crop [x0, y0, x1, y1] in the PIXELS of setup-pNN.png (any two "
    "opposite corners); converted with px_per_pt and shown in setup-pNN-check.png after --check",
    "pen_class_ok": "true to accept proposed.pen_class. Column plan pages do not need a pen "
    "class; if one is confirmed there, beams on that page (e.g. grade beams) are built and counted "
    "as beams too",
    "beam_point_px": "or [x, y] in the PIXELS of setup-pNN.png on one real beam line: the class of "
    "the nearest extracted line within 10 px is taken (source person) and shown highlighted in "
    "setup-pNN-check.png after --check",
    "pen_point_ok": "after --check: true when the highlighted class in setup-pNN-check.png is right",
    "pen_class": "advanced, instead of a point: a class key 'width bucket|colour|solid or dash'",
    "scale_ok": "true to accept proposed.scale_ratio",
    "scale_ratio": "or the ratio real / drawn, e.g. 96 for 1/8 inch = 1 foot",
    "tos_mm": "top of steel of the page in mm (needed for framing pages to build; it does not "
    "change any measure of the bars: both ends of a piece sit at the same T.O.S.)",
    "tos_raw": "optional: the T.O.S. as written",
    "column_plan_page": "framing pages: the page index of their column plan, or 'none'",
    "note": "an empty field is NOT a confirmation; such a page is not built. Run --check after "
    "you give crop_px or beam_point_px; it fills `derived` and never changes your fields",
}


def propose_all() -> None:
    if TEMPLATE.exists():
        existing = json.loads(TEMPLATE.read_text())
        if any(p.get(f) not in (None, "") for p in existing.get("pages", []) for f in OWNER_FIELDS):
            sys.exit("the template already holds owner answers; not overwritten")
    pdf, pages, sheets, texts = _context()
    SHOTS.mkdir(parents=True, exist_ok=True)
    out_pages = []
    with pymupdf.open(pdf) as doc:
        for p in pages:
            s = sheets[p]
            page = doc[p]
            prop = propose(page, texts[p] or page_text_lines(page))
            role = ROLE_OF_GUESS.get(s["page_type_guess"], "skip")
            ratio = s["scale_override_ratio"] or s["scale_parsed_ratio"]
            ratio = None if ratio is None else float(ratio)
            path = SHOTS / f"setup-p{p:02d}.png"
            render(page, prop, _legend(p, role, prop, ratio, "proposed"), path)
            w, h = prop["size"]
            out_pages.append(
                {
                    "page": p,
                    "sheet_id": str(s["id"]),
                    "picture": str(path.relative_to(PRIVATE.parent.parent)),
                    "px_per_pt": round(px_per_pt(w, h), 6),
                    "picture_size_px": [round(w * px_per_pt(w, h)), round(h * px_per_pt(w, h))],
                    "proposed": {
                        "role": role,
                        "crop": [round(v, 1) for v in prop["crop"]],
                        "crop_px": [round(v * px_per_pt(w, h)) for v in prop["crop"]],
                        "crop_rule": prop["crop_rule"],
                        "pen_class": prop["pen_class"],
                        "scale_ratio": ratio,
                        "tos_hints": prop["tos_hints"],
                        "grid_labels": sorted(g.label for g in prop["grid"]),
                        "crossings_frozen_rule": len(prop["crossings"]),
                        "crossings_by_direction": len(prop["crossings_direction"]),
                        "classes_in_crop": prop["classes"],
                    },
                    **{f: None for f in OWNER_FIELDS},
                    "derived": None,
                }
            )
            print(
                f"page {p}: role {role}, grid lines {len(prop['grid'])}, crossings"
                f" {len(prop['crossings'])} / by direction {len(prop['crossings_direction'])},"
                f" glyphs {len(prop['glyphs'])}, pen {'yes' if prop['pen_class'] else 'none'},"
                f" crop {prop['crop_rule']}"
            )
    template = {"how_to_fill": HOW_TO_FILL, "who": None, "pages": out_pages}
    STUDY.mkdir(parents=True, exist_ok=True)
    TEMPLATE.write_text(json.dumps(template, indent=1))
    print(f"pages {len(out_pages)}; template written; pictures in {SHOTS.name}")


def check() -> None:
    data = json.loads(TEMPLATE.read_text())
    todo = [e for e in data["pages"] if e.get("crop_px") or e.get("beam_point_px")]
    if not todo:
        print("no crop_px or beam_point_px given; nothing to check")
        return
    pdf, _, sheets, texts = _context()
    with pymupdf.open(pdf) as doc:
        for e in todo:
            p = e["page"]
            page = doc[p]
            w, h = (page.rect.width, page.rect.height)
            if page.rotation in (90, 270):
                w, h = h, w
            zoom = px_per_pt(w, h)
            derived: dict = {}
            box = None
            if e.get("crop_px"):
                try:
                    box = px_box_to_pt(e["crop_px"], zoom, (w, h))
                    derived["crop"] = [round(v, 1) for v in box]
                except ValueError as err:
                    derived["crop_error"] = str(err)
            pen = None
            if e.get("beam_point_px"):
                try:
                    hit = nearest_line(page_lines(page), e["beam_point_px"], zoom)
                except ValueError as err:
                    hit, derived["pen_error"] = None, str(err)
                if hit is None and "pen_error" not in derived:
                    derived["pen_error"] = f"no extracted line within {PEN_POINT_MAX_PX:g} px"
                elif hit is not None:
                    pen = hit[0].klass
                    derived["pen_class"] = pen
                    derived["pen_source"] = "person"
                    derived["pen_point_distance_px"] = round(hit[1], 1)
            shown = pen or e.get("pen_class") or e["proposed"]["pen_class"]
            prop = propose(page, texts[p] or page_text_lines(page), box, shown)
            role = e.get("role") or e["proposed"]["role"]
            ratio = e.get("scale_ratio") or e["proposed"]["scale_ratio"]
            path = SHOTS / f"setup-p{p:02d}-check.png"
            legend = _legend(p, role, prop, ratio, "check:")
            render(page, prop, legend, path, e.get("beam_point_px"), "your")
            derived["check_picture"] = str(path.relative_to(PRIVATE.parent.parent))
            e["derived"] = derived
            print(
                f"page {p}: crop {'ok' if 'crop' in derived else derived.get('crop_error', '-')},"
                f" pen {'picked' if pen else derived.get('pen_error', '-')}"
            )
    TEMPLATE.with_suffix(".json.bak").write_text(TEMPLATE.read_text())
    TEMPLATE.write_text(json.dumps(data, indent=1))
    print(f"checked {len(todo)} pages; derived values written; owner fields unchanged")


def main() -> None:
    if "--check" in sys.argv[1:]:
        check()
    else:
        propose_all()


if __name__ == "__main__":
    main()
