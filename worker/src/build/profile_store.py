"""Storage of the page labels of a view (table page_labels, migration 038).

Written by every Build of a view and by the `read_labels` job. A re-read keeps a label's row (same
place and profile), so the members linked to it keep their link; rows that are gone are deleted.
"""

from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from src.build.profile_labels import CatalogIndex, PageLabel, read_page_labels
from src.build.segments import TextLine

Key = tuple[float, float, float, float, str]


def label_key(box: tuple[float, float, float, float], canonical: str | None, raw: str) -> Key:
    x0, y0, x1, y1 = (round(float(v), 2) for v in box)
    return (x0, y0, x1, y1, canonical or raw)


def store_labels(
    conn,
    sheet_id: str,
    view_id: str,
    text: list[TextLine],
    segments: list[tuple[float, float, float, float]],
    total_text_lines: int | None = None,
    catalog: CatalogIndex | None = None,
) -> tuple[list[PageLabel], dict[Key, str]]:
    """Read and store the labels of `text` (the view's text lines). Returns the labels (with their
    row ids) and a key -> id map."""
    catalog = catalog or CatalogIndex(conn)
    labels = read_page_labels(text, segments, catalog)
    have = {
        label_key((r["x0"], r["y0"], r["x1"], r["y1"]), r["canonical"], r["raw"]): str(r["id"])
        for r in conn.execute(
            "SELECT id, x0, y0, x1, y1, canonical, raw FROM page_labels"
            " WHERE sheet_id = %s AND view_id = %s",
            (sheet_id, view_id),
        )
    }
    ids: dict[Key, str] = {}
    for lb in labels:
        k = label_key(lb.box, lb.canonical, lb.raw)
        row: dict[str, Any] = {
            "text": lb.text, "raw": lb.raw, "canonical": lb.canonical, "family": lb.family,
            "kind": lb.kind, "valid": lb.valid, "catalog_name": lb.catalog_name,
            "flags": list(lb.flags), "tag": lb.tag, "leaders": Jsonb(lb.leaders),
        }  # fmt: skip
        if k in have:
            conn.execute(
                "UPDATE page_labels SET text = %s, family = %s, kind = %s, valid = %s,"
                " catalog_name = %s, flags = %s, tag = %s, leaders = %s WHERE id = %s",
                (row["text"], row["family"], row["kind"], row["valid"], row["catalog_name"],
                 row["flags"], row["tag"], row["leaders"], have[k]),
            )  # fmt: skip
            lb.id = ids[k] = have[k]
        elif k in ids:
            lb.id = ids[k]  # the same text twice at the same place
        else:
            got = conn.execute(
                "INSERT INTO page_labels (sheet_id, view_id, text, raw, canonical, family, kind,"
                " valid, catalog_name, flags, tag, x0, y0, x1, y1, leaders)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " RETURNING id",
                (sheet_id, view_id, row["text"], row["raw"], row["canonical"], row["family"],
                 row["kind"], row["valid"], row["catalog_name"], row["flags"], row["tag"],
                 *k[:4], row["leaders"]),
            ).fetchone()  # fmt: skip
            lb.id = ids[k] = str(got["id"])
    gone = [i for k, i in have.items() if k not in ids]
    if gone:
        conn.execute("DELETE FROM page_labels WHERE id = ANY(%s::uuid[])", (gone,))
    n = len(text) if total_text_lines is None else total_text_lines
    conn.execute(
        "UPDATE sheets SET labels_read_at = now(),"
        " labels_text_lines = GREATEST(COALESCE(labels_text_lines, 0), %s) WHERE id = %s",
        (n, sheet_id),
    )
    return labels, ids
