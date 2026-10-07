"""Glyph library: in-memory matcher and persistence (table glyph_library, migration 003).

Only entries with status `confirmed` and a label decode text. Proposed entries exist to group
unknown shapes so a person can label them; matching them yields "unknown", never a guess.
"""

from dataclasses import dataclass

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from src.text_reader.geometry import (
    CHAMFER_TOL,
    HAUSDORFF_TOL,
    N_POINTS,
    Descriptor,
    Strokes,
    describe,
    distances,
    rounded_strokes,
    signature_hash,
)

CONFIRMED = "confirmed"
PROPOSED = "proposed"


@dataclass
class Entry:
    font_id: str
    signature_hash: str
    strokes: Strokes
    label: str | None
    status: str
    seen_count: int
    desc: Descriptor
    id: str | None = None

    @property
    def decodes(self) -> bool:
        return self.status == CONFIRMED and bool(self.label)


def new_entry(
    font_id: str, strokes: Strokes, label: str | None = None, status: str = PROPOSED
) -> Entry:
    rounded = [[(x, y) for x, y in s] for s in rounded_strokes(strokes)]
    return Entry(
        font_id=font_id,
        signature_hash=signature_hash(strokes),
        strokes=rounded,
        label=label,
        status=status,
        seen_count=0,
        desc=describe(rounded),
    )


class Matcher:
    """Nearest library entry within the fixed tolerances (Chamfer and Hausdorff)."""

    def __init__(self, entries: list[Entry] | None = None):
        self.entries: list[Entry] = []
        self._points = np.empty((0, N_POINTS, 2))
        self._extent = np.empty((0, 2))
        self._cache: dict[tuple, int | None] = {}
        for e in entries or []:
            self.add(e)

    def add(self, entry: Entry) -> int:
        self.entries.append(entry)
        self._points = np.concatenate([self._points, entry.desc.points[None]], axis=0)
        self._extent = np.concatenate([self._extent, np.array([entry.desc.extent])], axis=0)
        return len(self.entries) - 1

    def match(self, desc: Descriptor) -> int | None:
        """Index of the nearest entry within tolerance, or None."""
        if desc.key in self._cache:
            return self._cache[desc.key]
        found: int | None = None
        if self.entries:
            ext = np.array(desc.extent)
            # Hausdorff <= tol implies the normalised extents differ by at most tol, so this
            # pre-filter drops only entries that could not match anyway.
            cand = np.where((np.abs(self._extent - ext) <= HAUSDORFF_TOL).all(1))[0]
            if len(cand):
                chamfer, haus = distances(self._points[cand], desc.points)
                ok = (chamfer <= CHAMFER_TOL) & (haus <= HAUSDORFF_TOL)
                if ok.any():
                    found = int(cand[np.where(ok)[0][np.argmin(chamfer[ok])]])
        self._cache[desc.key] = found
        return found


def load_entries(conn: psycopg.Connection, font_id: str) -> list[Entry]:
    rows = conn.execute(
        "SELECT id, signature_hash, strokes, label, status, seen_count FROM glyph_library"
        " WHERE font_id = %s ORDER BY created_at, signature_hash",
        (font_id,),
    ).fetchall()
    out = []
    for r in rows:
        strokes = [[(x, y) for x, y in s] for s in r["strokes"]]
        out.append(
            Entry(
                id=str(r["id"]),
                font_id=font_id,
                signature_hash=r["signature_hash"],
                strokes=strokes,
                label=r["label"],
                status=r["status"],
                seen_count=r["seen_count"],
                desc=describe(strokes),
            )
        )
    return out


def record_usage(
    conn: psycopg.Connection,
    font_id: str,
    entries_by_hash: dict[str, Entry],
    counts: dict[str, int],
) -> None:
    """Insert unseen shapes as `proposed` and add to seen_count. Labels and status are untouched."""
    with conn.cursor() as cur:
        for h, n in sorted(counts.items()):
            e = entries_by_hash[h]
            cur.execute(
                "INSERT INTO glyph_library (font_id, signature_hash, strokes, seen_count)"
                " VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (font_id, signature_hash)"
                " DO UPDATE SET seen_count = glyph_library.seen_count + EXCLUDED.seen_count",
                (font_id, h, Jsonb([[list(p) for p in s] for s in e.strokes]), n),
            )
    conn.commit()
