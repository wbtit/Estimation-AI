"""The held-out TEST lock in the shared loaders, on SYNTHETIC folders only (measure/jobs.py)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import measure.jobs as jobs
import measure.takeoff.common as common
from measure.takeoff.inventory import merge_inventory

WORKER = Path(__file__).resolve().parents[1]
TOOL_DIRS = (WORKER / "measure", WORKER / "tools")
LOCKED_JOBS = [f"job-{n:03d}" for n in range(36, 50)]
LOCKED_TAKEOFFS = [f"takeoff-{n:02d}.pdf" for n in range(23, 37)]
# job-041 (takeoff-28) was released by the owner on 2026-11-06 (measure/jobs.py RELEASED). The
# synthetic lock below still lists all 14, like an old copy: the 13 others stay locked
STILL_LOCKED = [j for j in LOCKED_JOBS if j != "job-041"]
STILL_LOCKED_TAKEOFFS = [t for t in LOCKED_TAKEOFFS if t != "takeoff-28.pdf"]


@pytest.fixture
def private(tmp_path, monkeypatch):
    """A private folder with two dev jobs and the 14 locked jobs, and the lock."""
    priv, take, marks = (
        tmp_path / "private",
        tmp_path / "private" / "takeoffs",
        tmp_path / "markups",
    )
    for d in (take, marks, priv / "set"):
        d.mkdir(parents=True, exist_ok=True)
    rows = ["id, item, relative_path, status, duplicate_of_job, moved_to"]
    inv = {}
    for job, takeoff in [("job-002", "takeoff-01.pdf"), ("job-003", "takeoff-02.pdf")]:
        (priv / "set" / f"{job}.pdf").write_bytes(b"%PDF")
        rows.append(f"{job}, set-A, set/{job}.pdf, kept, , ")
        (take / takeoff).write_bytes(b"%PDF")
        inv[takeoff] = {"match": job, "page_map": {"0": 0}}
    lock = {}
    for job, takeoff in zip(LOCKED_JOBS, LOCKED_TAKEOFFS, strict=True):
        (priv / "markups").mkdir(exist_ok=True)
        (priv / "markups" / f"{job}.pdf").write_bytes(b"%PDF")
        rows.append(f"{job}, set-C, markups/{job}.pdf, kept, , ")
        (take / takeoff).write_bytes(b"%PDF")
        inv[takeoff] = {"match": job, "page_map": {"0": 0}, "intake": "phase12e"}
        lock[job] = {"markup": f"takeoffs/{takeoff}"}
    inv["takeoff-90.pdf"] = {"match": "job-036", "page_map": {}}  # locked by its match only
    (priv / "inventory_map.csv").write_text("\r\n".join(rows) + "\r\n")
    (take / "inventory.json").write_text(json.dumps(inv))
    (marks / "heldout_test.lock").write_text(json.dumps({"jobs": lock}))
    (marks / "MAPPING.json").write_text("{}")
    monkeypatch.setattr(common, "PRIVATE", priv)
    monkeypatch.setattr(common, "TAKEOFFS", take)
    monkeypatch.setattr(jobs, "LOCK", marks / "heldout_test.lock")
    monkeypatch.setattr(jobs, "MAPPING", marks / "MAPPING.json")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "no-home")
    return priv


def test_default_loaders_never_return_the_locked_jobs(private):
    # the released job-041 is a dev job now
    assert sorted(common.drawing_documents()) == ["job-002", "job-003", "job-041"]
    assert [p.name for p in common.takeoff_files()] == [
        "takeoff-01.pdf",
        "takeoff-02.pdf",
        "takeoff-28.pdf",
    ]
    assert sorted(common.takeoff_inventory()) == [
        "takeoff-01.pdf",
        "takeoff-02.pdf",
        "takeoff-28.pdf",
    ]
    assert jobs.dev_jobs(["job-002", "job-040", "takeoff-30.pdf", "takeoff-02.pdf"]) == [
        "job-002",
        "takeoff-02.pdf",
    ]


def test_the_flag_returns_them(private):
    assert set(LOCKED_JOBS) <= set(common.drawing_documents(include_test=True))
    names = {p.name for p in common.takeoff_files(include_test=True)}
    assert set(LOCKED_TAKEOFFS) <= names
    inv = common.takeoff_inventory(include_test=True)
    assert set(LOCKED_TAKEOFFS) | {"takeoff-90.pdf"} <= set(inv)


def test_include_test_needs_an_existing_prereg_and_warns(private, tmp_path, capsys):
    assert jobs.include_test_from_argv(["tool"]) is False
    with pytest.raises(SystemExit):
        jobs.include_test_from_argv(["tool", "--include-test"])
    with pytest.raises(SystemExit):
        jobs.include_test_from_argv(["tool", "--include-test", "--prereg", str(tmp_path / "x.md")])
    doc = tmp_path / "prereg.md"
    doc.write_text("pre-registered measures")
    assert jobs.include_test_from_argv(["tool", "--include-test", "--prereg", str(doc)]) is True
    err = capsys.readouterr().err
    assert "LOCKED HELD-OUT TEST JOBS INCLUDED (13)" in err and "job-036" in err
    assert "job-041" not in err
    assert jobs.strip_test_flags(["a", "--include-test", "--prereg", "p.md", "job-002"]) == [
        "a",
        "job-002",
    ]


def test_an_intake_without_its_lock_stops(private, monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "LOCK", tmp_path / "missing.lock")
    with pytest.raises(SystemExit):
        common.drawing_documents()
    monkeypatch.setattr(jobs, "MAPPING", tmp_path / "missing.json")
    assert jobs.test_jobs().jobs == frozenset()


def test_inventory_regeneration_keeps_the_locked_entries(private):
    old = json.loads((private / "takeoffs" / "inventory.json").read_text())
    dev = {
        "takeoff-01.pdf": {"match": "job-002", "page_map": {"0": 0, "1": 1}},  # recomputed
        "takeoff-23.pdf": {"match": None, "page_map": {}},  # a locked name must not be rewritten
    }
    merged = merge_inventory(dev, old, jobs.test_jobs())
    for name in [*STILL_LOCKED_TAKEOFFS, "takeoff-90.pdf"]:
        assert merged[name] == old[name]
    assert merged["takeoff-01.pdf"] == dev["takeoff-01.pdf"]
    assert "takeoff-02.pdf" not in merged  # a dev entry not regenerated is dropped (as before)


def test_no_tool_reads_the_inventory_around_the_loader():
    allowed = {
        "measure/takeoff/common.py",
        "measure/takeoff/inventory.py",
        "tools/markups_intake.py",
    }
    direct = sorted(
        str(p.relative_to(WORKER))
        for d in TOOL_DIRS
        for p in d.rglob("*.py")
        if "inventory.json" in p.read_text() and str(p.relative_to(WORKER)) not in allowed
    )
    assert direct == []
    prefix = WORKER / "measure" / "takeoff" / "prefix_inventory.py"
    assert "include_test_from_argv(sys.argv)" in prefix.read_text()


def test_a_released_job_is_never_locked_even_if_a_lock_lists_it(private):
    # job-041: released by the owner on 2026-11-06 (estimator trial); a lock that still lists it
    # (e.g. an old copy) does not lock it again
    assert "job-041" in jobs.RELEASED
    lk = jobs.test_jobs()
    assert "job-041" not in lk.jobs and "takeoff-28.pdf" not in lk.takeoffs
    assert sorted(lk.jobs) == STILL_LOCKED
    assert jobs.dev_jobs(["job-041", "job-040", "takeoff-28.pdf"]) == ["job-041", "takeoff-28.pdf"]


def test_the_real_lock_has_13_jobs_without_job_041():
    # the private lock itself (skipped where the private folder is absent)
    real = jobs.ROOT / "fixtures" / "private" / "markups" / "heldout_test.lock"
    if not real.exists():
        pytest.skip("no private lock here")
    locked = json.loads(real.read_text())["jobs"]
    assert len(locked) == 13
    assert "job-041" not in locked
    assert jobs.test_jobs().jobs == frozenset(locked)
