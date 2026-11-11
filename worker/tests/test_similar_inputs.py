"""Phase 0 column capture: Find similar's inputs on ANY built page (SYNTHETIC lookups, no database).

A column plan stores column symbols, a crop, grid lines and an ink cache; a framing build stores
no symbols and no cache. The job resolves what it needs from the run, the view's latest finished
run, the view and the page, and says no_scale when there is no scale at all."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.build.col_image import cache_path
from src.build.similar_job import clean_stale_cache, resolve_inputs
from src.config import WorkerConfig

CROP = {"x0": 10.0, "y0": 20.0, "x1": 500.0, "y1": 400.0}
VIEW_BOX = {"x0": 0.0, "y0": 0.0, "x1": 900.0, "y1": 700.0}


class Cur:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


class Conn:
    """Answers the lookups by the table named in the SQL."""

    def __init__(self, sym=None, run=None, latest=None, view=None, sheet=None, grids=(), runs=()):
        self.t = {"page_symbols": sym, "latest": latest, "build_views": view, "sheets": sheet}
        self.run, self.grids, self.runs = run, list(grids), list(runs)

    def execute(self, sql: str, params=()):
        if "FROM page_symbols" in sql:
            return Cur([self.t["page_symbols"]] if self.t["page_symbols"] else [])
        if "status = 'done'" in sql:
            return Cur([self.t["latest"]] if self.t["latest"] else [])
        if "FROM build_runs WHERE id = %s" in sql:
            return Cur([self.run] if self.run else [])
        if "FROM build_views" in sql:
            return Cur([self.t["build_views"]] if self.t["build_views"] else [])
        if "FROM sheets" in sql:
            return Cur([self.t["sheets"]] if self.t["sheets"] else [])
        if "FROM grid_lines" in sql:
            return Cur(self.grids)
        if "FROM build_runs WHERE sheet_id" in sql:
            return Cur([{"id": r} for r in self.runs])
        raise AssertionError(sql)


SHEET = {"width_pt": 3024, "height_pt": 2160, "build_scale_ratio": None,
         "scale_parsed_ratio": None, "scale_override_ratio": None}  # fmt: skip


def test_a_column_plan_uses_its_own_symbols_crop_and_cache():
    sym = {"symbols": [{"family": "w_shape"}], "ratio": 192.0, "rules": "five_families"}
    c = Conn(sym=sym, run={"inputs": {"crop": CROP}, "view_id": "v"}, sheet=SHEET)
    r = resolve_inputs(c, "s", "run1")
    assert r["symbols_stored"] and r["symbols"] == [{"family": "w_shape"}]
    assert (
        r["cache_run"] == "run1" and r["box"] == (10.0, 20.0, 500.0, 400.0) and r["ratio"] == 192.0
    )


def test_a_framing_page_has_no_symbols_and_uses_the_views_latest_run():
    run = {"inputs": {}, "view_id": "v"}  # a person's run: no crop
    latest = {"id": "run9", "inputs": {"crop": CROP}}
    grids = [{"x0": 0, "y0": 5, "x1": 100, "y1": 5}]
    c = Conn(
        run=run, latest=latest, view={"box": VIEW_BOX, "scale_ratio": 128}, sheet=SHEET, grids=grids
    )
    r = resolve_inputs(c, "s", "run1")
    assert not r["symbols_stored"] and r["symbols"] == []
    assert r["cache_run"] == "run9" and r["crop_source"] == "the view's latest finished run"
    assert r["ratio"] == 128.0 and r["ratio_source"] == "the view" and len(r["grid"]) == 1


def test_no_run_crop_falls_back_to_the_views_box_then_the_whole_page():
    c = Conn(
        run={"inputs": {}, "view_id": None}, view={"box": VIEW_BOX, "scale_ratio": 96}, sheet=SHEET
    )
    r = resolve_inputs(c, "s", "run1")
    assert r["crop_source"] == "the view's box" and r["box"] == (0.0, 0.0, 900.0, 700.0)
    c = Conn(
        run={"inputs": {}, "view_id": None}, view={"box": None, "scale_ratio": 96}, sheet=SHEET
    )
    r = resolve_inputs(c, "s", "run1")
    assert r["crop_source"] == "the whole page" and r["box"] == (0.0, 0.0, 3024.0, 2160.0)


def test_the_scale_comes_from_the_page_when_the_view_has_none_and_no_scale_says_so():
    sheet = {**SHEET, "scale_parsed_ratio": 128}
    c = Conn(
        run={"inputs": {"crop": CROP}, "view_id": None},
        view={"box": None, "scale_ratio": None},
        sheet=sheet,
    )
    assert resolve_inputs(c, "s", "r")["ratio"] == 128.0
    c = Conn(
        run={"inputs": {"crop": CROP}, "view_id": None},
        view={"box": None, "scale_ratio": None},
        sheet=SHEET,
    )
    with pytest.raises(ValueError, match="^no_scale"):
        resolve_inputs(c, "s", "r")


def test_stale_cache_cleanup_removes_only_the_apps_own_files_of_that_view(tmp_path: Path):
    cfg = WorkerConfig("x", 2.0, 600.0, "w", tmp_path)
    for rid in ("old1", "old2", "keep", "latest"):
        p = cache_path(tmp_path, rid)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    other = tmp_path / "cache" / "page_ink" / "somebody-elses.npz"  # not a run of this view
    other.write_bytes(b"x")
    stray = tmp_path / "keep-me.txt"
    stray.write_bytes(b"x")
    c = Conn(runs=["old1", "old2", "old3", "keep", "latest"])  # old3 has no file
    removed = clean_stale_cache(c, cfg, "s", {"keep", "latest"}, "v")
    assert sorted(removed) == ["old1.npz", "old2.npz"]
    # the cache just written AND the view's latest run's cache stay (an older run's click never
    # deletes the newer Build's cache); other files are never touched
    for kept in (cache_path(tmp_path, "keep"), cache_path(tmp_path, "latest"), other, stray):
        assert kept.exists()
