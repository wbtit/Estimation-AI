"""Load shape names for profile validation from `catalog_shapes` (read-only)."""

import psycopg

from src.text_layer.parsers.profile import CatalogMatcher


def load_catalog(
    conn: psycopg.Connection, edition: str | None = None
) -> tuple[CatalogMatcher, str | None]:
    """(matcher, note). With no edition given, a catalog is used only if exactly one is loaded.

    The note says why no catalog is in use ("catalog_not_loaded", "catalog_edition_not_specified"
    or "catalog_edition_not_found") and is None when one is.
    """
    editions = [r["edition"] for r in conn.execute("SELECT DISTINCT edition FROM catalog_shapes")]
    if not editions:
        return CatalogMatcher(None), "catalog_not_loaded"
    if edition is None:
        if len(editions) > 1:
            return CatalogMatcher(None), "catalog_edition_not_specified"
        edition = editions[0]
    if edition not in editions:
        return CatalogMatcher(None), "catalog_edition_not_found"
    names = [
        r["shape_name"]
        for r in conn.execute(
            "SELECT shape_name FROM catalog_shapes WHERE edition = %s", (edition,)
        )
    ]
    return CatalogMatcher(names), None
