"""Duplicate handling for input PDFs, on synthetic files in a temp directory."""

import csv
import sys
from pathlib import Path

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import dedupe_inputs as dd  # noqa: E402


def make_pdf(path: Path, text: str, pages: int = 1) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page().insert_text((50, 100), text)
    doc.save(str(path))
    doc.close()
    return path.read_bytes()


def build(tmp_path: Path):
    a, b = tmp_path / "SetA", tmp_path / "SetB"
    private = tmp_path / "private"
    private.mkdir()
    make_pdf(a / "sub" / "alpha one.pdf", "ALPHA")
    data = (a / "sub" / "alpha one.pdf").read_bytes()
    (b / "alpha copy.pdf").parent.mkdir(parents=True)
    (b / "alpha copy.pdf").write_bytes(data)  # byte-identical to the first
    make_pdf(a / "beta.pdf", "BETA")
    (private / "job-001.pdf").write_bytes((a / "beta.pdf").read_bytes())  # preferred external copy
    (b / "beta again.pdf").write_bytes((a / "beta.pdf").read_bytes())
    make_pdf(a / "gamma v1.pdf", "GAMMA ONE")
    make_pdf(b / "gamma v2.pdf", "GAMMA TWO")  # looks the same to the inventory, bytes differ
    make_pdf(b / "delta.pdf", "DELTA")
    files = [
        ("job-002", "set-A", "SetA/sub/alpha one.pdf"),
        ("job-003", "set-B", "SetB/alpha copy.pdf"),
        ("job-004", "set-A", "SetA/beta.pdf"),
        ("job-005", "set-B", "SetB/beta again.pdf"),
        ("job-006", "set-A", "SetA/gamma v1.pdf"),
        ("job-007", "set-B", "SetB/gamma v2.pdf"),
        ("job-008", "set-B", "SetB/delta.pdf"),
    ]
    roots = {"set-A": tmp_path, "set-B": tmp_path}
    map_path = tmp_path / "map.csv"
    with map_path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "item", "relative_path"])
        w.writerows(files)
    inv = tmp_path / "inventory.csv"
    with inv.open("w", newline="") as fh:
        w = csv.DictWriter(
            fh, fieldnames=["id", "error", "producer_category", *dd.SIGNATURE_FIELDS]
        )
        w.writeheader()
        for jid, _, rel in files:
            same = "gamma" in rel
            w.writerow(
                {
                    "id": jid, "error": "", "producer_category": "other", "pages": "1",
                    "page_size_class": "large", "text_pages": "1", "median_chars_per_page": "10",
                    "circles": "5" if same else str(len(rel)), "labelled_circles": "1",
                    "exploded_dash_segments": "0", "ocg_layers": "0",
                }
            )  # fmt: skip
    return roots, map_path, inv, private


def run(tmp_path: Path, roots, map_path, inv, private, dry: bool = False) -> int:
    sys.argv = ["x"]
    for label, root in roots.items():
        sys.argv += ["--item", f"{label}={root}"]
    sys.argv += [
        "--map", str(map_path), "--inventory", str(inv), "--prefer-dir", str(private),
        "--moved-to", str(tmp_path / "removed"), "--estimator-csv", str(tmp_path / "list.csv"),
    ]  # fmt: skip
    if dry:
        sys.argv.append("--dry-run")
    return dd.main()


def test_groups_keep_one_move_the_rest_and_never_delete(tmp_path: Path) -> None:
    roots, map_path, inv, private = build(tmp_path)
    before = {p.name: p.read_bytes() for p in tmp_path.rglob("*.pdf")}
    assert run(tmp_path, roots, map_path, inv, private) == 0
    rows = {r["id"]: r for r in csv.DictReader(map_path.open(newline=""))}
    # alpha: first by full path is kept (SetA sorts before SetB), the other is moved
    assert (rows["job-002"]["status"], rows["job-003"]["status"]) == ("kept", "moved")
    assert rows["job-003"]["duplicate_of_job"] == "job-002"
    # beta: the copy in the preferred directory is the one kept, so both item copies move
    assert (rows["job-004"]["status"], rows["job-005"]["status"]) == ("moved", "moved")
    assert rows["job-004"]["duplicate_of_job"] == "job-001"
    # gamma: same inventory signature, different bytes: flagged, not moved
    assert (rows["job-006"]["status"], rows["job-007"]["status"]) == (
        "near-duplicate",
        "near-duplicate",
    )
    assert rows["job-008"]["status"] == "kept"
    # structure preserved, nothing deleted, contents unchanged
    removed = tmp_path / "removed"
    assert (removed / "SetB" / "alpha copy.pdf").is_file()
    assert (removed / "SetA" / "beta.pdf").is_file() and (
        removed / "SetB" / "beta again.pdf"
    ).is_file()
    assert not (tmp_path / "SetB" / "alpha copy.pdf").exists()
    assert (private / "job-001.pdf").is_file()  # the preferred copy is never touched
    after = {p.name: p.read_bytes() for p in tmp_path.rglob("*.pdf")}
    assert after == before
    assert (
        rows["job-003"]["moved_to"] == "SetB/alpha copy.pdf" and rows["job-002"]["moved_to"] == ""
    )


def test_estimator_list_has_one_row_per_kept_file(tmp_path: Path) -> None:
    roots, map_path, inv, private = build(tmp_path)
    run(tmp_path, roots, map_path, inv, private)
    rows = list(csv.DictReader((tmp_path / "list.csv").open(newline="")))
    assert [r["job_id"] for r in rows] == ["job-001", "job-002", "job-006", "job-007", "job-008"]
    by = {r["job_id"]: r for r in rows}
    assert by["job-002"]["duplicates_of"] == "alpha copy.pdf"
    assert by["job-001"]["file_name"] == "job-001.pdf"
    assert set(by["job-001"]["duplicates_of"].split("; ")) == {"beta.pdf", "beta again.pdf"}
    assert by["job-006"]["near_duplicate_of"] == "gamma v2.pdf"
    assert by["job-007"]["near_duplicate_of"] == "gamma v1.pdf"
    assert by["job-008"]["duplicates_of"] == "" and by["job-008"]["near_duplicate_of"] == ""
    assert all(r["takeoff_file"] == r["pricing_file"] == r["notes"] == "" for r in rows)
    assert by["job-002"]["pages"] == "1" and by["job-002"]["size_mb"] != ""
    assert list(rows[0].keys()) == dd.ESTIMATOR_FIELDS


def test_dry_run_changes_nothing_and_stdout_has_counts_not_names(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    roots, map_path, inv, private = build(tmp_path)
    before = sorted(str(p) for p in tmp_path.rglob("*.pdf"))
    map_before = map_path.read_text()
    run(tmp_path, roots, map_path, inv, private, dry=True)
    assert sorted(str(p) for p in tmp_path.rglob("*.pdf")) == before
    assert map_path.read_text() == map_before and not (tmp_path / "list.csv").exists()
    out = capsys.readouterr().out
    assert "moved: 3" in out and "near-duplicate: 2" in out
    assert "alpha" not in out and "gamma" not in out and "beta" not in out


def test_a_second_run_finds_nothing_left_to_move(tmp_path: Path) -> None:
    roots, map_path, inv, private = build(tmp_path)
    run(tmp_path, roots, map_path, inv, private)
    # the moved files are gone from their folders; a re-run must not crash on the map
    with pytest.raises(FileNotFoundError):
        run(tmp_path, roots, map_path, inv, private)


def test_plan_prefers_the_external_copy_and_otherwise_the_first_path() -> None:
    entries = [
        {"id": "b", "path": Path("/x/b.pdf"), "sha": "1"},
        {"id": "a", "path": Path("/x/a.pdf"), "sha": "1"},
        {"id": "c", "path": Path("/x/c.pdf"), "sha": "2"},
    ]
    status, moved = dd.plan(entries, {})
    assert (
        status["a"]["status"] == "kept"
        and status["b"]["status"] == "moved"
        and moved == {"a": ["b"]}
    )
    status, moved = dd.plan(entries, {"1": "job-001"})
    assert status["a"]["status"] == status["b"]["status"] == "moved" and moved == {
        "job-001": ["a", "b"]
    }
    assert status["c"]["status"] == "kept"
