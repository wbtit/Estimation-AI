"""The frozen Phase 4e linking rule (not retuned).

score = distance (pt) + 20 pt when the candidate is more than 5 degrees from the text baseline;
the best score wins (ties: smaller distance, then lower candidate number). Confidence class:
  high   margin between the best two scores >= 40 pt and the best candidate is aligned
  medium margin >= 5 pt
  low    otherwise (and when there is no candidate)
Side preference, leader following and group notes were switched off by the DESIGN tuning.
"""

from dataclasses import dataclass

from src.linking.candidates import Candidate

THETA_TOL_DEG = 5.0
ANGLE_PENALTY_PT = 20.0
MARGIN_MEDIUM_PT = 5.0
MARGIN_HIGH_PT = 40.0


@dataclass(frozen=True)
class Ranked:
    candidate: Candidate
    score: float


@dataclass(frozen=True)
class Proposal:
    ranked: list[Ranked]  # best first
    confidence: str  # "high" | "medium" | "low"
    margin: float | None  # None when there is a single or no candidate

    @property
    def best(self) -> Ranked | None:
        return self.ranked[0] if self.ranked else None


def score(c: Candidate) -> float:
    return c.dist + (ANGLE_PENALTY_PT if c.rel_angle > THETA_TOL_DEG else 0.0)


def propose(cands: list[Candidate]) -> Proposal:
    ranked = sorted(
        (Ranked(c, score(c)) for c in cands),
        key=lambda r: (r.score, r.candidate.dist, r.candidate.cand),
    )
    if not ranked:
        return Proposal([], "low", None)
    margin = ranked[1].score - ranked[0].score if len(ranked) > 1 else float("inf")
    aligned = ranked[0].candidate.rel_angle <= THETA_TOL_DEG
    if margin >= MARGIN_HIGH_PT and aligned:
        confidence = "high"
    elif margin >= MARGIN_MEDIUM_PT:
        confidence = "medium"
    else:
        confidence = "low"
    return Proposal(ranked, confidence, None if margin == float("inf") else margin)
