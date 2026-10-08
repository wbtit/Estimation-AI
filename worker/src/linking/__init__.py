"""Label-to-line linking for the review screen (Phase 5). Deterministic; no learning, no LLM.

The rule is the Phase 4e rule exactly as frozen after tuning on the DESIGN split (see
docs/PHASE4E_ASSOCIATION_STUDY.md): it is a suggestion, and a human confirms or fixes it.
"""

RULE_VERSION = "phase4e-v1-frozen"
