"""The SYSTEM VERSION of a page as stored in build_snapshots: its setup values with their sources
and every built piece, frozen right after the build (auto mode, Phase 11b; a person's Build, session
preparation). Rows are never changed (migration 017 trigger)."""

from __future__ import annotations

import math
from typing import Any

from psycopg.types.json import Jsonb

SYSTEM = "system"


def snapshot_setup(sheet: dict[str, Any], evidence: dict[str, Any], result: dict | None) -> dict:
    """Every setup value of the page with its source ('system' while not confirmed by a person)."""

    def src(col: str) -> str:
        return "person" if sheet.get(col) else SYSTEM

    def num(v) -> float | None:
        return None if v is None else float(v)

    return {
        "role": {"value": sheet["build_role"] or "skip", "source": src("role_confirmed_by")},
        "crop": {"value": sheet["crop_region"], "source": src("crop_confirmed_by")},
        "scale": {
            "value": num(sheet["build_scale_ratio"]),
            "text": sheet["build_scale_text"],
            "source": src("scale_confirmed_by"),
        },
        "pen_class": {"value": sheet["pen_class"], "source": src("pen_class_confirmed_by")},
        "tos": {"value_mm": num(sheet["tos_mm"]), "source": src("tos_confirmed_by")},
        "column_plan": {
            "value": None if sheet["column_plan_sheet_id"] is None
            else str(sheet["column_plan_sheet_id"]),
            "source": src("column_plan_confirmed_by"),
        },
        "evidence": evidence,
        "refused": (result or {}).get("refused"),
        "failed": (result or {}).get("failed"),
        "built": result is not None and "refused" not in result and "failed" not in result,
    }  # fmt: skip


def _xyz(x, y, z) -> list[float] | None:
    if x is None or y is None:
        return None
    return [float(x), float(y), 0.0 if z is None else float(z)]


def snapshot_pieces(conn, sheet_id: str) -> list[dict[str, Any]]:
    """Every built piece of the page as it is now (right after the build)."""
    out = []
    for r in conn.execute(
        "SELECT * FROM members WHERE sheet_id = %s AND build_run_id IS NOT NULL ORDER BY member_id",
        (sheet_id,),
    ):
        a = _xyz(r["start_x_mm"], r["start_y_mm"], r["start_z_mm"])
        b = _xyz(r["end_x_mm"], r["end_y_mm"], r["end_z_mm"])
        length = None if a is None or b is None else round(math.dist(a, b), 1)
        page = (
            None if r["page_x0"] is None
            else [float(r["page_x0"]), float(r["page_y0"]),
                  float(r["page_x1"] if r["page_x1"] is not None else r["page_x0"]),
                  float(r["page_y1"] if r["page_y1"] is not None else r["page_y0"])]
        )  # fmt: skip
        out.append(
            {
                "member_id": r["member_id"],
                "kind": r["kind"],
                "type": r["type"],
                "tag": None if r["tag_number"] is None
                else f"{r['tag_prefix'] or '?'}{r['tag_number']}",  # the API's tag text
                "profile": r["profile"],
                "profile_raw": r["profile_raw"],
                "page": page,
                "start": a,
                "end": b,
                "length_mm": length if length else None,
                "build_state": r["build_state"],
                "size_state": r["size_state"],
                "support_state": r["support_state"],
                "piece_index": r["piece_index"],
            }
        )  # fmt: skip
    return out


def piece_counts(pieces: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {"pieces": len(pieces)}
    for p in pieces:
        out[f"kind:{p['kind']}"] = out.get(f"kind:{p['kind']}", 0) + 1
        out[f"state:{p['build_state']}"] = out.get(f"state:{p['build_state']}", 0) + 1
    return out


def before_user_edit(conn, sheet_id: str) -> bool:
    """True when the page has no member edit (correction or approval) and no drawn piece yet."""
    return (
        conn.execute(
            "SELECT 1 FROM members m WHERE m.sheet_id = %s AND (m.origin = 'manual'"
            " OR EXISTS (SELECT 1 FROM member_edits e WHERE e.member_id = m.id)) LIMIT 1",
            (sheet_id,),
        ).fetchone()
        is None
    )


def person_snapshot(
    conn,
    project_id: str,
    sheet_id: str,
    run_id: str,
    view_id: str | None,
    sheet: dict[str, Any],
    result: dict[str, Any],
) -> None:
    """The frozen system result of a person's Build: written by the build job in the transaction
    that finishes the run, so no edit of this build can come before it. The session and actor come
    from the project's open session (migration 027 trigger)."""
    pieces = snapshot_pieces(conn, sheet_id)
    conn.execute(
        "INSERT INTO build_snapshots (project_id, sheet_id, build_run_id, view_id, mode,"
        " before_user_edit, setup, pieces, counts)"
        " VALUES (%s, %s, %s, %s, 'person', %s, %s, %s, %s)",
        (project_id, sheet_id, run_id, view_id, before_user_edit(conn, sheet_id),
         Jsonb(snapshot_setup(sheet, {"mode": "person"}, result)), Jsonb(pieces),
         Jsonb(piece_counts(pieces))),
    )  # fmt: skip
