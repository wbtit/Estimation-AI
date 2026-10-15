"""Line-first build of one page (Phase 11): a person confirms crop, scale, T.O.S. and the beam pen
class; the build then finds grids, columns, beam lines, supports, pieces and their labels.

One module per step (segments, clean, grids, columns, register, beam_lines, supports, labels,
pieces) and the `build_sheet` job (job.py). Deterministic; no LLM, no learned weights. Every
threshold is a named module constant. Ported from the Phase 7 grammar prototype
(tools/takeoff/phase7_parse.py, phase7_grammar.py) and src/linking/lines.py.
"""

RULES_VERSION = "phase11-build-v1"
