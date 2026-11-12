"""Width check of a double-line pair: the gap between the two flange lines at the page scale versus
the AISC flange width (`bf`, inches) of the attached label's profile (Review 4).

`bf` comes from the stored catalog (catalog_shapes.properties) of CATALOG_EDITION, else the most
recently imported edition (the same choice as the API's review screen). A profile with no numeric
`bf` (angles, pipes, ...) is not checked and never amber for width.
"""

from __future__ import annotations

import os
from typing import Any

import psycopg

from src.build.double_line import WIDTH_TOL_IN, WIDTH_TOL_REL


class FlangeWidths:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn
        edition = os.environ.get("CATALOG_EDITION")
        if not edition:
            row = conn.execute(
                "SELECT edition FROM catalog_shapes ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            edition = row["edition"] if row else None
        self.edition = edition
        self._cache: dict[str, float | None] = {}

    def bf_in(self, canonical: str | None) -> float | None:
        if not canonical or self.edition is None:
            return None
        if canonical not in self._cache:
            row = self.conn.execute(
                "SELECT properties->>'bf' AS bf FROM catalog_shapes"
                " WHERE edition = %s AND shape_name = %s",
                (self.edition, canonical),
            ).fetchone()
            try:
                self._cache[canonical] = float(row["bf"]) if row and row["bf"] else None
            except ValueError:  # "–": no flange width for this shape
                self._cache[canonical] = None
        return self._cache[canonical]


def width_check(gap_in: float | None, label: Any, bf_in: float | None) -> list[str]:
    """Amber reasons (empty when the gap fits the flange width or there is nothing to check)."""
    if label is None or bf_in is None or gap_in is None:
        return []
    if abs(gap_in - bf_in) <= max(WIDTH_TOL_IN, WIDTH_TOL_REL * bf_in):
        return []
    return [
        f"width: the two lines are {gap_in:.2f} in apart, {label.canonical} flange is {bf_in:g} in"
    ]
