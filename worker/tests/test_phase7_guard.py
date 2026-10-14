"""The held-out guard of the Phase 7 driver (no drawings: git and the lock file are replaced)."""

from __future__ import annotations

import pytest

from tools.takeoff import phase7_cgrammar_run as R


def _fake_git(tag_exists: bool, changed: str):
    def git(*args: str) -> str:
        if args[0] == "rev-parse":
            return "abc123" if tag_exists else ""
        if args[0] == "diff":
            return changed
        return ""

    return git


def test_refuses_without_the_tag(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "git", _fake_git(False, ""))
    monkeypatch.setattr(R, "LOCK", tmp_path / "lock")
    with pytest.raises(SystemExit, match="tag"):
        R.check_heldout_allowed()


def test_refuses_when_a_grammar_file_changed_since_the_tag(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "git", _fake_git(True, "worker/tools/takeoff/phase7_grammar.py"))
    monkeypatch.setattr(R, "LOCK", tmp_path / "lock")
    with pytest.raises(SystemExit, match="changed"):
        R.check_heldout_allowed()


def test_refuses_a_second_run_and_allows_the_first(monkeypatch, tmp_path):
    lock = tmp_path / "lock"
    monkeypatch.setattr(R, "git", _fake_git(True, ""))
    monkeypatch.setattr(R, "LOCK", lock)
    R.check_heldout_allowed()  # first run: allowed
    lock.write_text("{}")
    with pytest.raises(SystemExit, match="already"):
        R.check_heldout_allowed()


def test_the_overlay_of_the_held_out_side_waits_for_the_run(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "LOCK", tmp_path / "missing")
    with pytest.raises(SystemExit, match="after the single"):
        R.cmd_overlays("held-out")


def test_frozen_files_exist():
    for f in R.FROZEN_FILES:
        assert (R.ROOT / f).exists(), f
