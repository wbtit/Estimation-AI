# Phase 7 results: display basis, member-geometry re-scoring, structural grammar prototype

Pre-registration: `docs/PHASE7_PREREGISTRATION.md` (committed before any measurement; errata in its section 6). Everything is deterministic code: no LLM, no trained model, nothing pushed, the frozen linking code untouched. Part A and Part B were committed before Part C was started; Part C follows them.

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

## Part C. Structural grammar prototype

### Short answer
- **Held-out (scored once, after the freeze and the tag `phase7-grammar-frozen`): not enough.** 8,685 pieces for 1,659 symbols (52 pages, 6 jobs): precision 0.04, recall 0.19, F1 0.06 at 12 pt (24 pt: 0.06 / 0.33; 36 pt: 0.08 / 0.42). Pages within plus or minus 1: 0%. Bars: worth building needs 50% of pages and P and R 0.6; promising 30%, 0.4, 0.4. Neither is close. Without job-015, the largest held-out job: P 0.02, R 0.13, F1 0.03.
- **No signal over chance by the registered guide.** Moving the same symbols 60 to 200 pt away still gives recall 0.13 and precision 0.025 (uniform points: 0.05 and 0.009). The real recall is only +0.065 above the larger control (needs +0.10); precision is 1.5 times the control (needs 1.5). Without job-015 the recall gap is +0.008. On dev the gap is +0.077 (also below 0.10).
- **The prediction recorded before the run held:** P below 0.10, R below 0.30, nothing "promising", F1 between 0.03 and 0.12 (0.062). Held-out F1 is below dev F1 (0.090), as expected for rules developed on dev.
- **Compared with the existing label-based count** (Part B, same metric, all 136 pages): line with label F1 0.24 and recall 0.20 with 3,062 pieces. The grammar has one third of that F1 and needs 8,685 pieces for a lower recall. It does not beat the label-based count on any measure here.
- **Where it fails.** The grammar sees a parsed primitive within 24 pt of 94% of the held-out symbols, and an excluded candidate (a span the structure rules left out) within 24 pt of 87%. The exclusive miss table puts 67.5% of the symbols in "an excluded candidate within 24 pt" and only 1.2% in the "main piece 12 to 36 pt away" reasons. Structure alone (supports, role, width) cannot tell the members the estimators marked from the tens of thousands of other lines: the unfiltered rule v1 keeps 68,111 spans and reaches recall 0.55 only by being everywhere (on dev the unfiltered recall was 0.52 against 0.41 for displaced symbols).
- **Columns and posts** (scored apart): 314 main glyphs on held-out pages, 5 matched at 12 pt (P 0.016, R 0.003); even at 36 pt only R 0.03. On dev, the glyphs at grid intersections (267) matched none at 12 pt. The overlay of one dev foundation page shows why (below): the columns are found, the rings are beside them.
- **Grids** were found on only 3 of 52 held-out pages (18 of 84 dev pages) although 908 bubbles were recognised there: the anchoring by a dashed line was rare. I did not diagnose it (see unknown).

### What was built
`phase7_parse.py` (every path: stroke, fill, both, closed, curves, width, dash array, colours, the Form XObject transform stack applied by the PDF engine and checked on synthetic forms), `phase7_grammar.py` (rules: line roles per page, hatch, dashed; bubbles and grids with families from label content; column glyphs with width-profile signature and `at_grid`; X and V brace signs and dimension lines consumed before chaining; collinear chaining across gaps; splits at glyphs and member crossings; supports; unsupported spans kept, flagged, grey; every piece with evidence), `phase7_cgrammar_run.py` (dev and held-out sets, held-out guard, scoring, miss reasons, controls, overlays). 49 new synthetic tests (geometry and matching 11, including exact matching against brute force; parse 6; grammar 27, including a check that the vectorised hatch rule equals the first implementation; held-out guard 5).

### Dev log (dev jobs only; the registered grammar is the first row)
| step | change | pieces | P | R | F1 | displaced-control R |
|---|---|---|---|---|---|---|
| rev0 | rules v1 as registered | 83,922 | 0.017 | 0.521 | 0.033 | 0.406 |
| rev2 | r1 both ends supported and role medium or heavy; r2 columns main by grid or two span ends | 14,817 | 0.041 | 0.226 | 0.070 | 0.141 |
| rev3 | r3 side-by-side spans are one piece | 10,840 | 0.052 | 0.207 | 0.083 | 0.131 |
| rev4 | r4 three span ends for a column without a grid (frozen) | 9,606 | 0.058 | 0.205 | 0.090 | 0.128 |
Four of five revisions used; r4 gave +0.007 (below the 0.01 stop rule). All variants examined on dev, kept or not, are listed in the pre-registration, section 7.2. Before any real drawing: two errata (hatch edge lines; tick role), logged in section 6 of the pre-registration. One performance rewrite (the hatch rule, vectorised, tested equal to the first implementation).

### Deviations, stated plainly
- **Overlays: 5 + 1 held-out.** Only 5 of the 6 held-out jobs have a page with at least 20 symbols, so the registered rule (one page per job) gives 5 held-out images. The sixth is a second page (job-015, page 8) drawn by seed 7402 with a separate tool, written after the single held-out run (the frozen driver was not edited).
- **The held-out jobs were seen before** (6b and 6c pictures); no rule was taken from a specific held-out page (pre-registration section 0).
- **The 6b page-map uncertainty** (13 pages, 3.2% of symbols) is not corrected in any figure.
- **Variants and diagnostics on dev** were many (listed); the dev numbers are therefore optimistic and are not evidence of quality. Only the held-out table is.

### C1. Held-out (single run, 6 jobs, 52 pages)

#### all held-out pages
| piece set | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|
| linear: main spans | 8,371 | 0.04 / 0.19 / 0.06 | 0.06 / 0.32 | 0.08 / 0.41 | 0% / 2% / 4% | not enough |
| columns: main glyphs | 314 | 0.02 / 0.00 / 0.01 | 0.05 / 0.01 | 0.14 / 0.03 | 2% / 17% / 8% | not enough |
| combined: spans + columns | 8,685 | 0.04 / 0.19 / 0.06 | 0.06 / 0.33 | 0.08 / 0.42 | 0% / 0% / 4% | not enough |
| sens.: v1 main rule (>= 1 end, any role) | 68,111 | 0.01 / 0.55 / 0.03 | 0.02 / 0.77 | 0.02 / 0.86 | 0% / 0% / 0% | not enough |
| sens.: every span kept (v1 keep-everything) | 81,044 | 0.01 / 0.66 / 0.03 | 0.02 / 0.85 | 0.02 / 0.92 | 0% / 0% / 0% | not enough |
| sens.: every glyph | 11,282 | 0.01 / 0.08 / 0.02 | 0.03 / 0.22 | 0.05 / 0.36 | 0% / 2% / 6% | not enough |
| sens.: combined + brace signs | 9,486 | 0.03 / 0.20 / 0.06 | 0.06 / 0.34 | 0.08 / 0.43 | 0% / 2% / 8% | not enough |

| chance control (combined set, 20 replicates) | P / R at 12 pt | P / R at 24 pt | P / R at 36 pt |
|---|---|---|---|
| real symbols | 0.04 / 0.19 | 0.06 / 0.33 | 0.08 / 0.42 |
| uniform | 0.01 / 0.05 | 0.02 / 0.09 | 0.02 / 0.12 |
| displaced | 0.02 / 0.13 | 0.04 / 0.22 | 0.06 / 0.30 |

Registered reading guide at 12 pt: recall gap over the larger control +0.065 (needs +0.10), precision ratio 1.50 (needs 1.5): **no signal over chance**.

Matched at 12 pt by kind: {'span': 319, 'column': 3}. Pages with a usable grid: 3 of 52.

| miss reason for each symbol (one, fixed order) | symbols | share |
|---|---|---|
| matched | 322 | 19.4% |
| 1 outside the view box | 6 | 0.4% |
| 2 no parsed primitive within 24 pt | 102 | 6.1% |
| 3 only consumed primitives within 24 pt | 5 | 0.3% |
| 4 an excluded candidate within 24 pt | 1,120 | 67.5% |
| 5 a main piece within 12 pt, taken by another symbol | 0 | 0.0% |
| 6 a main piece 12 to 24 pt away | 8 | 0.5% |
| 7 a main piece 24 to 36 pt away | 11 | 0.7% |
| 8 other | 85 | 5.1% |

Overlapping flags (not exclusive, of 1,659 symbols): {'near_any_primitive_24': 1557, 'near_main_piece_12': 350, 'near_main_piece_24': 598, 'near_excluded_candidate_24': 1437}.

Parse and grammar counts: 582,712 primitives, 544,607 straight segments, 214 Form XObject calls, 908 bubbles, 62 grid lines, 11,282 glyphs (314 main), 81,044 spans (8,371 main, 68,111 under the v1 rule), 801 brace signs. Segments consumed before chaining: {'bubble_or_glyph_edges': 10517, 'dimension': 1700, 'hatch_or_short': 434606, 'brace_sign': 1602, 'grid': 3747}.

#### held-out without job-015
| piece set | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|
| linear: main spans | 5,632 | 0.02 / 0.13 / 0.03 | 0.04 / 0.25 | 0.05 / 0.35 | 0% / 3% / 6% | not enough |
| columns: main glyphs | 233 | 0.02 / 0.00 / 0.01 | 0.05 / 0.01 | 0.12 / 0.03 | 3% / 22% / 6% | not enough |
| combined: spans + columns | 5,865 | 0.02 / 0.13 / 0.03 | 0.04 / 0.25 | 0.05 / 0.36 | 0% / 0% / 6% | not enough |
| sens.: v1 main rule (>= 1 end, any role) | 47,251 | 0.01 / 0.43 / 0.02 | 0.01 / 0.67 | 0.01 / 0.79 | 0% / 0% / 0% | not enough |
| sens.: every span kept (v1 keep-everything) | 53,909 | 0.01 / 0.53 / 0.02 | 0.01 / 0.77 | 0.01 / 0.86 | 0% / 0% / 0% | not enough |
| sens.: every glyph | 5,669 | 0.01 / 0.06 / 0.02 | 0.03 / 0.17 | 0.04 / 0.29 | 0% / 3% / 6% | not enough |
| sens.: combined + brace signs | 6,257 | 0.02 / 0.13 / 0.03 | 0.04 / 0.26 | 0.05 / 0.37 | 0% / 3% / 8% | not enough |

| chance control (combined set, 20 replicates) | P / R at 12 pt | P / R at 24 pt | P / R at 36 pt |
|---|---|---|---|
| real symbols | 0.02 / 0.13 | 0.04 / 0.25 | 0.05 / 0.36 |
| uniform | 0.01 / 0.04 | 0.01 / 0.07 | 0.01 / 0.10 |
| displaced | 0.02 / 0.12 | 0.03 / 0.20 | 0.04 / 0.27 |

Registered reading guide at 12 pt: recall gap over the larger control +0.008 (needs +0.10), precision ratio 1.07 (needs 1.5): **no signal over chance**.

Matched at 12 pt by kind: {'span': 106, 'column': 2}. Pages with a usable grid: 3 of 36.

| miss reason for each symbol (one, fixed order) | symbols | share |
|---|---|---|
| matched | 108 | 12.6% |
| 1 outside the view box | 0 | 0.0% |
| 2 no parsed primitive within 24 pt | 89 | 10.4% |
| 3 only consumed primitives within 24 pt | 4 | 0.5% |
| 4 an excluded candidate within 24 pt | 572 | 66.9% |
| 5 a main piece within 12 pt, taken by another symbol | 0 | 0.0% |
| 6 a main piece 12 to 24 pt away | 6 | 0.7% |
| 7 a main piece 24 to 36 pt away | 11 | 1.3% |
| 8 other | 65 | 7.6% |

Overlapping flags (not exclusive, of 855 symbols): {'near_any_primitive_24': 766, 'near_main_piece_12': 125, 'near_main_piece_24': 243, 'near_excluded_candidate_24': 678}.

Parse and grammar counts: 373,507 primitives, 362,503 straight segments, 214 Form XObject calls, 456 bubbles, 62 grid lines, 5,669 glyphs (233 main), 53,909 spans (5,632 main, 47,251 under the v1 rule), 392 brace signs. Segments consumed before chaining: {'bubble_or_glyph_edges': 7880, 'brace_sign': 784, 'hatch_or_short': 286725, 'dimension': 1242, 'grid': 3747}.

### C2. Dev (frozen rules, 10 jobs, 84 pages; for comparison only)

#### all dev pages
| piece set | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|
| linear: main spans | 9,083 | 0.06 / 0.20 / 0.09 | 0.09 / 0.31 | 0.12 / 0.40 | 0% / 0% / 4% | not enough |
| columns: main glyphs | 523 | 0.03 / 0.01 / 0.01 | 0.08 / 0.02 | 0.16 / 0.03 | 4% / 11% / 6% | not enough |
| combined: spans + columns | 9,606 | 0.06 / 0.21 / 0.09 | 0.09 / 0.32 | 0.11 / 0.41 | 0% / 0% / 4% | not enough |
| sens.: v1 main rule (>= 1 end, any role) | 70,019 | 0.02 / 0.50 / 0.04 | 0.03 / 0.67 | 0.03 / 0.76 | 0% / 0% / 0% | not enough |
| sens.: every span kept (v1 keep-everything) | 81,654 | 0.02 / 0.55 / 0.04 | 0.02 / 0.72 | 0.03 / 0.82 | 0% / 0% / 0% | not enough |
| sens.: every glyph | 13,674 | 0.01 / 0.07 / 0.02 | 0.04 / 0.19 | 0.06 / 0.30 | 0% / 0% / 2% | not enough |
| sens.: combined + brace signs | 10,477 | 0.05 / 0.21 / 0.09 | 0.09 / 0.33 | 0.11 / 0.42 | 0% / 0% / 4% | not enough |

| chance control (combined set, 20 replicates) | P / R at 12 pt | P / R at 24 pt | P / R at 36 pt |
|---|---|---|---|
| real symbols | 0.06 / 0.21 | 0.09 / 0.32 | 0.11 / 0.41 |
| uniform | 0.02 / 0.07 | 0.03 / 0.12 | 0.05 / 0.16 |
| displaced | 0.04 / 0.13 | 0.06 / 0.21 | 0.08 / 0.28 |

Registered reading guide at 12 pt: recall gap over the larger control +0.077 (needs +0.10), precision ratio 1.60 (needs 1.5): **no signal over chance**.

Matched at 12 pt by kind: {'span': 548, 'column': 9}. Pages with a usable grid: 18 of 84.

| miss reason for each symbol (one, fixed order) | symbols | share |
|---|---|---|
| matched | 557 | 20.5% |
| 1 outside the view box | 39 | 1.4% |
| 2 no parsed primitive within 24 pt | 315 | 11.6% |
| 3 only consumed primitives within 24 pt | 52 | 1.9% |
| 4 an excluded candidate within 24 pt | 1,447 | 53.3% |
| 5 a main piece within 12 pt, taken by another symbol | 3 | 0.1% |
| 6 a main piece 12 to 24 pt away | 21 | 0.8% |
| 7 a main piece 24 to 36 pt away | 41 | 1.5% |
| 8 other | 239 | 8.8% |

Overlapping flags (not exclusive, of 2,714 symbols): {'near_any_primitive_24': 2387, 'near_main_piece_12': 615, 'near_main_piece_24': 966, 'near_excluded_candidate_24': 1987}.

Parse and grammar counts: 1,334,519 primitives, 1,629,647 straight segments, 1,081 Form XObject calls, 599 bubbles, 245 grid lines, 13,674 glyphs (523 main), 81,654 spans (9,083 main, 70,019 under the v1 rule), 871 brace signs. Segments consumed before chaining: {'bubble_or_glyph_edges': 30531, 'brace_sign': 1742, 'dimension': 3582, 'hatch_or_short': 1419878, 'grid': 36084}.

#### dev without job-012
| piece set | pieces | P / R / F1 at 12 pt | P / R at 24 pt | P / R at 36 pt | pages equal / within 1 / within 20% | verdict |
|---|---|---|---|---|---|---|
| linear: main spans | 7,172 | 0.04 / 0.15 / 0.06 | 0.06 / 0.26 | 0.08 / 0.34 | 0% / 0% / 5% | not enough |
| columns: main glyphs | 495 | 0.02 / 0.01 / 0.01 | 0.07 / 0.02 | 0.14 / 0.04 | 5% / 14% / 8% | not enough |
| combined: spans + columns | 7,667 | 0.04 / 0.16 / 0.06 | 0.06 / 0.27 | 0.08 / 0.36 | 0% / 0% / 5% | not enough |
| sens.: v1 main rule (>= 1 end, any role) | 58,543 | 0.01 / 0.41 / 0.02 | 0.02 / 0.57 | 0.02 / 0.68 | 0% / 0% / 0% | not enough |
| sens.: every span kept (v1 keep-everything) | 66,675 | 0.01 / 0.46 / 0.02 | 0.02 / 0.64 | 0.02 / 0.74 | 0% / 0% / 0% | not enough |
| sens.: every glyph | 12,297 | 0.01 / 0.07 / 0.02 | 0.03 / 0.19 | 0.04 / 0.30 | 0% / 0% / 0% | not enough |
| sens.: combined + brace signs | 8,533 | 0.03 / 0.16 / 0.05 | 0.06 / 0.28 | 0.08 / 0.38 | 0% / 0% / 5% | not enough |

| chance control (combined set, 20 replicates) | P / R at 12 pt | P / R at 24 pt | P / R at 36 pt |
|---|---|---|---|
| real symbols | 0.04 / 0.16 | 0.06 / 0.27 | 0.08 / 0.36 |
| uniform | 0.01 / 0.06 | 0.02 / 0.10 | 0.03 / 0.14 |
| displaced | 0.03 / 0.13 | 0.05 / 0.22 | 0.06 / 0.29 |

Registered reading guide at 12 pt: recall gap over the larger control +0.026 (needs +0.10), precision ratio 1.20 (needs 1.5): **no signal over chance**.

Matched at 12 pt by kind: {'span': 262, 'column': 7}. Pages with a usable grid: 18 of 65.

| miss reason for each symbol (one, fixed order) | symbols | share |
|---|---|---|
| matched | 269 | 15.6% |
| 1 outside the view box | 17 | 1.0% |
| 2 no parsed primitive within 24 pt | 299 | 17.4% |
| 3 only consumed primitives within 24 pt | 39 | 2.3% |
| 4 an excluded candidate within 24 pt | 860 | 49.9% |
| 5 a main piece within 12 pt, taken by another symbol | 3 | 0.2% |
| 6 a main piece 12 to 24 pt away | 20 | 1.2% |
| 7 a main piece 24 to 36 pt away | 31 | 1.8% |
| 8 other | 184 | 10.7% |

Overlapping flags (not exclusive, of 1,722 symbols): {'near_any_primitive_24': 1411, 'near_main_piece_12': 322, 'near_main_piece_24': 552, 'near_excluded_candidate_24': 1105}.

Parse and grammar counts: 1,163,660 primitives, 1,303,272 straight segments, 1,062 Form XObject calls, 492 bubbles, 243 grid lines, 12,297 glyphs (495 main), 66,675 spans (7,172 main, 58,543 under the v1 rule), 866 brace signs. Segments consumed before chaining: {'bubble_or_glyph_edges': 24461, 'brace_sign': 1732, 'dimension': 1618, 'hatch_or_short': 1133345, 'grid': 36014}.

### C3. Per job, combined set, exact matching, 12 pt
| side | job | their symbols | pieces | P | R | F1 |
|---|---|---|---|---|---|---|
| held-out | job-004 | 56 | 1,639 | 0.01 | 0.23 | 0.02 |
| held-out | job-008 | 142 | 627 | 0.02 | 0.07 | 0.03 |
| held-out | job-015 | 804 | 2,820 | 0.08 | 0.27 | 0.12 |
| held-out | job-017 | 307 | 899 | 0.04 | 0.11 | 0.06 |
| held-out | job-019 | 125 | 1,343 | 0.00 | 0.03 | 0.01 |
| held-out | job-020 | 225 | 1,357 | 0.03 | 0.21 | 0.06 |
| dev | job-002 | 88 | 114 | 0.00 | 0.00 | none |
| dev | job-003 | 191 | 632 | 0.07 | 0.25 | 0.11 |
| dev | job-005 | 216 | 905 | 0.01 | 0.02 | 0.01 |
| dev | job-006 | 246 | 1,155 | 0.01 | 0.05 | 0.02 |
| dev | job-010 | 134 | 1,187 | 0.04 | 0.33 | 0.07 |
| dev | job-011 | 183 | 1,025 | 0.09 | 0.49 | 0.15 |
| dev | job-012 | 992 | 1,939 | 0.15 | 0.29 | 0.20 |
| dev | job-013 | 175 | 234 | 0.06 | 0.07 | 0.06 |
| dev | job-014 | 117 | 920 | 0.00 | 0.03 | 0.01 |
| dev | job-018 | 372 | 1,495 | 0.04 | 0.15 | 0.06 |


### What the overlays show
12 images in `fixtures/private/shots/phase7/` (git-ignored; `INDEX-dev.json` and `INDEX-held-out.json` list job and page): `dev-01` to `dev-06` and `held-out-01` to `held-out-06`. Blue = supported span, grey = unsupported span or off-grid glyph, orange square = a support, green box = main column glyph, purple = grid line and bubble, yellow X = brace sign, red ring = estimator symbol. I looked at four of the twelve (`dev-03`, `dev-05`, `held-out-02`, `held-out-04`); the other eight I did not view, so nothing below is claimed for them.
- **`dev-03` (a foundation plan with a grid).** The grammar does what it was designed to do: it finds the grid (bubbles and dash-dot lines), 42 column glyphs on the intersections and a short blue line from each column towards its tag. The estimator rings are not on any of it: they sit to the left of each column by 22 to 56 pt (median 36 pt; offset of the column from the ring (dx, dy) = (+35, +11) pt with a spread of 8 and 3 pt). Within 12 pt of a column: 0 of 32 rings; 24 pt: 6%; 36 pt: 50%; 48 pt: 97%. This is a single dev page and one job; it is the clearest sign in this phase that for column symbols the 12 pt yardstick, not the geometry, can be the problem.
- **`held-out-02` (a framing plan, enlarged).** Nearly every line of the drawing is a blue supported span; the rings are a few dozen on the left part. The grammar covers the whole sheet and cannot say which of thousands of members are marked.
- **`held-out-04` (a small framing plan on a large sheet).** The deck hatching and the dense small framing turn into thousands of spans and orange supports; the rings sit in the lower half of the plan on the beam lines. Large diagonal hatch fields that are drawn with long strokes are not caught by the hatch rule (which covers parallel segments up to 400 pt with 4 neighbours) and become members.
- **`dev-05` (a framing plan with labelled beams).** The rings are on or beside the labelled beams along the left bays; spans are present on them, but so are spans on every wall, stair and detail; columns are few.

## Proven, likely, unknown (Phase 7 as a whole)
**Proven (measured):**
- The Phase 6b scoring was already segment-based; the Phase 6b figures are reproduced exactly. The exact one-to-one rule adds 1% to 3% matches at 12 pt (up to 6% at 36 pt).
- Our displayed dot (label centre) matches the estimators' symbols only about a third as often as the linked line does (recall 0.09 against 0.21 at 12 pt for label-first).
- On these dense pages a chance control (symbols displaced 60 to 200 pt) reaches about half of the real 12 pt recall of every existing basis, so about half of the 12 pt matches in Phases 6b and 6c are what a similar layout gets anyway. Alignment above chance: +0.10 recall over all pages, +0.04 without the two largest jobs.
- The frozen grammar on the held-out jobs: P 0.04, R 0.19, F1 0.06 at 12 pt, no signal over chance by the registered guide, below the labelled count of Part B on every measure.
- The display basis is now one piece per linked line (with the labels shown beside); the stray project was not deleted because its counts are not all zero.

**Likely (supported, not proven):**
- Structure (supports, widths, role classes) cannot select the estimators' members without a second signal such as the size label; 87% of the held-out symbols have an excluded structural candidate within 24 pt.
- For column and footing symbols, the estimators' ring is placed beside the column or tag at a fairly constant offset, so a 12 pt match to the glyph will not find them (one dev page; not tested on other jobs).

**Unknown:**
- Whether the column offset is the same across jobs, and what the ring marks (the column, the footing, or its tag).
- Why only 62 of 908 held-out bubbles anchored a dashed grid line (solid grid lines, a different dash form, or too far); not diagnosed.
- Whether gating grammar spans by a profile label (the evidence field is already stored) would give a usable count; it was not tested because the registered main total does not use labels.
- The held-out set is now used once; a further grammar test needs new marked drawings or a cross-validation by job.

## Decisions for the owner
See OPEN_QUESTIONS 108 to 111.

## Tests and checks
Lint clean (ruff check and format, eslint, tsc, prettier on the API and web). Last full run: API 491 passed (40 files, with the database), worker 564 passed, web 48 passed. The studies themselves run on private drawings and are not part of the suites.

Processes (PIDs recorded, stopped by PID): the read-only API on port 3100 for Part B (stopped), the Part B build and scoring runs, the Part C dev runs (rev0 to rev4), the single held-out run, the overlay run; a first dev run was stopped by its PID when one dense page was too slow (the hatch rule was then vectorised). All have exited; nothing of mine is running. The API on port 3000 was not touched.

