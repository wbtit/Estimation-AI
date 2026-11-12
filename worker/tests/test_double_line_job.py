"""Double-line beams through the build_sheet and learn_style jobs on the (test) Postgres.

SYNTHETIC PDFs only. A beam drawn as two thin flange lines with a dashed centreline; ratio 96 so a
W8x18 flange (bf 5.25 in) is a 3.94 pt gap.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pymupdf
import pytest
from build_factory import line
from db_fixtures import DbProject
from psycopg.types.json import Jsonb
from test_build_job import _members, _run, _setup, set_pens

from src.build.learn_style_job import run_learn_style
from src.queue import Job
from src.text_reader.job import read_project

THIN_PEN = "0.25-0.5|black|solid"
GAP = 3.94


@pytest.fixture
def edition(dbp: DbProject, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    name = f"TEST-ED-{uuid.uuid4()}"
    for shape, family, bf in [("W8X18", "W", 5.25), ("W12X26", "W", 6.49), ("L3X3X0.25", "L", "–")]:
        dbp.conn.execute(
            "INSERT INTO catalog_shapes (edition, shape_name, family, weight_kg_per_m, properties)"
            " VALUES (%s, %s, %s, 10, %s)",
            (name, shape, family, Jsonb({"bf": bf})),
        )
    dbp.conn.commit()
    monkeypatch.setenv("CATALOG_EDITION", name)
    yield name
    dbp.conn.execute("DELETE FROM catalog_shapes WHERE edition = %s", (name,))
    dbp.conn.commit()


def _beam(page, y: float, label: str, gap: float = GAP, x0=200.0, x1=500.0) -> None:
    line(page, (x0, y), (x1, y), 0.4)
    line(page, (x0, y + gap), (x1, y + gap), 0.4)
    line(page, (x0, y + gap / 2), (x1, y + gap / 2), 0.2, dashes="[8 4] 0")
    page.insert_text((x0 + 80, y - 6), label, fontsize=8)


def _make(dbp: DbProject, beams: list[tuple[float, str, float]]) -> str:
    doc = pymupdf.open()
    page = doc.new_page(width=1000, height=800)
    page.insert_text((60, 760), "FRAMING PLAN NOTES AND GENERAL INFORMATION", fontsize=10)
    for y, label, gap in beams:
        _beam(page, y, label, gap)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    sid = str(
        dbp.conn.execute(
            "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        ).fetchone()["id"]
    )
    _setup(dbp, sid, "framing", pen=False)
    set_pens(dbp, sid, [THIN_PEN])
    dbp.conn.commit()
    return sid


def _style(dbp: DbProject, sid: str, style: str | None, gap: float | None = GAP) -> None:
    dbp.conn.execute(
        "UPDATE build_views SET beam_style = %s, beam_gap_min_pt = %s, beam_gap_max_pt = %s,"
        " beam_style_source = 'person' WHERE sheet_id = %s AND position = 1",
        (style, gap, gap, sid),
    )
    dbp.conn.commit()


def _beams(dbp: DbProject, sid: str) -> list[dict]:
    return [m for m in _members(dbp, sid) if m["type"] in ("beam", "brace", "joist")]


def test_style_single_builds_each_flange_line_as_a_beam_as_before(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    _run(dbp, sid, {"no_column_plan": True})
    got = _beams(dbp, sid)
    assert len(got) == 2  # today's behaviour on a double-line drawing: every beam counted twice
    assert all("double_line" not in (m["kind_evidence"] or {}) for m in got)


def test_style_double_builds_one_beam_with_its_evidence(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    _style(dbp, sid, "double")
    _, out = _run(dbp, sid, {"no_column_plan": True})
    got = _beams(dbp, sid)
    assert len(got) == 1 and out["double_pairs"] == 1 and out["double_unpaired_thin_lines"] == 0
    m = got[0]
    assert m["type"] == "beam" and m["profile"] == "W8X18"
    ev = m["kind_evidence"]["double_line"]
    assert (
        ev["amber"] == [] and ev["bf_in"] == 5.25 and ev["gap_in"] == pytest.approx(5.25, abs=0.01)
    )
    assert float(m["page_y0"]) == pytest.approx(300 + GAP / 2, abs=0.1)  # on the centreline


def test_a_label_that_does_not_fit_the_gap_is_amber_with_the_reason(
    dbp: DbProject, edition
) -> None:
    # a 3.2 in gap (2.4 pt) labelled with a 6.49 in flange
    sid = _make(dbp, [(300.0, "W12x26", 2.4)])
    _style(dbp, sid, "double")
    _run(dbp, sid, {"no_column_plan": True})
    ev = _beams(dbp, sid)[0]["kind_evidence"]["double_line"]
    assert any(a.startswith("width:") and "W12X26" in a and "6.49" in a for a in ev["amber"])


def test_a_double_line_angle_is_one_brace_not_a_beam(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP), (500.0, "L3x3x1/4", 2.2)])
    _style(dbp, sid, "double")
    _run(dbp, sid, {"no_column_plan": True})
    got = {m["type"]: m for m in _beams(dbp, sid)}
    assert sorted(got) == ["beam", "brace"]  # exactly one beam and one brace, not four lines
    assert got["brace"]["kind"] == "Horizontal Brace"
    assert got["beam"]["profile"] == "W8X18"


# --- the learn_style job ---


def _learn(dbp: DbProject, sid: str, x: float, y: float, pen: str = THIN_PEN, mode="replace"):
    vid = str(
        dbp.conn.execute(
            "SELECT id FROM build_views WHERE sheet_id = %s AND position = 1", (sid,)
        ).fetchone()["id"]
    )
    job = Job(
        "j", "learn_style",
        {"sheet_id": sid, "view_id": vid, "x": x, "y": y, "pen_class": pen, "mode": mode}, 1, 1,
    )  # fmt: skip
    res = run_learn_style(dbp.conn, job, dbp.config)
    row = dbp.conn.execute("SELECT * FROM build_views WHERE id = %s", (vid,)).fetchone()
    return res, row


def test_learning_stores_double_with_the_gap_and_source(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    res, row = _learn(dbp, sid, 350.0, 300.0)
    assert res["style"] == "double"
    assert row["beam_style"] == "double" and row["beam_style_source"] == "learned"
    assert float(row["beam_gap_min_pt"]) == pytest.approx(GAP, abs=0.01)
    assert row["beam_centreline_required"] is True and row["beam_style_at"] is not None
    assert row["beam_style_evidence"]["pen_class"] == THIN_PEN


def test_learning_a_heavy_pen_stores_single(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    res, row = _learn(dbp, sid, 350.0, 300.0, pen="1.5-2.5|black|solid")
    assert res["style"] == "single" and row["beam_style"] == "single"


def test_a_persons_override_is_never_replaced_by_a_learned_style(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    _style(dbp, sid, "single", gap=None)
    res, row = _learn(dbp, sid, 350.0, 300.0)
    assert "kept" in res and row["beam_style"] == "single" and row["beam_style_source"] == "person"


def test_adding_a_second_pen_with_another_style_makes_both(dbp: DbProject, edition) -> None:
    sid = _make(dbp, [(300.0, "W8x18", GAP)])
    _learn(dbp, sid, 350.0, 300.0)  # double
    res, row = _learn(dbp, sid, 350.0, 300.0, pen="1.5-2.5|black|solid", mode="add")
    assert res["style"] == "both" and row["beam_style"] == "both"
    assert float(row["beam_gap_min_pt"]) == pytest.approx(GAP, abs=0.01)  # the double gap is kept
