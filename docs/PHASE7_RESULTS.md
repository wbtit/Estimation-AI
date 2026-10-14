# Phase 7 results: display basis, member-geometry re-scoring, structural grammar prototype

Pre-registration: `docs/PHASE7_PREREGISTRATION.md` (committed before any measurement; errata in its section 6). Everything is deterministic code: no LLM, no trained model, nothing pushed, the frozen linking code untouched. This file is written in stages: Part A and Part B are final (committed before Part C was started); Part C is added below when it is done.

## Part A. Housekeeping (committed as `d5ad17e`)
- **Empty duplicate measurement project: NOT deleted.** Read-only preview (`worker/tools/project_preview.py`): 1 project row, 1 file record, 20 sheets and 1 job row; 0 views, text items, legend rows, members, grade rules, edits. The rule was "delete only if every count is zero"; five counts are not zero, so it stays. Its twin (the real run) has 20 sheets, 7 views, 28,584 text items, 3 legend rows, 208 members. If you want it removed anyway (it is the aborted first scan), say so; the uploaded PDF on disk would stay unless you say otherwise.
- **Display count basis is now one piece per linked line** (API takeoff, review summary, Excel takeoff sheet, sheet-list piece count, web takeoff panel). Of the labels on one line the best-ranked non-red label carries the piece; the others stay listed at 0 pieces; "separate members" or a typed length makes a label its own piece; existing steel never carries a piece. The label count (older basis) is shown beside it. The BOM still counts labels. Tests: 6 new unit tests, 1 new route test and an added Excel assertion for the rule, 2 new web tests; five older tests that asserted the label basis were updated. Decision Log and OPEN_QUESTIONS updated.

## Part B. Member-geometry re-scoring (no new detection)

### Short answer
- **A correction to the premise.** The Phase 6b scoring already measured the distance from the symbol to the linked line segment (a piece with a line was matched by point-to-segment distance), so the 6b figures ARE geometry figures. They are reproduced exactly here with the same greedy rule (table B1: 915 / 1,438, 876 / 1,327 and 1,259 / 1,837 matches). What is new is the exact one-to-one rule, the 36 pt radius, a real point-based comparison, the label-only pieces and the chance controls.
- **The exact (Hungarian) rule changes little**, as registered: +0.9% matches at 12 pt for label-first and line with label, +1.8% for line first (+3.1% for the oracle line first); at 36 pt up to +6%. The registered prediction (within 5% at 12 pt) held for all six rows.
- **Point against geometry.** Matched to the point where our piece is shown (the label centre), recall at 12 pt is 0.09 (label-first), 0.07 (line with label); matched to the member geometry it is 0.21 and 0.20. Our displayed dot is within 12 pt of an estimator symbol in only 33% to 41% of the cases where the linked line is (375 of 923, 291 of 883, 407 of 1,282 matches). For line first (dot = line midpoint) 0.09 against 0.29. The dot is not where the estimators click; the linked line is much closer.
- **Chance.** This is the main new finding. With the estimator symbols replaced by symbols moved 60 to 200 pt (same layout and density), the same pieces still match 0.108 (label-first), 0.103 (line with label) and 0.182 (line first) of them at 12 pt, about half of the real recall (0.211, 0.202, 0.293). Uniform random points match 0.04 to 0.10. By the registered reading guide (real recall at least 0.10 above the larger control AND precision at least 1.5 times the control): label-first yes (+0.103, ratio 1.95), line first yes (+0.111, 1.61), **line with label no, by a hair (+0.099, 1.96)**; the oracle class passes for all three (+0.157, +0.138, +0.160). **Without the two largest jobs none of the suggested-class bases passes** (+0.045, +0.043, +0.038) and of the oracle ones only label-first does (+0.102; line with label +0.081, line first +0.092).
- **Reading.** The geometry metric is generous: on these dense drawings a 12 pt band around any set of lines catches a symbol put in a similar place about half as often as a real one. Alignment above chance is real but modest: about +0.10 recall over all pages, +0.04 without the two largest jobs. The Phase 6b / 6c statements that "70% of the missed symbols have a line nearby" and that the matched share is 35% at 12 pt must be read against this baseline.
- **No basis reaches any bar** (worth building: at least 50% of pages within plus or minus 1 and P and R at least 0.6; promising: 30%, 0.4 and 0.4). Best page agreement is 22% within plus or minus 1 (oracle, line with label). The page-count rows are identical to Phase 6b for the unchanged bases.
- **Label-only pieces** (counted labels with no linked line, table B5): 1,319 on 75 of 136 pages (job-002 alone 506, job-015 217, job-017 160). Adding them as label points raises the matched count at 12 pt by 17 for each of the two bases they apply to (923 to 940, 883 to 900) and lowers precision (0.20 to 0.16, 0.29 to 0.21). They are not a source of recall.
- **Per job (B4)** the picture of 6b is unchanged: job-015, job-020, job-013, job-011, job-003 and job-010 are the best (F1 0.27 to 0.42 on line with label), job-002/004/005/018/019 and job-006/014 near zero.

### Method as run
Same 16 jobs, 136 pages, 4,373 symbols and page map as Phase 6b (page-map doubts not corrected). Pieces rebuilt in-process from the PDF the API stored for each job's Phase 6b project and the counted labels the read-only API on port 3100 returns (the same filter as 6b). Geometry per piece: label-first and line with label: the linked line; line first: the merged line. Displayed point: label centre (line first: line midpoint). Exact matching: most pairs within the radius first, then smallest total distance, solved per connected component (own implementation, tested against brute force; scipy is not installed). Controls: 20 replicates per page, seeds 7100 and 7200 (uniform in the view box; displaced by 60 to 200 pt), sd over replicates below 0.01 everywhere. Processes: one read-only API on port 3100 (PID recorded, stopped by that PID), the build run and the scoring run (PIDs recorded); the API on port 3000 was not touched.

## Part B tables
### B1. Reconciliation with the Phase 6b figures (greedy, suggested class, matched at 12 / 24 pt)
| basis | recomputed | Phase 6b published |
|---|---|---|
| label-first | 915 / 1438 | 915 / 1438 |
| line with label | 876 / 1327 | 876 / 1327 |
| line first | 1259 / 1837 | 1259 / 1837 |

### B2. all 136 pages, suggested class: matching rule and distance, P / R / F1 by radius
| basis | matching | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|---|
| label-first | greedy, geometry (= Phase 6b) | 4,645 | 0.20 / 0.21 / 0.20 | 0.31 / 0.33 | 0.37 / 0.39 | 5% / 13% / 19% | not enough |
| label-first | exact, geometry | 4,645 | 0.20 / 0.21 / 0.20 | 0.32 / 0.34 | 0.38 / 0.41 | 5% / 13% / 19% | not enough |
| label-first | exact, point (label centre / line midpoint) | 4,645 | 0.08 / 0.09 / 0.08 | 0.23 / 0.25 | 0.33 / 0.35 | 5% / 13% / 19% | not enough |
| line with label | greedy, geometry (= Phase 6b) | 3,062 | 0.29 / 0.20 / 0.24 | 0.43 / 0.30 | 0.51 / 0.35 | 6% / 14% / 20% | not enough |
| line with label | exact, geometry | 3,062 | 0.29 / 0.20 / 0.24 | 0.44 / 0.31 | 0.53 / 0.37 | 6% / 14% / 20% | not enough |
| line with label | exact, point (label centre / line midpoint) | 3,062 | 0.10 / 0.07 / 0.08 | 0.27 / 0.19 | 0.39 / 0.27 | 6% / 14% / 20% | not enough |
| line first | greedy, geometry (= Phase 6b) | 13,133 | 0.10 / 0.29 / 0.14 | 0.14 / 0.42 | 0.16 / 0.50 | 2% / 5% / 12% | not enough |
| line first | exact, geometry | 13,133 | 0.10 / 0.29 / 0.15 | 0.15 / 0.44 | 0.17 / 0.51 | 2% / 5% / 12% | not enough |
| line first | exact, point (label centre / line midpoint) | 13,133 | 0.03 / 0.09 / 0.05 | 0.08 / 0.24 | 0.12 / 0.37 | 2% / 5% / 12% | not enough |

### B2. all 136 pages, oracle class (upper bound): matching rule and distance, P / R / F1 by radius
| basis | matching | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|---|
| label-first | greedy, geometry (= Phase 6b) | 5,419 | 0.23 / 0.29 / 0.26 | 0.35 / 0.43 | 0.40 / 0.49 | 10% / 21% / 25% | not enough |
| label-first | exact, geometry | 5,419 | 0.24 / 0.29 / 0.26 | 0.36 / 0.44 | 0.42 / 0.52 | 10% / 21% / 25% | not enough |
| label-first | exact, point (label centre / line midpoint) | 5,419 | 0.07 / 0.09 / 0.08 | 0.21 / 0.26 | 0.31 / 0.38 | 10% / 21% / 25% | not enough |
| line with label | greedy, geometry (= Phase 6b) | 3,476 | 0.33 / 0.26 / 0.29 | 0.48 / 0.38 | 0.55 / 0.44 | 12% / 22% / 30% | not enough |
| line with label | exact, geometry | 3,476 | 0.33 / 0.26 / 0.29 | 0.50 / 0.40 | 0.58 / 0.46 | 12% / 22% / 30% | not enough |
| line with label | exact, point (label centre / line midpoint) | 3,476 | 0.09 / 0.07 / 0.08 | 0.26 / 0.21 | 0.38 / 0.30 | 12% / 22% / 30% | not enough |
| line first | greedy, geometry (= Phase 6b) | 16,763 | 0.10 / 0.37 / 0.15 | 0.14 / 0.53 | 0.16 / 0.62 | 3% / 8% / 15% | not enough |
| line first | exact, geometry | 16,763 | 0.10 / 0.38 / 0.16 | 0.15 / 0.56 | 0.17 / 0.65 | 3% / 8% / 15% | not enough |
| line first | exact, point (label centre / line midpoint) | 16,763 | 0.03 / 0.11 / 0.05 | 0.08 / 0.29 | 0.11 / 0.43 | 3% / 8% / 15% | not enough |

### B2. without the two largest jobs (job-012, job-015), suggested class: matching rule and distance, P / R / F1 by radius
| basis | matching | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|---|
| label-first | greedy, geometry (= Phase 6b) | 2,049 | 0.16 / 0.13 / 0.14 | 0.26 / 0.21 | 0.34 / 0.27 | 7% / 18% / 22% | not enough |
| label-first | exact, geometry | 2,049 | 0.16 / 0.13 / 0.14 | 0.27 / 0.21 | 0.35 / 0.28 | 7% / 18% / 22% | not enough |
| label-first | exact, point (label centre / line midpoint) | 2,049 | 0.05 / 0.04 / 0.04 | 0.16 / 0.13 | 0.26 / 0.21 | 7% / 18% / 22% | not enough |
| line with label | greedy, geometry (= Phase 6b) | 1,346 | 0.23 / 0.12 / 0.16 | 0.36 / 0.19 | 0.45 / 0.23 | 8% / 18% / 19% | not enough |
| line with label | exact, geometry | 1,346 | 0.23 / 0.12 / 0.16 | 0.37 / 0.19 | 0.46 / 0.24 | 8% / 18% / 19% | not enough |
| line with label | exact, point (label centre / line midpoint) | 1,346 | 0.06 / 0.03 / 0.04 | 0.20 / 0.10 | 0.32 / 0.17 | 8% / 18% / 19% | not enough |
| line first | greedy, geometry (= Phase 6b) | 7,199 | 0.06 / 0.16 / 0.08 | 0.09 / 0.25 | 0.12 / 0.32 | 3% / 6% / 13% | not enough |
| line first | exact, geometry | 7,199 | 0.06 / 0.16 / 0.08 | 0.09 / 0.26 | 0.12 / 0.34 | 3% / 6% / 13% | not enough |
| line first | exact, point (label centre / line midpoint) | 7,199 | 0.02 / 0.04 / 0.02 | 0.04 / 0.12 | 0.08 / 0.22 | 3% / 6% / 13% | not enough |

### B2. without the two largest jobs (job-012, job-015), oracle class (upper bound): matching rule and distance, P / R / F1 by radius
| basis | matching | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|---|
| label-first | greedy, geometry (= Phase 6b) | 2,642 | 0.20 / 0.21 / 0.21 | 0.32 / 0.33 | 0.39 / 0.40 | 13% / 28% / 29% | not enough |
| label-first | exact, geometry | 2,642 | 0.20 / 0.21 / 0.21 | 0.33 / 0.34 | 0.40 / 0.41 | 13% / 28% / 29% | not enough |
| label-first | exact, point (label centre / line midpoint) | 2,642 | 0.04 / 0.04 / 0.04 | 0.15 / 0.15 | 0.25 / 0.25 | 13% / 28% / 29% | not enough |
| line with label | greedy, geometry (= Phase 6b) | 1,700 | 0.27 / 0.18 / 0.22 | 0.43 / 0.28 | 0.52 / 0.34 | 16% / 27% / 28% | not enough |
| line with label | exact, geometry | 1,700 | 0.27 / 0.18 / 0.22 | 0.44 / 0.29 | 0.54 / 0.35 | 16% / 27% / 28% | not enough |
| line with label | exact, point (label centre / line midpoint) | 1,700 | 0.05 / 0.03 / 0.04 | 0.18 / 0.12 | 0.31 / 0.21 | 16% / 27% / 28% | not enough |
| line first | greedy, geometry (= Phase 6b) | 13,149 | 0.05 / 0.26 / 0.09 | 0.08 / 0.41 | 0.10 / 0.50 | 4% / 9% / 14% | not enough |
| line first | exact, geometry | 13,149 | 0.05 / 0.27 / 0.09 | 0.08 / 0.43 | 0.10 / 0.53 | 4% / 9% / 14% | not enough |
| line first | exact, point (label centre / line midpoint) | 13,149 | 0.01 / 0.07 / 0.02 | 0.04 / 0.19 | 0.06 / 0.31 | 4% / 9% / 14% | not enough |

### B3. Chance controls, all 136 pages (exact matching, geometry distance; mean of 20 replicates, sd in brackets)
| basis | class | radius | real P / R | uniform P / R | displaced P / R | real R minus larger control R | real P over larger control P | carries information (registered guide) |
|---|---|---|---|---|---|---|---|---|
| label-first | suggested | 12 | 0.20 / 0.21 | 0.04 (0.002) / 0.04 (0.002) | 0.10 (0.004) / 0.11 (0.004) | +0.103 | 1.95 | yes |
| label-first | suggested | 24 | 0.32 / 0.34 | 0.07 (0.003) / 0.08 (0.004) | 0.18 (0.004) / 0.19 (0.004) | +0.145 | 1.76 |  |
| label-first | suggested | 36 | 0.38 / 0.41 | 0.11 (0.004) / 0.11 (0.004) | 0.24 (0.004) / 0.25 (0.004) | +0.151 | 1.59 |  |
| line with label | suggested | 12 | 0.29 / 0.20 | 0.06 (0.003) / 0.04 (0.002) | 0.15 (0.005) / 0.10 (0.004) | +0.099 | 1.96 | no |
| line with label | suggested | 24 | 0.44 / 0.31 | 0.11 (0.005) / 0.08 (0.003) | 0.25 (0.006) / 0.18 (0.004) | +0.133 | 1.75 |  |
| line with label | suggested | 36 | 0.53 / 0.37 | 0.16 (0.006) / 0.11 (0.004) | 0.34 (0.006) / 0.24 (0.004) | +0.132 | 1.55 |  |
| line first | suggested | 12 | 0.10 / 0.29 | 0.03 (0.001) / 0.09 (0.004) | 0.06 (0.001) / 0.18 (0.004) | +0.111 | 1.61 | yes |
| line first | suggested | 24 | 0.15 / 0.44 | 0.05 (0.002) / 0.15 (0.005) | 0.10 (0.002) / 0.29 (0.005) | +0.147 | 1.50 |  |
| line first | suggested | 36 | 0.17 / 0.51 | 0.07 (0.002) / 0.20 (0.005) | 0.12 (0.002) / 0.37 (0.005) | +0.144 | 1.39 |  |
| label-first | oracle | 12 | 0.24 / 0.29 | 0.04 (0.002) / 0.06 (0.003) | 0.11 (0.004) / 0.13 (0.005) | +0.157 | 2.17 | yes |
| label-first | oracle | 24 | 0.36 / 0.44 | 0.08 (0.003) / 0.10 (0.004) | 0.19 (0.004) / 0.24 (0.005) | +0.207 | 1.88 |  |
| label-first | oracle | 36 | 0.42 / 0.52 | 0.11 (0.003) / 0.14 (0.004) | 0.25 (0.004) / 0.31 (0.005) | +0.205 | 1.65 |  |
| line with label | oracle | 12 | 0.33 / 0.26 | 0.07 (0.004) / 0.05 (0.003) | 0.16 (0.006) / 0.13 (0.004) | +0.138 | 2.09 | yes |
| line with label | oracle | 24 | 0.50 / 0.40 | 0.12 (0.006) / 0.10 (0.005) | 0.27 (0.006) / 0.22 (0.005) | +0.178 | 1.82 |  |
| line with label | oracle | 36 | 0.58 / 0.46 | 0.17 (0.005) / 0.13 (0.004) | 0.36 (0.006) / 0.29 (0.005) | +0.174 | 1.60 |  |
| line first | oracle | 12 | 0.10 / 0.38 | 0.03 (0.001) / 0.10 (0.005) | 0.06 (0.001) / 0.22 (0.004) | +0.160 | 1.74 | yes |
| line first | oracle | 24 | 0.15 / 0.56 | 0.04 (0.001) / 0.17 (0.004) | 0.09 (0.001) / 0.35 (0.005) | +0.210 | 1.60 |  |
| line first | oracle | 36 | 0.17 / 0.65 | 0.06 (0.001) / 0.22 (0.005) | 0.11 (0.001) / 0.44 (0.005) | +0.213 | 1.48 |  |

### B3. Chance controls, without the two largest jobs (exact matching, geometry distance; mean of 20 replicates, sd in brackets)
| basis | class | radius | real P / R | uniform P / R | displaced P / R | real R minus larger control R | real P over larger control P | carries information (registered guide) |
|---|---|---|---|---|---|---|---|---|
| label-first | suggested | 12 | 0.16 / 0.13 | 0.03 (0.003) / 0.02 (0.002) | 0.10 (0.005) / 0.08 (0.004) | +0.045 | 1.56 | no |
| label-first | suggested | 24 | 0.27 / 0.21 | 0.05 (0.004) / 0.04 (0.003) | 0.18 (0.005) / 0.14 (0.004) | +0.075 | 1.54 |  |
| label-first | suggested | 36 | 0.35 / 0.28 | 0.06 (0.004) / 0.05 (0.004) | 0.23 (0.006) / 0.18 (0.005) | +0.093 | 1.51 |  |
| line with label | suggested | 12 | 0.23 / 0.12 | 0.04 (0.005) / 0.02 (0.002) | 0.15 (0.008) / 0.08 (0.004) | +0.043 | 1.56 | no |
| line with label | suggested | 24 | 0.37 / 0.19 | 0.07 (0.006) / 0.04 (0.003) | 0.24 (0.008) / 0.13 (0.004) | +0.064 | 1.50 |  |
| line with label | suggested | 36 | 0.46 / 0.24 | 0.09 (0.006) / 0.05 (0.003) | 0.32 (0.010) / 0.17 (0.005) | +0.074 | 1.44 |  |
| line first | suggested | 12 | 0.06 / 0.16 | 0.02 (0.001) / 0.04 (0.004) | 0.04 (0.002) / 0.12 (0.005) | +0.038 | 1.32 | no |
| line first | suggested | 24 | 0.09 / 0.26 | 0.03 (0.002) / 0.08 (0.005) | 0.07 (0.002) / 0.19 (0.006) | +0.072 | 1.37 |  |
| line first | suggested | 36 | 0.12 / 0.34 | 0.04 (0.002) / 0.10 (0.004) | 0.09 (0.002) / 0.25 (0.007) | +0.086 | 1.34 |  |
| label-first | oracle | 12 | 0.20 / 0.21 | 0.03 (0.003) / 0.03 (0.003) | 0.10 (0.005) / 0.11 (0.005) | +0.102 | 1.95 | yes |
| label-first | oracle | 24 | 0.33 / 0.34 | 0.06 (0.004) / 0.06 (0.004) | 0.18 (0.006) / 0.19 (0.006) | +0.152 | 1.81 |  |
| label-first | oracle | 36 | 0.40 / 0.41 | 0.08 (0.004) / 0.09 (0.004) | 0.24 (0.006) / 0.25 (0.006) | +0.164 | 1.66 |  |
| line with label | oracle | 12 | 0.27 / 0.18 | 0.05 (0.004) / 0.03 (0.003) | 0.15 (0.007) / 0.10 (0.005) | +0.081 | 1.81 | no |
| line with label | oracle | 24 | 0.44 / 0.29 | 0.09 (0.006) / 0.06 (0.004) | 0.26 (0.008) / 0.17 (0.005) | +0.121 | 1.71 |  |
| line with label | oracle | 36 | 0.54 / 0.35 | 0.12 (0.006) / 0.08 (0.004) | 0.34 (0.009) / 0.23 (0.006) | +0.128 | 1.57 |  |
| line first | oracle | 12 | 0.05 / 0.27 | 0.01 (0.001) / 0.08 (0.004) | 0.03 (0.001) / 0.18 (0.005) | +0.092 | 1.51 | no |
| line first | oracle | 24 | 0.08 / 0.43 | 0.03 (0.001) / 0.13 (0.005) | 0.06 (0.001) / 0.29 (0.006) | +0.137 | 1.46 |  |
| line first | oracle | 36 | 0.10 / 0.53 | 0.03 (0.001) / 0.17 (0.005) | 0.07 (0.001) / 0.38 (0.006) | +0.150 | 1.40 |  |

### B4. Per job, exact matching, geometry distance, suggested class, 12 pt
| job | their symbols | label-first pieces / P / R | line with label pieces / P / R | line first pieces / P / R |
|---|---|---|---|---|
| job-002 | 88 | 122 / 0.02 / 0.03 | 60 / 0.05 / 0.03 | 103 / 0.03 / 0.03 |
| job-003 | 191 | 339 / 0.15 / 0.27 | 156 / 0.31 / 0.26 | 248 / 0.20 / 0.26 |
| job-004 | 56 | 65 / 0.02 / 0.02 | 29 / 0.03 / 0.02 | 297 / 0.00 / 0.02 |
| job-005 | 216 | 133 / 0.04 / 0.02 | 117 / 0.04 / 0.02 | 426 / 0.04 / 0.07 |
| job-006 | 246 | 0 / none / 0.00 | 0 / none / 0.00 | 990 / 0.03 / 0.10 |
| job-008 | 142 | 127 / 0.19 / 0.17 | 120 / 0.20 / 0.17 | 767 / 0.06 / 0.32 |
| job-010 | 134 | 85 / 0.39 / 0.25 | 61 / 0.43 / 0.19 | 442 / 0.07 / 0.22 |
| job-011 | 183 | 91 / 0.47 / 0.23 | 59 / 0.64 / 0.21 | 124 / 0.31 / 0.21 |
| job-012 | 992 | 1,209 / 0.22 / 0.26 | 983 / 0.26 / 0.26 | 4,182 / 0.11 / 0.46 |
| job-013 | 175 | 99 / 0.43 / 0.25 | 86 / 0.49 / 0.24 | 204 / 0.22 / 0.26 |
| job-014 | 117 | 27 / 0.00 / 0.00 | 17 / 0.00 / 0.00 | 107 / 0.00 / 0.00 |
| job-015 | 804 | 1,387 / 0.24 / 0.42 | 733 / 0.44 / 0.40 | 1,752 / 0.24 / 0.53 |
| job-017 | 307 | 381 / 0.07 / 0.08 | 192 / 0.13 / 0.08 | 474 / 0.07 / 0.11 |
| job-018 | 372 | 247 / 0.07 / 0.05 | 220 / 0.08 / 0.05 | 1,588 / 0.03 / 0.12 |
| job-019 | 125 | 41 / 0.17 / 0.06 | 38 / 0.16 / 0.05 | 866 / 0.02 / 0.11 |
| job-020 | 225 | 292 / 0.25 / 0.32 | 191 / 0.37 / 0.31 | 563 / 0.10 / 0.25 |

### B5. Label-only pieces (counted labels with no linked line), matched by the label point
1,319 label-only pieces on 75 of 136 pages; by job: job-002 506, job-003 27, job-004 31, job-005 23, job-008 4, job-010 22, job-011 19, job-012 46, job-013 39, job-014 102, job-015 217, job-017 160, job-018 62, job-019 6, job-020 55

| scope | basis | linked pieces only: pieces, matched 12 / 24 / 36 pt | plus label-only points: pieces, matched 12 / 24 / 36 pt |
|---|---|---|---|
| all | label-first | 4,645: 923 / 1469 / 1774 | 5,964: 940 / 1546 / 1926 |
| all | line with label | 3,062: 883 / 1360 / 1619 | 4,381: 900 / 1437 / 1771 |
| without largest two | label-first | 2,049: 326 / 553 / 710 | 3,105: 335 / 607 / 834 |
| without largest two | line with label | 1,346: 306 / 494 / 623 | 2,402: 315 / 548 / 747 |

### What this means for Part C
The metric is fixed (this Part B metric, exact matching, geometry distance, 12 pt primary). Part C is scored against it and against the same two controls, so a gain must be read as gain over the +0.10 / +0.04 recall that alignment above chance gives to the existing line bases.

