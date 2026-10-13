# Phase 6b results: position-level scoring, three count bases, coverage limits

> **Correction (Phase 6c, `docs/PHASE6C_RESULTS.md` section 0).** Everywhere this document says "no extracted line within 24 pt", read "no line of the SUGGESTED class within 24 pt": the Phase 6b test looked only at the structural lines of the suggested class. Lines of other classes are often near those symbols (70% of them, see Phase 6c). The figures (P, R, F1, pages equal) are unchanged; the conclusion "the lines are not where the estimators count" and the third row of the decision table are not supported as written.

Pre-registration: `docs/PHASE6B_PREREGISTRATION.md` (committed before the measurement, nothing changed after). Part A (owner decisions) is committed separately (`972a317`) and is described at the end. Everything is deterministic code; no LLM, no third-party API, nothing pushed. Figures are reported as measured; no tolerance, radius, merge rule or bar was changed after seeing them.

Data: the same 16 jobs, the same 136 pages where the estimators placed at least one count symbol (4,373 symbols), the same page mapping, the page rotation applied. All 136 pages are vector pages (no raster page among them). Pipeline re-run with Part A defaults (every vector sheet in): 16 jobs, 19.4 minutes in total (median 0.75, longest 4.3).

## 1. Short answer
- **No basis reaches even "promising".** Best result at 12 pt: precision 0.29 and recall 0.20 (line with label), page agreement within plus or minus 1 on 14% of pages. The bars were 50% of pages and 0.6 (worth building on) or 30% and 0.4 (promising).
- **The biggest single cause is that nothing we extract is near their symbol.** For 47.5% of their symbols (2,078 of 4,373) there is no extracted line within 24 pt at all. This is not a count-basis problem and not a class problem; a line method cannot reach those symbols.
- **Count basis is the second cause, and it works on precision, not recall.** One piece per label puts 2,115 of our 3,730 unmatched pieces on a line that already has a piece. One piece per linked line raises precision from 0.20 to 0.29 at the same recall.
- **Class choice is small.** Choosing the best class per page after the fact (the oracle, an upper bound that uses their symbols) lifts F1 at 12 pt by 5 to 6 points for the two label-based bases and by less than 1 point for line first.
- **Page selection mattered, but it is now fixed.** Including every vector sheet raised recall at 12 pt from 0.14 to 0.21.
- **Raster pages: 0% of their symbols** on these 136 pages.
- By the pre-registered decision table, the third row applies: recall at 24 pt is below 0.6 for every basis (best 0.53, an oracle) and the share of their symbols off any line is above 0.4. **The lines are not where the estimators count; the next build should not be a line method.**

## 2. Stage 1 figures kept for comparison, and the same pages after Part A
Stage 1 (page type default, label-first, positions stored in the Phase 6a projects, scored at 12 pt):

| | pieces | precision | recall | F1 |
|---|---|---|---|---|
| Stage 1 (66 of 136 pages left out by default) | 2,718 | 0.23 | 0.14 | 0.18 |
| Part A defaults (every vector sheet in), label-first | 4,645 | 0.20 | 0.21 | 0.20 |

- Of the 3,750 symbols of theirs that Stage 1 did not match, 2,082 were on sheets where Stage 1 had no pieces (sheet excluded). That reason sits fifth in the registered order, so the exclusive miss table below cannot show it; the overlapping count is given here instead. After Part A, 292 more of their symbols are matched (915 against 623). So most symbols on the previously excluded sheets are still not matched (about 86%), for the reasons in section 3.
- Pages equal / within 1 / within 20%: Stage 1 4 / 12 / 15 pages (2.9% / 8.8% / 11.0%); Part A, label-first, suggested class: 7 / 18 / 26 pages (5.1% / 13.2% / 19.1%).
- Consistency check (our in-process recomputation against what the live system draws): equal on 124 of 136 pages; the other 12 pages differ by 1 to 4 pieces; total 4,660 live against 4,645 here (0.3%). The in-process figures are used for all tables.

## 3. Part B: position-level scoring of the label-first count (suggested class, all 136 pages)
One-to-one matching, greedy by ascending distance (pre-registered), the radius 12 pt as primary.

| radius | precision | recall | F1 | matched |
|---|---|---|---|---|
| 6 pt | 0.11 | 0.11 | 0.11 | 488 |
| 12 pt | 0.20 | 0.21 | 0.20 | 915 |
| 24 pt | 0.31 | 0.33 | 0.32 | 1,438 |

### By colour (pieces matched at 12 pt)
| our colour | pieces | matched | share |
|---|---|---|---|
| green | 135 | 45 | 33% |
| amber | 2,501 | 544 | 22% |
| red | 2,009 | 326 | 16% |

Colour points the right way (green is matched more often than amber, amber more than red) but only 135 pieces are green, so colour does not rescue precision.

### Per job (12 pt, label-first; the other two bases for comparison)
| job | pages | theirs | label-first pieces | P | R | F1 | line-with-label F1 | line-first F1 |
|---|---|---|---|---|---|---|---|---|
| job-002 | 2 | 88 | 122 | 0.02 | 0.03 | 0.03 | 0.04 | 0.03 |
| job-003 | 4 | 191 | 339 | 0.15 | 0.27 | 0.20 | 0.28 | 0.23 |
| job-004 | 5 | 56 | 65 | 0.02 | 0.02 | 0.02 | 0.02 | 0.01 |
| job-005 | 15 | 216 | 133 | 0.04 | 0.02 | 0.03 | 0.03 | 0.05 |
| job-006 | 6 | 246 | 0 | none | 0.00 | none | none | 0.04 |
| job-008 | 6 | 142 | 127 | 0.19 | 0.17 | 0.18 | 0.18 | 0.10 |
| job-010 | 8 | 134 | 85 | 0.39 | 0.25 | 0.30 | 0.27 | 0.10 |
| job-011 | 2 | 183 | 91 | 0.47 | 0.23 | 0.31 | 0.31 | 0.25 |
| job-012 | 19 | 992 | 1,209 | 0.21 | 0.26 | 0.23 | 0.25 | 0.17 |
| job-013 | 6 | 175 | 99 | 0.42 | 0.24 | 0.31 | 0.32 | 0.24 |
| job-014 | 8 | 117 | 27 | 0.00 | 0.00 | none | none | none |
| job-015 | 16 | 804 | 1,387 | 0.24 | 0.41 | 0.30 | 0.42 | 0.32 |
| job-017 | 7 | 307 | 381 | 0.07 | 0.08 | 0.07 | 0.10 | 0.08 |
| job-018 | 14 | 372 | 247 | 0.07 | 0.05 | 0.05 | 0.06 | 0.04 |
| job-019 | 11 | 125 | 41 | 0.17 | 0.06 | 0.08 | 0.07 | 0.03 |
| job-020 | 7 | 225 | 292 | 0.25 | 0.32 | 0.28 | 0.34 | 0.14 |

The spread is large: five jobs are at 0.28 to 0.31 F1, six are below 0.10. "none" means no match was possible (no pieces, or no matched piece).
- **job-006:** the pipeline produced no pieces on any of its 6 pages (no member at all in the live system), although the pages have a text layer and a scale was read on most of them. I did not find the cause (a check of the source file was not done; see section 9). It is one of the largest single contributors of lost recall (246 symbols, 5.6% of all).
- **job-014:** 27 pieces, none within 12 pt of a symbol. Cause not investigated.

### By the estimators' colour plus shape group
23 groups exist; the 9 largest (colour as three channel values, number of corners of the shape):
| group (colour / corners) | their symbols | matched, label-first, 12 pt |
|---|---|---|
| 1.00 0.00 1.00 / 8 | 2,034 | 755 (37%) |
| 0.00 0.00 1.00 / 3 | 834 | 54 (6%) |
| 0.50 0.00 0.50 / 3 | 367 | 19 (5%) |
| 1.00 0.40 0.00 / 3 | 325 | 39 (12%) |
| 1.00 0.00 0.00 / 3 | 151 | 9 (6%) |
| 0.11 0.18 0.51 / 3 | 150 | 9 (6%) |
| 0.00 1.00 1.00 / 3 | 92 | 0 |
| 0.20 0.40 1.00 / 8 | 84 | 6 (7%) |
| 0.00 1.00 0.00 / 3 | 79 | 2 (3%) |

Of the 915 matches, 755 (83%) come from one group (the largest, 46.5% of their symbols, 8-cornered shapes). The 3-cornered groups together are 48% of their symbols (2,081) and are matched in 6.5% of cases (136); the 8-cornered groups are 52% (2,292) and are matched in 34% (779). I do not know what each group means to the estimators; the meaning is not in the data and is an open question.

### Miss reasons: one per unmatched symbol of theirs, fixed order (4,373 symbols)
| reason (registered order) | symbols | share |
|---|---|---|
| matched | 915 | 20.9% |
| raster page | 0 | 0% |
| no extracted line within 24 pt | 2,078 | 47.5% |
| unlinked (no label reached the line) | 381 | 8.7% |
| linked to another line (labels reach it but chose other lines) | 295 | 6.7% |
| sheet excluded (pre-Part-A run only; see section 2: 2,082 overlapping) | n/a | n/a |
| other: linked piece is 12 to 24 pt away | 402 | 9.2% |
| other: several symbols on one linked line (one piece cannot match several) | 302 | 6.9% |

The two "other" sub-reasons are my split of the registered "other"; they are exclusive and sum to the registered "other" (704, 16.1%).

### Unmatched pieces of ours (4,645 pieces on the 136 pages; 3,730 unmatched)
| reason | pieces |
|---|---|
| page has no symbols of theirs | 0 on these pages (see below) |
| extra piece on a shared line | 2,115 |
| no symbol of theirs within 24 pt | 1,145 |
| other | 470 |

On the other 194 mapped pages (the estimators placed no symbol there) the pipeline drew another 817 pieces, which are outside the 136-page tables above.

## 4. Part C: three count bases, same pages, same matching rule
Suggested class = the worker's suggested class per view. Oracle = the best class per page by F1 at 12 pt, chosen after seeing their symbols: an upper bound, not a usable method. All 136 pages.

| basis | class | pieces | equal | within 1 | within 20% | P 12 pt | R 12 pt | F1 12 pt | P / R 24 pt | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| label-first | suggested | 4,645 | 5.1% | 13.2% | 19.1% | 0.20 | 0.21 | 0.20 | 0.31 / 0.33 | not enough |
| label-first | oracle | 5,419 | 9.6% | 20.6% | 25.0% | 0.23 | 0.29 | 0.26 | 0.35 / 0.43 | not enough |
| line with label | suggested | 3,062 | 5.9% | 14.0% | 19.9% | 0.29 | 0.20 | 0.24 | 0.43 / 0.30 | not enough |
| line with label | oracle | 3,476 | 12.5% | 22.1% | 30.1% | 0.33 | 0.26 | 0.29 | 0.48 / 0.38 | not enough |
| line first | suggested | 13,133 | 2.2% | 5.1% | 12.5% | 0.10 | 0.29 | 0.14 | 0.14 / 0.42 | not enough |
| line first | oracle | 16,763 | 2.9% | 8.1% | 14.7% | 0.10 | 0.37 | 0.15 | 0.14 / 0.53 | not enough |

Totals against theirs (4,373): label-first 4,645 (106%), line with label 3,062 (70%), line first 13,133 (300%).

Colour (where a basis has colour): line with label, matched at 12 pt: green 45 of 135, amber 433 of 1,404 (31%), red 398 of 1,523 (26%). Line first has no colour.

Line first, their symbols against our merged lines (structural lines of the suggested class, merge rule fixed in the pre-registration): of the 1,476 of their symbols that sit within 12 pt of such a line, 656 sit on a single (unmerged) line, 423 on a merged line and 397 on a split remainder; the other 2,897 sit on no such line. The line-first basis has 2,404 lines carrying a label of ours out of 13,133.

Which basis is best against the bars: none passes. On F1 and on pages, line with label is best (suggested and oracle). On recall alone, line first is best (0.29, oracle 0.37) because it has 3 times as many pieces, which also gives it the worst precision (0.10).

## 5. Which cause explains most of the disagreement
Shares of their 4,373 symbols (exclusive, fixed order):
1. **No extracted line within 24 pt: 47.5%.** The estimators' symbols are mostly not on a line that our extraction sees at all. Coverage detail below.
2. **Label to line coverage: 24.6%** (unlinked 8.7%, linked to another line 6.7%, linked piece 12 to 24 pt away 9.2%).
3. **Count basis: 6.9%** of recall (several of their symbols on one linked line), and on the precision side 2,115 of our 3,730 unmatched pieces (57%) share a line.
4. **Class choice:** the oracle adds +0.06 F1 for label-first and +0.05 for line with label. Small.
5. **Page selection:** was the largest loss in Stage 1 (2,082 of 3,750 missed symbols were on excluded sheets); fixed by Part A, with 14% of those symbols now matched.
6. **Raster:** none on these pages.

Plain reading: roughly half of what the estimators count is somewhere a line method cannot reach, a quarter is reachable but our label-to-line step picks a different line or sits too far, and the count basis and the class choice are small effects compared to those two.

## 6. Part D: coverage limits
- Their symbols on raster pages: 0 of 4,373 (0%). Pages with no structural line of the suggested class at all: 0 of the 136.
- On an extracted line within 12 pt: 1,517 (34.7%); within 24 pt: 2,295 (52.5%); no line within 24 pt: 2,078 (47.5%). Outside the view box: 45. Inside a small closed shape (40 pt or less) with no line within 12 pt: 10 (the column-style shapes are a small share here). Note the Phase 5t expectation (33% at 12 pt) held (34.7%).
- The ceiling seen for a line method: the best recall at 24 pt is 0.53 (line first, oracle, 16,763 pieces), the same as the 52.5% of symbols that have a line within 24 pt.
- **Human-made position data.** 4,373 symbols on 136 pages in 16 jobs. Per job: 56 to 992 (two jobs hold 1,796 symbols, 41%). Per colour+shape group: 23 groups; one holds 2,034 (46.5%), five hold 150 to 834, 17 hold fewer than 150 and 9 of those fewer than 20. Enough to start a detector for the one big group and to judge it; not enough for the rest without more human-marked drawings. Nothing was trained or built.

## 7. Part E: 12 pictures
Rendered to `fixtures/private/shots/phase6b/` (git-ignored; index in `INDEX.json`). Blue rings = their symbols, red dots = label-first pieces, green lines = line with label, orange lines = structural lines. Files:
- Agreement (smallest relative difference over the three bases): `agree-job-013-p9.png`, `agree-job-008-p6.png`, `agree-job-018-p12.png`, `agree-job-015-p16.png`, `agree-job-010-p7.png`, `agree-job-015-p15.png`.
- Largest disagreement: `disagree-job-006-p6.png`, `disagree-job-018-p17.png`, `disagree-job-012-p29.png`, `disagree-job-010-p21.png`, `disagree-job-019-p19.png`, `disagree-job-019-p3.png`.

Dominant causes, from looking at all 12:
1. **A count that agrees is often a coincidence of totals.** On the six "agree" pages the rings sit beside the members, on joist-girder and truss lines, on column ends at grid lines and on small posts, while our dots sit on size labels. Only about a third of the rings are next to a dot. Two of the six pages have rings on things we never model (trusses, post rows seen from above).
2. **They count what the scope needs, not everything drawn.** On a section sheet the estimators marked only the braces (2 rings per brace pair, 10 in total) while we drew 30 pieces on every labelled beam and column. On a connection-detail sheet they marked only the diagonal braces (14) and we drew 57 dots over the details.
3. **Label dots are not on the member.** In plan views our dot is on the size text; their ring is on the beam line itself, usually 12 to 40 pt away (the 12 to 24 pt miss group), and where the label is rotated or sits in an open bay the line is far.
4. **Small shapes and clusters.** On a foundation plan 14 rings sit in one small cluster of posts (a louver wall structure) and our only dot is a note label next to it. On roof-section details the rings sit on bent plates and angles beside the label, not on an extracted line.
5. **Wall posts.** On a wood-framed podium plan the rings are at the ends of walls (posts) and our dots are on diagonal label text away from them.
6. **One job produced nothing.** The largest-disagreement picture of job-006 has no dot at all although its labels are plain text on the page.

## 8. What did not work, what is risky
- Label-to-line linking (frozen) reaches the right line for a minority of their symbols; most of the rest are not near any line.
- Colour as a confidence signal is directionally right (33%, 22%, 16%) but too coarse to filter pieces.
- Line first as a count: 13,133 pieces for 4,373 symbols; precision 0.10. Merge rules (1 degree, 1 pt, 12 pt gap) did not make it usable; 27% of their symbols on a line sit on a split remainder.
- job-006 (0 pieces) and job-014 (0 matches) show one more unexplained failure class.
- Risk in the evidence: their symbols are the estimator's click, not the true member position; matching at 12 pt can match the wrong member; matched positions do not prove kind or size; the pages are the ones the estimators chose; one job group dominates the data (two jobs hold 41% of symbols); radius and bars were set before the data but 12 pt is itself a judgement.
- The meaning of the shape groups to the estimators is unknown to me.

## 9. Recommendation for the next build (not started)
Proven (measured here, 16 jobs, 136 pages):
- On these drawings, no line-based count basis comes near the bars; the best F1 is 0.24 (0.29 with an oracle class).
- Their symbols are not on extracted lines for 47.5% of cases; the best recall of any line basis at 24 pt is 0.53.
- Class choice is a small factor; raster is not a factor on these 136 pages.
- One piece per linked line is better than one per label (precision 0.20 to 0.29).

Likely (supported but not proven):
- A different kind of method (a detector over shapes and positions, possibly trained on the human-made data) is needed to reach the estimators' positions; the decision table's third row points that way. The one large group (2,034 symbols) is the natural first target.
- Part of the count mismatch is scope, not error: the estimators mark only the members a job needs (braces on a bracing sheet), so a sheet-level or scope-level selection by a person will stay necessary.
- Line with label should replace label-first as the display basis at once because it is cheap and raises precision; it does not change the recall problem.

Unknown:
- Why job-006 gave no pieces and job-014 gave none that match.
- What each colour and shape group means to the estimators.
- Whether a detector would generalise beyond 16 jobs from this data.

The next step, by the pre-registered table, is a study (not a build) of a detector or a different reference. Nothing is built here.

## 10. Part A (committed as `972a317`, no change to how pieces are counted)
- Every vector sheet is in by default; each sheet shows its piece count and a "likely not a framing sheet" flag; raster and unknown pages are out by default with a flag.
- Kind comes only from the label's own text line or the legend. Nearby or sheet-title words are a grey hint only (stored in `kind_evidence`, never used). Excluded kinds in nearby text are ignored.
- The 12 misc kinds are on a row "Not computed (misc)", not in the main total.
- No automatic grade pre-fill; one person-pressed button "Apply suggested grades" (HSS A500, W A992) per project.
- Row Name = kind (editable, flagged system wording). "Apply to all with this tag": same mark on the sheet, or the same size text with no mark; count shown before the click.
- AISC W unit: PROVEN from the Readme sheet ("W: Nominal weight, lb/ft (kg/m)").
- Stray duplicate measurement project (empty, from the aborted first attempt): reported, nothing deleted. Answers recorded as OPEN_QUESTIONS 90 to 96 and in the SPEC Decision Log.

## 11. Decisions for the owner
1. Do you accept that a line-based count is not the way to the estimators' positions on these drawings, and that the next step is a study of a shape detector (using the 4,373 human-made positions), not a new line rule?
2. What does each colour and shape group of your symbols mean (beam, column, brace, others)? A short list lets the data be read per kind.
3. Is the scope rule "count only the members the job needs on a page" something a person selects per sheet (as now), or must the system decide it?
4. May line with label replace label-first as the display and Excel basis now (precision 0.29 against 0.20, same recall)?
5. job-006 and job-014: do you want them investigated first, since they hold 8% of the symbols and produced no usable pieces?
6. The empty duplicate measurement project may be deleted; I did not.

## Tests and checks
Lint clean (ruff check and format, eslint, tsc, prettier). Last full run: API 484 passed (40 files, with the database), worker 505 passed, web 46 passed. The study tools have 11 synthetic tests (`worker/tests/test_phase6b_lib.py`); the study itself runs on private drawings and is not part of the suites.
