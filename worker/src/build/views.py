"""Build views (Phase 11c, docs/PHASE11C_PLAN.md): a page has one or more views; each view holds
the setup the build reads (box, role, scale, T.O.S., beam pens, accepted exclude boxes, deselected
lines, column plan link). The setup rules (job.setup_reasons, auto.snapshot_setup) read a sheet row,
so a view is read through `view_as_sheet`: the sheet row with its setup columns replaced by the
view's values, exactly as the API does (api/src/review/build-views.ts, asSheet). The first view of a
page therefore builds exactly as the page did before views. Pure apart from the loaders.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.build.geom import Box

NAME_OF_ROLE = {"column_plan": "Column plan", "framing": "Framing plan"}
# auto mode: the name of a page it does not build, from the page type guess
NAME_OF_GUESS = {
    "detail": "Detail",
    "elevation": "Elevation",
    "general_notes": "Notes",
    "schedule_legend": "Schedule",
}
SKIP_NAME = "Other"


@dataclass
class View:
    row: dict[str, Any]
    behaviour: str | None  # column_plan, framing, none; None = no role yet
    pens: list[dict[str, Any]] = field(default_factory=list)  # by position
    plan_sheet_id: str | None = None
    excludes: list[Box] = field(default_factory=list)  # accepted boxes only
    deselected: list[tuple[float, float, float, float]] = field(default_factory=list)

    @property
    def id(self) -> str:
        return str(self.row["id"])

    @property
    def first(self) -> bool:
        return self.row["position"] == 1


def role_name(role: str | None, page_type_guess: str | None) -> str:
    """The role name auto mode writes for a proposed role (None = not built)."""
    if role == "column_plan" and page_type_guess == "foundation_plan":
        return "Foundation plan"
    if role:
        return NAME_OF_ROLE[role]
    return NAME_OF_GUESS.get(page_type_guess or "", SKIP_NAME)


def load_views(conn, sheet_id: str) -> list[View]:
    """The views of a sheet by position, with pens, behaviour, accepted exclude boxes and
    deselected lines."""
    rows = conn.execute(
        "SELECT v.*, r.behaviour, p.sheet_id AS plan_sheet_id FROM build_views v"
        " LEFT JOIN role_names r ON r.name = v.role_name"
        " LEFT JOIN build_views p ON p.id = v.column_plan_view_id"
        " WHERE v.sheet_id = %s ORDER BY v.position",
        (sheet_id,),
    ).fetchall()
    out = []
    for r in rows:
        vid = r["id"]
        pens = conn.execute(
            "SELECT * FROM view_pens WHERE view_id = %s ORDER BY position", (vid,)
        ).fetchall()
        exc = [
            _box(e["box"])
            for e in conn.execute(
                "SELECT box FROM view_exclusions WHERE view_id = %s AND status = 'accepted'"
                " ORDER BY created_at, id",
                (vid,),
            )
        ]
        des = [
            (float(d["x0"]), float(d["y0"]), float(d["x1"]), float(d["y1"]))
            for d in conn.execute(
                "SELECT x0, y0, x1, y1 FROM view_deselections WHERE view_id = %s"
                " ORDER BY created_at, id",
                (vid,),
            )
        ]
        row = {k: v for k, v in r.items() if k not in ("behaviour", "plan_sheet_id")}
        out.append(
            View(
                row,
                r["behaviour"],
                list(pens),
                None if r["plan_sheet_id"] is None else str(r["plan_sheet_id"]),
                exc,
                des,
            )
        )
    return out


def pick_view(views: list[View], view_id: str | None = None) -> View | None:
    if view_id:
        return next((v for v in views if v.id == str(view_id)), None)
    return next((v for v in views if v.first), views[0] if views else None)


def view_as_sheet(sheet: dict[str, Any], v: View) -> dict[str, Any]:
    """The sheet row as the setup rules read it, with the view's values in the setup columns."""
    r = v.row
    pen = v.pens[0] if v.pens else None
    role = v.behaviour if v.behaviour in ("column_plan", "framing") else None
    return {
        **sheet,
        "build_role": role,
        "role_confirmed_by": r["role_confirmed_by"],
        "role_confirmed_at": r["role_confirmed_at"],
        "crop_region": r["box"],
        "crop_confirmed_by": r["box_confirmed_by"],
        "crop_confirmed_at": r["box_confirmed_at"],
        "build_scale_ratio": r["scale_ratio"],
        "build_scale_text": r["scale_text"],
        "scale_confirmed_by": r["scale_confirmed_by"],
        "scale_confirmed_at": r["scale_confirmed_at"],
        "tos_mm": r["tos_mm"],
        "tos_raw": r["tos_raw"],
        "tos_source": r["tos_source"],
        "tos_confirmed_by": r["tos_confirmed_by"],
        "tos_confirmed_at": r["tos_confirmed_at"],
        "pen_class": pen["pen_class"] if pen else None,
        "pen_class_source": pen["source"] if pen else ("person" if r["no_beams_by"] else None),
        "pen_class_confirmed_by": pen["confirmed_by"] if pen else r["no_beams_by"],
        "pen_class_confirmed_at": pen["confirmed_at"] if pen else r["no_beams_at"],
        "column_plan_sheet_id": v.plan_sheet_id,
        "column_plan_confirmed_by": r["column_plan_confirmed_by"],
        "column_plan_confirmed_at": r["column_plan_confirmed_at"],
        "setup_changed_at": r["setup_changed_at"],
        "built_at": r["built_at"],
        "registration": r["registration"],
    }


def _box(b: dict[str, Any]) -> Box:
    return (float(b["x0"]), float(b["y0"]), float(b["x1"]), float(b["y1"]))


__all__ = [
    "NAME_OF_ROLE",
    "SKIP_NAME",
    "View",
    "load_views",
    "pick_view",
    "role_name",
    "view_as_sheet",
]
