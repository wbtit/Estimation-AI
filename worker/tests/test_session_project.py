"""Session project hash check on SYNTHETIC hashes and a synthetic lock file."""

from __future__ import annotations

import json
from pathlib import Path

from tools.session_project import check, lock_hashes, sha256

A, B, C = "a" * 64, "b" * 64, "c" * 64


def test_lock_hashes_cover_drawings_and_markups(tmp_path: Path) -> None:
    lock = tmp_path / "test.lock"
    lock.write_text(json.dumps({"jobs": {"job-900": {"drawing_sha256": A, "markup_sha256": B}}}))
    assert lock_hashes(lock) == {A: "job-900", B: "job-900"}


def test_a_heldout_pdf_is_refused_for_every_purpose() -> None:
    for purpose in ("real", "demo"):
        res = check(A, purpose, {A: "job-900"}, {}, {})
        assert res["refused"] and "held-out TEST job job-900" in res["why"]


def test_a_known_pdf_is_refused_for_a_real_session_but_allowed_for_a_demo() -> None:
    projects = {B: ["p2", "p1"]}
    real = check(B, "real", {}, {C: "takeoff register"}, projects)
    assert real["refused"] and real["existing_projects"] == ["p1", "p2"]
    assert not check(B, "demo", {}, {}, projects)["refused"]
    assert check(C, "real", {}, {C: "takeoff register"}, {})["refused"]
    assert check("d" * 64, "real", {A: "job-900"}, {C: "x"}, projects) == {
        "heldout_lock": None,
        "registers": None,
        "existing_projects": [],
        "refused": False,
        "why": [],
    }


def test_sha256_of_a_file(tmp_path: Path) -> None:
    f = tmp_path / "x.bin"
    f.write_bytes(b"abc")
    assert sha256(f) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_a_new_session_project_is_scanned_and_suggested_but_not_built(dbp) -> None:
    import pymupdf
    from build_factory import framing_plan, grids

    from tools.session_project import create

    doc = pymupdf.open()
    grids(doc.new_page(width=1000, height=800))
    framing_plan(doc)
    pdf = dbp.pdf_path.parent / "synthetic.pdf"
    pdf.write_bytes(doc.tobytes())
    out = create(dbp.conn, dbp.config, pdf, "synthetic-session-test", "demo", sha256(pdf))
    try:
        assert [j["type"] for j in out["jobs"]][:2] == ["scan_pdf", "auto_run"]
        assert "auto_build" in [j["type"] for j in out["jobs"]]
        after = out["after"]
        assert after["pages"] == 2
        assert after["build_runs"] == after["members"] == after["snapshots"] == 0
        assert after["actions"] == after["edits"] == 0
        row = dbp.conn.execute(
            "SELECT p.purpose, p.archived, f.original_filename FROM projects p"
            " JOIN project_files f ON f.project_id = p.id WHERE p.id = %s",
            (out["project_id"],),
        ).fetchone()
        assert row == {"purpose": "demo", "archived": False, "original_filename": "drawings.pdf"}
    finally:
        dbp.conn.rollback()
        dbp.conn.execute("DELETE FROM projects WHERE id = %s", (out["project_id"],))
        dbp.conn.commit()
