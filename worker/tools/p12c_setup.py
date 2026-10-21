"""Phase 12c-A (docs/PHASE12C_PLAN.md section 3): the simulated person setup, then the build.

  PYTHONPATH=. .venv/bin/python -m tools.p12c_setup <job id> [--apply]

The copy `p12c-<job>` must exist (`tools.copy_project`). Without --apply: a preview (pages to build,
roles, scale sources; counts only, nothing written). With --apply: auto mode with phase12b-build-v1,
where only the role and the scale of each page's proposal are replaced by the simulated setup
(pages, role and scale from the estimators' markups). Every value stays a SYSTEM value; the
evidence of each page carries `p12c_person_setup`. The engine is not changed.
"""

from __future__ import annotations

import collections
import json
import sys
from typing import Any

import pymupdf

from src.build import RULES_VERSION, auto
from src.build.dimension_scale import scale_from_dimensions
from src.build.job import _text_lines
from src.build.propose import propose_crop, propose_pen, propose_scale
from src.build.segments import crop, page_text_lines, parse_page
from src.build.views import load_views, pick_view, role_name
from src.config import load_config
from src.db import connect
from tools.p12c_lib import pages_to_build, their_pages

MARKUP_SCALE_TEXT = "from estimator markup"
TAG = "p12c_person_setup"


def scale_of(conn, page: pymupdf.Page, sheet: dict, markup: float | None) -> dict[str, Any]:
    """The first source that gives a scale: markup, parsed, dimensions; else none."""
    if markup is not None:
        return {"ratio": markup, "text": MARKUP_SCALE_TEXT, "source": "markup"}
    ratio, text = propose_scale(sheet)
    if ratio is not None:
        return {"ratio": ratio, "text": text, "source": "parsed"}
    lines = _text_lines(conn, str(sheet["id"])) or page_text_lines(page)
    box = propose_crop(page, lines).box
    dims = scale_from_dimensions(crop(parse_page(page), box), lines, box)
    if dims.ratio is not None:
        return {"ratio": dims.ratio, "text": auto.SCALE_FROM_DIMENSIONS, "source": "dimensions"}
    return {"ratio": None, "text": None, "source": "none"}


def plan_job(conn, job: str, project_id: str) -> dict[int, dict[str, Any]]:
    theirs = their_pages(job)
    roles = pages_to_build(theirs)
    sheets = conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s JOIN project_files f ON f.project_id ="
        " s.project_id WHERE s.project_id = %s ORDER BY s.page_index",
        (project_id,),
    ).fetchall()
    cfg = load_config()
    out: dict[int, dict[str, Any]] = {}
    with pymupdf.open(cfg.upload_dir / sheets[0]["stored_path"]) as doc:
        for s in sheets:
            dp = s["page_index"]
            if dp not in roles:
                continue
            sc = scale_of(conn, doc[dp], s, theirs[dp].markup_ratio())
            out[dp] = {"role": roles[dp], **sc, "page_kind": s["page_kind"]}
    missing = sorted(dp for dp in roles if dp not in out)
    if missing:
        out[-1] = {"pages_not_in_project": len(missing)}
    return out


def install(setup: dict[int, dict[str, Any]]) -> None:
    """Replace auto mode's proposal with the simulated setup (in this process only)."""
    original = auto.propose_sheet

    def propose(conn, page: pymupdf.Page, sheet: dict[str, Any]) -> dict[str, Any]:
        ev = original(conn, page, sheet)
        mine = setup.get(sheet["page_index"])
        view = pick_view(load_views(conn, str(sheet["id"])))
        assert view is not None
        if mine is None:  # not marked by them: not built
            if ev["role"] is not None:
                conn.execute(
                    "UPDATE build_views SET role_name = %s WHERE id = %s",
                    (role_name(None, sheet["page_type_guess"]), view.id),
                )
                conn.execute("DELETE FROM view_pens WHERE view_id = %s", (view.id,))
            ev.update(role=None, pile_plan=False, **{TAG: {"built": False}})
            return ev
        role = mine["role"]
        conn.execute(
            "UPDATE build_views SET role_name = %s, scale_ratio = %s, scale_text = %s"
            " WHERE id = %s",
            (role_name(role, sheet["page_type_guess"]), mine["ratio"], mine["text"], view.id),
        )
        conn.execute("DELETE FROM view_pens WHERE view_id = %s", (view.id,))
        pen = None
        if role == "framing":
            b = view.row["box"]
            pen = propose_pen(page, (b["x0"], b["y0"], b["x1"], b["y1"]))[0]
            if pen:
                conn.execute(
                    "INSERT INTO view_pens (view_id, position, pen_class, source)"
                    " VALUES (%s, 1, %s, 'suggested')",
                    (view.id, pen),
                )
        ev.update(
            role=role,
            pile_plan=False,
            pen_rule="column_plan_no_beams" if role == "column_plan" else "proposed",
            scale_rule="scale_needed" if mine["ratio"] is None else mine["source"],
            **{TAG: {"built": True, "role": role, "scale_source": mine["source"], "pen": pen}},
        )
        return ev

    auto.propose_sheet = propose


def main(argv: list[str]) -> None:
    args = [a for a in argv if not a.startswith("--")]
    job = args[0]
    cfg = load_config()
    with connect(cfg.database_url) as conn:
        row = conn.execute(
            "SELECT id FROM projects WHERE name = %s AND NOT archived", (f"p12c-{job}",)
        ).fetchone()
        if row is None:
            print(json.dumps({"job": job, "error": "copy p12c-<job> not found"}))
            return
        pid = str(row["id"])
        setup = plan_job(conn, job, pid)
        extra = setup.pop(-1, {})
        summary = {
            "job": job,
            "rules": RULES_VERSION,
            "pages": len(setup),
            "roles": dict(collections.Counter(v["role"] for v in setup.values())),
            "scale_sources": dict(collections.Counter(v["source"] for v in setup.values())),
            "raster_pages": sum(v["page_kind"] != "vector" for v in setup.values()),
            **extra,
        }
        if "--apply" not in argv:
            print(json.dumps({"preview": True, **summary}))
            return
        install(setup)
        out = auto.auto_build(conn, cfg, pid, crossing_rule="family")
        out.pop("auto_build_id", None)
        print(json.dumps({**summary, "auto": out}))


if __name__ == "__main__":
    main(sys.argv[1:])
