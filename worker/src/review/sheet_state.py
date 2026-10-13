"""Facts about a sheet that the pipeline needs and that a person can override.

Mirrors api/src/review/takeoff-sheets.ts: a person's takeoff decision wins; with none (Phase 6b), a
sheet is in the takeoff by default when it is a vector page, whatever its page type. A raster or
unknown page is out by default. The page type only raises a "likely not a framing sheet" flag.
Decisions are the latest `sheet_edits` rows of the sheet (null = cleared).
"""

from typing import Any

import psycopg

SUGGESTED_INCLUDE_PAGE_TYPE = "framing_plan"


def _latest(conn: psycopg.Connection, sheet_id: str, field: str) -> str | None:
    row = conn.execute(
        "SELECT corrected_value FROM sheet_edits WHERE sheet_id = %s AND field_name = %s"
        " ORDER BY created_at DESC, id DESC LIMIT 1",
        (sheet_id, field),
    ).fetchone()
    value = None if row is None else row["corrected_value"]
    return value if isinstance(value, str) else None


def sheet_decision(conn: psycopg.Connection, sheet_id: str) -> str | None:
    """'include', 'exclude' or None (no person decision)."""
    value = _latest(conn, sheet_id, "takeoff")
    return value if value in ("include", "exclude") else None


def effective_page_type(conn: psycopg.Connection, sheet: dict[str, Any]) -> str | None:
    return _latest(conn, str(sheet["id"]), "page_type") or sheet.get("page_type_guess")


def sheet_included(conn: psycopg.Connection, sheet: dict[str, Any]) -> bool:
    decision = sheet_decision(conn, str(sheet["id"]))
    if decision is not None:
        return decision == "include"
    return sheet.get("page_kind") == "vector"
