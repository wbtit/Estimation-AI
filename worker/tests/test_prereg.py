"""Pre-registration hash check on a synthetic document."""

from __future__ import annotations

import pytest

from measure.prereg import verify, write


def test_the_committed_hash_must_match(tmp_path):
    doc, hf = tmp_path / "PREREG.md", tmp_path / "prereg" / "X.sha256"
    doc.write_text("bars and rules\n")
    h = write(doc, hf)
    assert verify(doc, hf) == h
    doc.write_text("bars and rules, changed after the run\n")
    with pytest.raises(SystemExit):
        verify(doc, hf)
    with pytest.raises(SystemExit):
        verify(tmp_path / "missing.md", hf)
