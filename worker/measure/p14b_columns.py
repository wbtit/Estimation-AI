"""The column measure library of Phase 14b (docs/PHASE14B_PREREGISTRATION.md; session 1 page 5
and the DEV column-plan pages; read-only): the page loader (`load`, DEV jobs only), the one-to-one
match against the truth (`measure`, MATCH_PT), pooling (`pooled`) and the gallery panel. Used by the
column harness measure/p14d_columns.py. The 14b run itself (flag configurations A / NEW-*) was
removed with the build flags in the cleanup; it is kept in the tag archive/pre-cleanup-20261104.
"""

from __future__ import annotations

import json
import math
from typing import Any

import pymupdf
from PIL import Image, ImageDraw

from measure.p12c_eval import _render, one_to_one
from measure.p12c_lib import COLUMN, JOBS, group, project_name, their_pages
from measure.p13a_pen import VERDICT_GROUPS, Page
from measure.takeoff.common import PRIVATE, ROOT
from src.build.col_symbols import STUD_KIND
from src.config import load_config
from src.db import connect

PREREG = ROOT / "docs" / "PHASE14B_PREREGISTRATION.md"
PREREG_HASH = ROOT / "worker" / "prereg" / "PHASE14B.sha256"
PREREG2 = ROOT / "docs" / "PHASE14B2_PREREGISTRATION.md"
PREREG2_HASH = ROOT / "worker" / "prereg" / "PHASE14B2.sha256"
# v2 information configurations: one change alone
SESSION = "3e829c0b-0e49-45ae-af82-87831c55551b"
EXPORT = PRIVATE / "sessions" / SESSION  # the frozen export v1
PAGE5 = 4  # page index of session 1 page 5
MATCH_PT = 36.0
SEED = 13


class Ctx:
    def __init__(self, key: str, grp: str, pg: Page, truth: list[tuple[float, float]]):
        self.key, self.group, self.pg, self.truth = key, grp, pg, truth


def measure(ctx: Ctx, rec: dict[str, Any]) -> None:
    pts = [tuple(c["pt"]) for c in rec["columns"]]
    m = one_to_one(ctx.truth, pts, math.dist, MATCH_PT)
    got = set(m.values())
    for j, c in enumerate(rec["columns"]):
        c["matched"] = j in got
    ours, theirs = len(pts), len(ctx.truth)
    rec.update(
        ours=ours,
        theirs=theirs,
        matched=len(m),
        precision=len(m) / ours if ours else None,
        recall=len(m) / theirs if theirs else None,
        within=abs(ours - theirs) <= 0.2 * theirs if theirs else ours == 0,
        truth_matched=[k in m for k in range(theirs)],
    )


def load() -> list[Ctx]:
    cfg = load_config()
    out: list[Ctx] = []
    docs = []
    with connect(cfg.database_url) as conn:
        conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        # (a) session 1 page 5: frozen snapshot and truth (v1 export), setup and text read-only
        snaps = json.loads((EXPORT / "build_snapshots.json").read_text())
        sheets = {
            s["id"]: s["page_index"] for s in json.loads((EXPORT / "sheets.json").read_text())
        }
        sn = next(s for s in snaps if sheets[s["sheet_id"]] == PAGE5 and s["before_user_edit"])
        pid = json.loads((EXPORT / "manifest.json").read_text())["project_id"]
        stored = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
        ).fetchone()["stored_path"]
        doc = pymupdf.open(cfg.upload_dir / stored)
        docs.append(doc)
        pg = Page(conn, pid, sn["sheet_id"], sn, doc[PAGE5])
        truth = [
            tuple(p["a"])
            for p in json.loads((EXPORT / "pieces_final.json").read_text())
            if p["sheet_id"] == sn["sheet_id"] and p["added"] and not p["deleted"]
        ]
        out.append(Ctx("session1 p5", "session1", pg, truth))
        # (b) the DEV column-plan pages of the 12c-A / 13c verdict set
        for job in JOBS:
            if group(job) not in VERDICT_GROUPS:
                continue
            pid = str(
                conn.execute(
                    "SELECT id FROM projects WHERE name = %s ORDER BY created_at DESC LIMIT 1",
                    (project_name(job),),
                ).fetchone()["id"]
            )
            theirs = their_pages(job)
            stored = conn.execute(
                "SELECT stored_path FROM project_files WHERE project_id = %s", (pid,)
            ).fetchone()["stored_path"]
            rows = conn.execute(
                "SELECT s.id AS sheet_id, s.page_index, b.setup, b.pieces FROM build_snapshots b"
                " JOIN sheets s ON s.id = b.sheet_id WHERE b.project_id = %s ORDER BY s.page_index",
                (pid,),
            ).fetchall()
            doc = pymupdf.open(cfg.upload_dir / stored)
            docs.append(doc)
            for r in rows:
                tag = r["setup"]["evidence"].get("p12c_person_setup") or {}
                if not tag.get("built") or not r["setup"]["built"]:
                    continue
                if r["setup"]["role"]["value"] != "column_plan":
                    continue
                dp = r["page_index"]
                pg = Page(conn, pid, str(r["sheet_id"]), r, doc[dp])
                marks = [(s.x, s.y) for s in theirs[dp].symbols if s.prefix == COLUMN]
                out.append(Ctx(f"{job} p{dp + 1}", group(job), pg, marks))
    return out


def pooled(pages: list[dict], cfg: str) -> dict[str, Any]:
    rs = [p["configs"][cfg] for p in pages]
    m, o, t = (sum(r[k] for r in rs) for k in ("matched", "ours", "theirs"))
    return {
        "pages": len(rs),
        "within": sum(bool(r["within"]) for r in rs),
        "matched": m,
        "ours": o,
        "theirs": t,
        "precision": m / o if o else None,
        "recall": m / t if t else None,
    }


# --- gallery --------------------------------------------------------------------------------------
WIN_PT = 200.0
ZOOM = 3.0


def _panel(page, box, cols, truth) -> Image.Image:
    img = _render(page, box, ZOOM)
    img = Image.blend(img, Image.new("RGB", img.size, (255, 255, 255)), 0.35)
    d = ImageDraw.Draw(img)
    P = lambda x, y: ((x - box[0]) * ZOOM, (y - box[1]) * ZOOM)  # noqa: E731
    for t in truth:
        c = P(*t)
        d.ellipse([c[0] - 14, c[1] - 14, c[0] + 14, c[1] + 14], outline=(0, 90, 255), width=4)
    for c in cols:
        a = P(*c["pt"])
        colour = (230, 120, 0) if c["kind"] == STUD_KIND else (0, 160, 140)
        d.rectangle([a[0] - 9, a[1] - 9, a[0] + 9, a[1] + 9], outline=colour, width=4)
    return img


# --- report ---------------------------------------------------------------------------------------
def _pct(x: float | None) -> str:
    return "-" if x is None else f"{100 * x:.0f}%"
