"""The 14g regression harness helpers (Review 3, item 8): scratch caches and the no-symbols skip."""

from pathlib import Path

import pytest

from measure import p14g_regress as h
from src.config import load_config


def test_scratch_uploads_links_everything_but_the_cache(tmp_path: Path) -> None:
    real = tmp_path / "uploads"
    (real / "proj1").mkdir(parents=True)
    (real / "proj1" / "a.pdf").write_bytes(b"%PDF")
    (real / "cache" / "page_ink").mkdir(parents=True)
    (real / "cache" / "page_ink" / "keep.npz").write_bytes(b"real cache")
    scratch = h.scratch_uploads(real, tmp_path / "work" / "scratch")
    # the PDFs are reachable through the links, so the job can read them
    assert (scratch / "proj1" / "a.pdf").read_bytes() == b"%PDF"
    # the cache is scratch's own and empty: a cache the job writes or deletes is never the app's
    assert (scratch / "cache" / "page_ink").is_dir()
    assert list((scratch / "cache" / "page_ink").iterdir()) == []
    assert not (scratch / "cache").is_symlink()
    (scratch / "cache" / "page_ink" / "new.npz").write_bytes(b"x")
    assert sorted(p.name for p in (real / "cache" / "page_ink").iterdir()) == ["keep.npz"]
    # a second call changes nothing
    h.scratch_uploads(real, tmp_path / "work" / "scratch")
    assert (scratch / "cache" / "page_ink" / "new.npz").exists()


def test_a_click_whose_page_has_no_stored_symbols_is_a_skip_not_a_crash(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import src.build.similar_job as job

    def refuse(conn, job_, cfg):  # noqa: ANN001
        raise ValueError("the page's symbols are not stored: build the page first")

    monkeypatch.setattr(job, "run_find_similar", refuse)
    items = [
        {
            "sheet_id": "00000000-0000-0000-0000-000000000001",
            "build_run_id": "00000000-0000-0000-0000-000000000002",
            "click": [1.0, 2.0],
            "label": "click 1",
        }
    ]
    out = h.run_items(load_config().database_url, tmp_path, items, regenerate=True)
    assert out == [{"found": None, "skipped": "the page's symbols are not stored"}]
    # any other refusal is a real error, not hidden
    monkeypatch.setattr(job, "run_find_similar", lambda *a: (_ for _ in ()).throw(ValueError("x")))
    with pytest.raises(ValueError, match="x"):
        h.run_items(load_config().database_url, tmp_path, items, regenerate=True)


def test_a_missing_cache_is_a_skip_only_without_regeneration(tmp_path: Path) -> None:
    items = [
        {
            "sheet_id": "00000000-0000-0000-0000-000000000001",
            "build_run_id": "00000000-0000-0000-0000-000000000002",
            "click": [1.0, 2.0],
            "label": "click 1",
        }
    ]
    out = h.run_items(load_config().database_url, tmp_path, items, regenerate=False)
    assert out[0]["found"] is None and "no page-ink cache" in out[0]["skipped"]


def test_compare_keeps_skipped_clicks_apart() -> None:
    items = [{"label": "a"}, {"label": "b"}]
    ok = {"found": True, "real_in": [1, 2], "source": "ink", "warning": None, "n06": 1, "n08": 1}
    res = h.compare(items, [ok, {"found": None, "skipped": "x"}], [ok, ok])
    assert res["clicks"] == 2 and res["skipped"] == 1 and res["regressions"] == []
