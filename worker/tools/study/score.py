"""STEP 4c: tune on DESIGN, freeze, score VALIDATION exactly once (see docs/PHASE4E_PREREGISTRATION.md).

    score.py tune       # grid search on the DESIGN split; writes frozen.json and design_results.json
    score.py validate   # scores VALIDATION once with frozen.json; refuses to run twice
Inputs are in fixtures/private/study/: labels_sample.json, labels_candidates.json, split.json and
<job>/gold.json (AI-annotated). stdout: counts and rates only.
"""

import itertools
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import leaders  # noqa: E402
import rules  # noqa: E402

NOT_MEMBER = "not_member_label"
M_MED_SET = (5.0, 10.0)
M_HI_SET = (20.0, 40.0)
MIN_HIGH_DESIGN = 10


def load_all() -> dict[str, dict]:
    sample = json.loads((common.STUDY / "labels_sample.json").read_text())
    cands = json.loads((common.STUDY / "labels_candidates.json").read_text())
    split = json.loads((common.STUDY / "split.json").read_text())
    items: dict[str, dict] = {}
    for job, d in sample.items():
        gold = json.loads((common.doc_dir(job) / "gold.json").read_text())
        for lab in d["sample"]:
            lid = lab["label_id"]
            g = gold[lid]
            items[lid] = {
                **lab, "job": job, "split": split[lid], "candidates": cands[lid]["candidates"],
                "gold": str(g["gold"]), "gold_class": g.get("class", "other"),
                "certainty": g.get("certainty", ""),
            }  # fmt: skip
    return items


def preferred_side(items: list[dict]) -> dict[str, int | None]:
    """Per document: the majority side of the gold candidate among DESIGN labels (None if unclear)."""
    votes: dict[str, Counter] = defaultdict(Counter)
    for it in items:
        if it["split"] != "design" or not it["gold"].isdigit():
            continue
        c = next((c for c in it["candidates"] if str(c["cand"]) == it["gold"]), None)
        if c and c["side"] in (1, -1):
            votes[it["job"]][c["side"]] += 1
    out: dict[str, int | None] = {}
    for job in {i["job"] for i in items}:
        v = votes.get(job)
        out[job] = None if not v or (len(v) == 2 and v[1] == v[-1]) else v.most_common(1)[0][0]
    return out


class LeaderCache:
    def __init__(self) -> None:
        self.pages: dict[tuple[str, int], leaders.PageIndex] = {}
        self.cache: dict[tuple[str, float, float], int | None] = {}

    def target(self, it: dict, snap: float, max_len: float) -> int | None:
        key = (it["label_id"], snap, max_len)
        if key not in self.cache:
            pk = (it["job"], it["page"])
            if pk not in self.pages:
                self.pages[pk] = leaders.PageIndex(it["job"], it["page"])
            self.cache[key] = leaders.find_leader_target(
                self.pages[pk], it["bbox"], it["candidates"], snap, max_len
            )
        return self.cache[key]


def predict_item(it: dict, p: rules.Params, pref: dict, lc: LeaderCache):
    lt = lc.target(it, p.leader_snap, p.leader_max_len) if p.leader else None
    return rules.predict(
        it["candidates"],
        {"group_note_in_line": it["group_note_in_line"]},
        p,
        pref.get(it["job"]),
        lt,
    )


def is_correct(pred: tuple, gold: str) -> bool:
    kind, n = pred
    if gold.isdigit():
        return kind == "line" and n == int(gold)
    return gold in ("none", "group") and kind == gold


def evaluate(items: list[dict], p: rules.Params, pref: dict, lc: LeaderCache) -> dict:
    n = ok = 0
    for it in items:
        if it["gold"] == NOT_MEMBER:
            continue
        pred, _, _ = predict_item(it, p, pref, lc)
        n += 1
        ok += is_correct(pred, it["gold"])
    return {"n": n, "correct": ok, "top1": ok / n if n else 0.0}


def all_params() -> list[rules.Params]:
    g = rules.GRID
    out = []
    for tt, pa, (sm, ps), ld, sn, ml, gn in itertools.product(
        g["theta_tol"], g["p_ang"], g["side_mode_p_side"], g["leader"], g["leader_snap"],
        g["leader_max_len"], g["group_notes"],
    ):  # fmt: skip
        if not ld and (sn != g["leader_snap"][0] or ml != g["leader_max_len"][0]):
            continue  # leader parameters are irrelevant when the leader rule is off
        if pa == 0.0 and tt != g["theta_tol"][0]:
            continue  # theta_tol is irrelevant without the angle penalty
        out.append(rules.Params(tt, pa, sm, ps, ld, sn, ml, gn))
    return out


def complexity(p: rules.Params) -> tuple:
    return (
        int(p.leader) + int(p.group_notes) + int(p.side_mode == "learned") + int(p.p_ang > 0),
        p.p_ang + p.p_side,
    )


def tune() -> None:
    lock = common.STUDY / "frozen.json"
    if lock.exists():
        raise SystemExit(
            "frozen.json exists: the configuration is already frozen; not tuning again"
        )
    items = list(load_all().values())
    design = [i for i in items if i["split"] == "design"]
    pref = preferred_side(items)
    lc = LeaderCache()
    results = []
    for p in all_params():
        r = evaluate(design, p, pref, lc)
        results.append((r["top1"], p, r))
    best_top1 = max(r[0] for r in results)
    best = sorted((r for r in results if r[0] == best_top1), key=lambda r: complexity(r[1]))[0]
    p = best[1]
    # confidence thresholds: highest DESIGN accuracy inside "high" with at least MIN_HIGH_DESIGN labels
    best_conf = None
    for m_med, m_hi in itertools.product(M_MED_SET, M_HI_SET):
        hi = [i for i in design if i["gold"] != NOT_MEMBER]
        rows = []
        for it in hi:
            pred, _, info = predict_item(it, p, pref, lc)
            if rules.confidence(info, m_med, m_hi) == "high":
                rows.append(is_correct(pred, it["gold"]))
        if len(rows) >= MIN_HIGH_DESIGN:
            acc = sum(rows) / len(rows)
            key = (acc, -m_hi)
            if best_conf is None or key > best_conf[0]:
                best_conf = (key, m_med, m_hi, len(rows), acc)
    m_med, m_hi = (best_conf[1], best_conf[2]) if best_conf else (M_MED_SET[0], M_HI_SET[0])
    frozen = {
        "params": p.__dict__, "preferred_side": pref, "m_med": m_med, "m_hi": m_hi,
        "design": {"n": best[2]["n"], "top1": best[0], "baseline_top1": evaluate(design, rules.BASELINE, pref, lc)["top1"]},
        "configurations_tried": len(results), "tied_at_best": sum(1 for r in results if r[0] == best_top1),
        "high_class_design": None if not best_conf else {"n": best_conf[3], "accuracy": best_conf[4]},
    }  # fmt: skip
    lock.write_text(json.dumps(frozen, indent=1))
    print("tuned:", frozen["design"], "tried", len(results), "tied", frozen["tied_at_best"])
    print("frozen params:", p)


def failure_mode(it: dict, pred: tuple, order: list[int], info: dict, p: rules.Params) -> str:
    gold = it["gold"]
    kind, n = pred
    if gold == "missing":
        return "candidate_missing"
    if gold in ("none", "group"):
        return f"predicted_{kind}_for_gold_{gold}"
    if kind == "group":
        return "group_rule_overrode_a_line"
    if kind == "none":
        return "no_candidates_for_a_line_gold"
    c = {x["cand"]: x for x in it["candidates"]}
    a, b = c[n], c[int(gold)]
    if info.get("leader"):
        return "leader_followed_to_wrong_line"
    ang = abs(a["rel_angle"] - b["rel_angle"])
    if ang <= 10:
        same_member = abs(a["dist"] - b["dist"]) <= 4 and a["side"] == b["side"]
        if same_member:
            return "parallel_neighbour_same_side"
        return (
            "parallel_neighbour_other_side"
            if a["side"] != b["side"]
            else "parallel_neighbour_same_side"
        )
    return "crossing_or_non_parallel_line"


def metrics(
    items: list[dict], p: rules.Params, pref: dict, lc: LeaderCache, m_med: float, m_hi: float
) -> dict:
    n = ok = line_gold = r3 = none_group = missing = 0
    by_class: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_conf: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    modes: Counter = Counter()
    for it in items:
        if it["gold"] == NOT_MEMBER:
            continue
        pred, order, info = predict_item(it, p, pref, lc)
        correct = is_correct(pred, it["gold"])
        n += 1
        ok += correct
        none_group += it["gold"] in ("none", "group")
        missing += it["gold"] == "missing"
        if it["gold"].isdigit():
            line_gold += 1
            r3 += int(it["gold"]) in order[:3]
        by_class[it["gold_class"]][0] += 1
        by_class[it["gold_class"]][1] += correct
        conf = rules.confidence(info, m_med, m_hi)
        by_conf[conf][0] += 1
        by_conf[conf][1] += correct
        if not correct:
            modes[failure_mode(it, pred, order, info, p)] += 1
    return {
        "n": n, "top1": ok / n if n else None, "correct": ok,
        "line_gold": line_gold, "top1_among_line_gold": None,
        "recall_at_3": r3 / line_gold if line_gold else None,
        "none_or_group_rate": none_group / n if n else None, "missing_rate": missing / n if n else None,
        "by_class": {k: {"n": v[0], "top1": v[1] / v[0]} for k, v in by_class.items()},
        "by_confidence": {k: {"n": v[0], "top1": v[1] / v[0]} for k, v in by_conf.items()},
        "failure_modes": dict(modes.most_common()),
    }  # fmt: skip


def validate() -> None:
    frozen = json.loads((common.STUDY / "frozen.json").read_text())
    out_path = common.STUDY / "validation_results.json"
    if out_path.exists():
        raise SystemExit("validation_results.json exists: VALIDATION is scored exactly once")
    items = list(load_all().values())
    val = [i for i in items if i["split"] == "validation"]
    p = rules.Params(**frozen["params"])
    pref = {k: v for k, v in frozen["preferred_side"].items()}
    lc = LeaderCache()
    result: dict = {"frozen": frozen, "pooled": {}, "per_doc": {}, "baseline_pooled": {}}
    for name, params in (("frozen", p), ("baseline_R1", rules.BASELINE)):
        result["pooled"][name] = metrics(val, params, pref, lc, frozen["m_med"], frozen["m_hi"])
        result["per_doc"][name] = {
            job: metrics(
                [i for i in val if i["job"] == job],
                params,
                pref,
                lc,
                frozen["m_med"],
                frozen["m_hi"],
            )
            for job in sorted({i["job"] for i in val})
        }
        # conditional accuracy: only labels whose gold member is among the candidates (or none/group)
        cond = [i for i in val if i["gold"] not in (NOT_MEMBER, "missing")]
        result["pooled"][name]["top1_among_labels_with_gold_in_candidates"] = metrics(
            cond, params, pref, lc, frozen["m_med"], frozen["m_hi"]
        )["top1"]
    out_path.write_text(json.dumps(result, indent=1))
    f = result["pooled"]["frozen"]
    print("VALIDATION scored once. n", f["n"], "top1", round(f["top1"], 4), "recall@3", f["recall_at_3"],
          "baseline top1", round(result["pooled"]["baseline_R1"]["top1"], 4))  # fmt: skip


if __name__ == "__main__":
    {"tune": tune, "validate": validate}[sys.argv[1]]()
