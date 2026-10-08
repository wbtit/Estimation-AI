"""Pre-registered candidate rules for linking a profile label to a member line (frozen design).

The rule set, its parameters and the grid to tune on the DESIGN split are fixed in
docs/PHASE4E_PREREGISTRATION.md, committed before any gold link or score exists. Pure functions:
no learning beyond the registered grid and the per-document preferred side.

A label has candidates (dicts from candidates.py: dist, rel_angle, side, ...), the label's own
flags (group note in the line) and optionally a detected leader target (candidate number or None).
The prediction is ("line", cand_number) | ("group", None); the full ranking is also returned so that
recall at 3 can be measured.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Params:
    theta_tol: float = 90.0  # a candidate is "aligned" with the baseline within this many degrees
    p_ang: float = 0.0  # distance penalty (pt) for a candidate that is not aligned
    side_mode: str = "off"  # "off" | "learned" (the document's preferred side, learned on DESIGN)
    p_side: float = 0.0  # distance penalty (pt) for a candidate on the non-preferred side
    leader: bool = False
    leader_snap: float = 4.0
    leader_max_len: float = 250.0
    group_notes: bool = False  # label line with TYP/SIM/UNO/EA -> predict "group"


# the grid searched on the DESIGN split (all combinations), registered before scoring
GRID = {
    "theta_tol": (5.0, 10.0, 20.0),
    "p_ang": (0.0, 20.0, 60.0),
    "side_mode_p_side": (("off", 0.0), ("learned", 10.0), ("learned", 30.0)),
    "leader": (False, True),
    "leader_snap": (3.0, 6.0),
    "leader_max_len": (120.0, 250.0),
    "group_notes": (False, True),
}
BASELINE = Params()  # R1: nearest line by distance, nothing else


def score(c: dict, p: Params, preferred_side: int | None) -> float:
    s = float(c["dist"])
    if c["rel_angle"] > p.theta_tol:
        s += p.p_ang
    if p.side_mode == "learned" and preferred_side is not None and c["side"] not in (0, preferred_side):
        s += p.p_side
    return s


def rank(cands: list[dict], p: Params, preferred_side: int | None) -> list[tuple[float, int]]:
    """[(score, cand_number)] best first; ties by smaller distance then candidate number."""
    return sorted(((score(c, p, preferred_side), c["cand"]) for c in cands), key=lambda t: (t[0], t[1]))


def predict(
    cands: list[dict],
    flags: dict,
    p: Params,
    preferred_side: int | None = None,
    leader_target: int | None = None,
) -> tuple[tuple[str, int | None], list[int], dict]:
    """(prediction, ranking of candidate numbers, info for the confidence model)."""
    ranked = rank(cands, p, preferred_side)
    order = [n for _, n in ranked]
    margin = (ranked[1][0] - ranked[0][0]) if len(ranked) > 1 else (float("inf") if ranked else 0.0)
    info = {"margin": margin, "n_candidates": len(cands), "leader": False,
            "aligned_top": bool(ranked) and next(c for c in cands if c["cand"] == order[0])["rel_angle"] <= p.theta_tol}  # fmt: skip
    if p.group_notes and flags.get("group_note_in_line"):
        return ("group", None), order, info
    if p.leader and leader_target is not None:
        info["leader"] = True
        order = [leader_target] + [n for n in order if n != leader_target]
        return ("line", leader_target), order, info
    if not order:
        return ("none", None), order, info
    return ("line", order[0]), order, info


def confidence(info: dict, m_med: float, m_hi: float) -> str:
    """Confidence class from the margin between the best two scores (registered thresholds)."""
    if info["leader"]:
        return "high" if info["n_candidates"] else "low"
    if info["margin"] >= m_hi and info["aligned_top"]:
        return "high"
    if info["margin"] >= m_med:
        return "medium"
    return "low"
