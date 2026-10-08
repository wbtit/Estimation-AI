# Phase 4e: how members are drawn and labelled, and which deterministic rules can link a label to a member

Research study, not a build. Anonymized job ids and generic convention names only; counts, no names or text. Registered before any gold link or score existed: `docs/PHASE4E_PREREGISTRATION.md` (committed first). Tools: `worker/tools/study/` (README there). Images, overlays, gold files and raw results stay in `fixtures/private/study/` (git-ignored). No OCR and no LLM inside any pipeline code.

## What is measured, what is AI-annotated, what is unknown
- **Measured by code:** text-layer counts, line reconstruction and stroke classes, candidate lines, rule predictions, the DESIGN and VALIDATION scores against the gold, column-like shape detection, self-consistency checks.
- **AI-annotated (viewed images, not ground truth):** the convention cards (STEP 2), the verification of which stroke classes are structural (STEP 3), and **every gold link** (STEP 4: 320 labels, 75 of them marked `unsure` by the annotator, 23.4%). A random 10% (32 labels, seed 4999) is in `human_spot_check.csv` for you to confirm; **no human has checked them yet**, so every accuracy below is accuracy against AI-annotated gold.
- **Unknown:** accuracy against what an estimator would count (there is no takeoff), links on documents whose member lines are raster images, behaviour on drawing sets outside these eight, group and TYP/SIM handling (4 gold cases), and quantity notes (5 labels with a quantity prefix on the selected pages, none with candidates).

## 1. Sample (STEP 1; recorded before looking at results)
Eight documents from the 18 unique kept documents with a text layer (17 had at least 3 plan-like pages), chosen by structure only: one per producer category first, then greedy farthest-point on log-scaled structural features. Plan-like pages = the large pages with the most profile-pattern hits. The selection file fingerprint is in the pre-registration.

| Doc | Producer | Pages selected as plan-like | Of which framing plan views (AI reading) | Schedule / legend / elevation pages found |
|---|---|---|---|---|
| job-002 | Bluebeam | 3 | 2 (one is a section sheet) | 1 / 1 / 0 |
| job-004 | AutoCAD | 4 | 3 (one is a shear-wall sheet) | 1 / 1 / 0 |
| job-005 | AutoCAD | 4 | 3 (one is a section and isometric sheet) | 2 / 2 / 0 |
| job-008 | other | 4 | 2 (a foundation plan and a detail sheet) | 2 / 0 / 0 |
| job-009 | other | 4 | **0** (foundation plan, two elevations, a column schedule; the real framing plans were tagged as legend pages) | 2 / 2 / 0 |
| job-010 | unknown | 4 | 2 (two detail or foundation sheets) | 2 / 0 / 2 (neither real) |
| job-016 | Bluebeam | 4 | 3 (one is a wall-frame elevation sheet) | 2 / 2 / 0 |
| job-020 | Bluebeam | 4 | 2 (plus a stair-framing sheet) | 1 / 0 / 2 (neither real) |

**Finding about the selection method:** counting profile-pattern hits picks pages with many profile strings, and about half of them (17 of 31) are real framing plan views; the rest are foundation plans, elevations, details and schedules, and the "schedule" and "elevation" keyword rules found general-notes sheets and foundation sheets instead. The sample was not changed after registration. Consequence: some gold is `not_member_label` (20) or elevation and detail labels.

## 2. Convention taxonomy (STEP 2; AI-annotated counts, `n` = label instances viewed per document)
| Convention | job-002 | job-004 | job-005 | job-008 | job-009 | job-010 | job-016 | job-020 |
|---|---|---|---|---|---|---|---|---|
| **Beam drawing** | double line | steel single heavy line inside thin double outline; wood joists beside it | single heavy line | single line | single line | single heavy line | single line (new heavy, existing thin grey) | single heavy line |
| Primary and secondary distinguished by weight | no | no | no | yes | yes | yes | yes | no |
| **Linework is vector** | **no: raster underlay** | yes | yes | yes | yes | yes | **no: raster tiles** | yes |
| Label position (n) | 30 | 34 | 63 | 60 | 94 | 56 | 60 | 38 |
| - rotated parallel to member | 12 | 8 | 20 | 34 | 39 | 16 | 34 | 5 |
| - above or below the line | 11 | 9 | 40 | 6 | 32 | 22 | 14 | 21 |
| - on the line | 2 | 3 | 0 | 10 | 1 | 6 | 4 | 0 |
| - leader with arrowhead | 1 | 11 | 0 | 3 | 2 | 4 | 0 | 0 |
| - leader without arrowhead | 3 | 1 | 1 | 7 | 20 | 2 | 5 | 6 |
| - in a box or tag | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 6 |
| Label content (n as above) |  |  |  |  |  |  |  |  |
| - profile only | 8 | 16 | 33 | 36 | 58 | 8 | 14 | 32 |
| - profile plus load, reaction or span note | 17 | 1 | 29 | 8 | 3 | 30 | 16 | 2 |
| - profile plus stud count | 0 | 0 | 0 | 0 | 0 | 20 | 20 | 6 |
| - mark plus legend | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 |
| - mark plus profile (base-plate mark) | 0 | 0 | 0 | 0 | 26 | 0 | 0 | 0 |
| - quantity prefix | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 |
| - camber | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| - elevation note (TOS, EL.) | 3 | 3 | 0 | 3 | 4 | 8 | 0 | 5 |
| - TYP, SIM or UNO note | 1 | 1 | 1 | 4 | 0 | 3 | 4 | 6 |
| **Columns** drawn as | filled squares (12 of 18) | hollow squares | hollow squares | hollow and filled squares | I-shape symbols | hollow squares | I-shape (22 of 32) and hollow squares | hollow squares and I-shape |
| Columns labelled by | none | size beside | none | size beside | mark and schedule, and beside | mark and schedule, and beside | mark with leader plus schedule | size beside |
| Column schedule page found | no | no | no | no | **yes** | **yes** | **yes** | no |
| **Braces** on plan | other (dashed with note) | none | none | other (tagged symbol) | symbol (boxed tag) | none | none | none |
| Braces on elevation | none found | none found | chevron | none found | X brace | none found | none | X brace (stair frame) |
| **Grids** lettered and numbered | yes | **no** | yes | yes | yes | yes | yes | yes |
| Bubble text looks like | 1 letter or 1-2 digits | none | 1 letter or 1-2 digits | 1 letter or 1-2 digits | mixed | 1 letter or 1-2 digits | mixed (A.1, 17.3) | mixed |
| Grid line style | chained dashes | dash-dot | dash-dot | dash-dot | dash-dot | dash-dot | chained dashes | dash-dot |
| **Dimension chains** | arrowheads, ft-in | arrowheads, ft-in | ticks, ft-in | ticks, ft-in | ticks, ft-in | arrowheads, ft-in | ticks, ft-in | ticks, ft-in |
| **Joists** (designations are not AISC shapes) | none | wood and engineered wood only | none | K and LH, single lines with label | LH (5 on one roof plan) | K and one KCS-type | none in plan text (legend only) | K, one note "n K-series joists" with a span arrow, no drawn lines |
| K-series / LH-series / DLH-series designations in the text layer (count) | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 5 / 23 / 0 | 0 / 5 / 0 | 10 / 0 / 0 | 0 / 0 / 0 | 2 / 0 / 0 |
| Metal deck notes | yes (direction arrows) | no | yes (arrows) | yes | yes (arrows) | yes (arrows) | yes (arrows) | yes |
| Misc steel seen (stairs / handrails / lintels / embeds or plates / other) | 1 / 0 / 0 / 0 / 3 | 3 / 0 / 4 / 3 / 0 | 7 / 1 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 2 | 0 / 0 / 0 / 4 / 3 | 0 / 0 / 3 / 0 / 2 | 0 / 0 / 0 / 0 / 3 | 4 / 0 / 0 / 4 / 0 |
| Readability for label linking (annotator) | moderate | moderate | easy | easy | moderate | easy | moderate | moderate |

Reading the table:
- Seven of eight use a single heavy line for a member; rotated-parallel and above-or-below placement account for most labels in every vector document; a leader with an arrowhead is the most common single placement in `job-004` and leaders are common in `job-008`, `job-009`, `job-010`, `job-020`.
- Labels are overwhelmingly **profile-based** (profile alone, or profile plus a note); mark-plus-legend labelling occurs in one document (3 of 60 labels) and a quantity prefix in one (7 of 34).
- Lettered and numbered grids exist in seven of eight (not in `job-004`, a mostly wood-framed set).
- Two of eight documents (`job-002`, `job-016`) draw their member lines as **raster image tiles**: there is no vector member line to link to.
- Three of eight have a column schedule page; columns elsewhere are labelled by size beside them.

## 3. Linework (STEP 3)
Reconstruction: segments of stroked paths and thin filled rectangles, merge of touching collinear segments (1.0 pt gap, 0.6 pt offset), exploded dashes chained into dashed lines. Stroke classes = width bucket, colour class, solid or dashed; verified as structural or not on class-coloured overlay images by the annotators (AI).

| Doc | Plan-like pages | Structural class (verified on overlays) | Reconstructed lines in structural classes per page (pages in order) | Annotator estimate of visible member lines per page |
|---|---|---|---|---|
| job-002 | 1, 3, 6 | none (raster) | 0, 0, 0 | 0, 0, 0 (raster counts: about 900 and 35) |
| job-004 | 4, 5, 6, 7 | 1.5-2.5 black solid (steel) plus 1-1.5 and 0.5-1 black solid (wood) | 662, 240, 249, 57 | about 200, 140, 110, 8 |
| job-005 | 13, 14, 26, 28 | 1.5-2.5 black solid (mixed with column rectangles, grid-end bars) | 33, 47, 191, 52 | about 30, 24, 40, 50 |
| job-008 | 3, 4, 5, 10 | 1.5-2.5 black solid beams; 0.25-0.5 black solid joists on page 5 | 4, 58, 203, 293 | 4, 40, 90, 0 |
| job-009 | 8, 11, 12, 15 | verified on the elevation and column-schedule pages; the foundation plan (page 8) has none | 0, 664, 625, 139 | 8, 60, 35, 34 |
| job-010 | 6, 7, 16, 18 | 1.5-2.5 black solid (mixed with the sheet border) | 56, 32, 0, 0 | 55, 14, 0, 0 |
| job-016 | 4 to 7 | none (raster tiles) | 0, 0, 0, 0 | 0 (raster counts about 45, 60, 110, 30) |
| job-020 | 4, 5, 8, 9 | 1.5-2.5 black solid (also existing framing under hatch) | 118, 27, 0, 201 | about 70, 40, 40, 70 |

- A single stroke class is rarely pure: the heavy class also contains column rectangles, grid-end bars, moment-connection symbols and section outlines; thin classes mix joists with text strokes, leaders and dimension lines. Class selection alone overcounts member lines by up to about 10 times on some pages (reconstructed count against the annotator's estimate), so a member-line detector needs more than a class filter.
- Existing framing shares the heavy class with new framing in `job-020`; in `job-009` and `job-016` grey colour distinguishes existing from new; wood and steel share classes in `job-004`.

## 4. Label-to-member study (STEP 4)
**Design as registered.** 8 documents, 320 sampled labels (40 each, seeds `4000 + job number`: 4002, 4004, 4005, 4008, 4009, 4010, 4016, 4020), split within each document 20 DESIGN / 20 VALIDATION with seed + 500 and written to disk before any gold link existed (sha-256 in the pre-registration). Candidates: 6 nearest structural lines within 150 pt, by distance only. Rules R1 to R5, grid of 210 configurations, selection and validation exactly once, as registered. Spot-check seed 4999.

**Gold composition (AI-annotated, all 320 labels).**
| Gold | Count | Share |
|---|---|---|
| A candidate line (1 to 6) | 138 | 43.1% |
| `missing` (the member is not among the candidates: raster, or a small symbol, or a line outside the class) | **157** | **49.1%** |
| `group` | 4 | 1.3% |
| `none` | 1 | 0.3% |
| `not_member_label` (legend, detail, existing item; excluded from denominators) | 20 | 6.3% |

By document: `job-002` 40 missing; `job-016` 28 missing and 12 not-member (raster); `job-004` 28 missing, 11 line, 1 none; `job-008` 22 line, 18 missing; `job-009` 28 line, 11 missing, 1 group; `job-010` 21 line, 11 missing, 8 not-member; `job-005` 32 line, 8 missing; `job-020` 24 line, 13 missing, 3 group. By convention class (all 320): leader 75 missing of 90, 7 line, 3 group, 5 not-member; rotated parallel 46 missing, 58 line, 4 not-member; above or below 34 missing, 56 line, 7 not-member; on line 2 missing, 17 line, 1 not-member. Annotator note tags: leader to arrow 34, column symbol 32, split or double line 30, dense area 25, existing item 14, section detail 8.

**Tuning on DESIGN only.** 150 scored DESIGN labels, 210 configurations, 12 tied at the best. Frozen configuration: angle tolerance 5 degrees, angle penalty 20 pt; side preference, leader following and group notes all **off** (they did not raise DESIGN accuracy). DESIGN top-1 **0.400** against **0.347** for the nearest-line baseline (R1). Confidence thresholds from the registered set: `m_med` 5 pt, `m_hi` 40 pt (DESIGN `high` class: 15 labels, 93.3% correct).

**VALIDATION, scored exactly once** (150 labels, 20 per document except 16 for `job-010` and 14 for `job-016`; the other labels were `not_member_label`).
| Measure | Frozen rule | Baseline R1 (nearest line) |
|---|---|---|
| Top-1 accuracy, all labels | **44.0%** (66 of 150) | 40.0% (60 of 150) |
| Top-1 where the gold is among the candidates (or none, group) | 86.8% | 78.9% |
| Recall at 3, line-gold labels (72) | 97.2% | 97.2% |
| Gold `none` or `group` | 2.7% (4) | same |
| Gold `missing` (candidate generation failed) | 49.3% (74) | same |

Against the proposed bars (95% green, 80 to 95% with review, below 80% not usable), the pooled rule is **not usable** (44.0%). The headline is dominated by labels that have no right candidate; where the right line is among the candidates the frozen rule reaches 86.8% (the review band).

**Per document (VALIDATION, frozen / baseline top-1; line-gold labels; recall at 3).**
| Doc | n | Frozen | Baseline | Line-gold | Recall at 3 |
|---|---|---|---|---|---|
| job-002 | 20 | 0.0% | 0.0% | 0 | n/a |
| job-004 | 20 | 40.0% | 25.0% | 8 | 100% |
| job-005 | 20 | 85.0% | 85.0% | 18 | 100% |
| job-008 | 20 | 45.0% | 30.0% | 10 | 100% |
| job-009 | 20 | 55.0% | 55.0% | 14 | 92.9% |
| job-010 | 16 | 50.0% | 50.0% | 8 | 100% |
| job-016 | 14 | 0.0% | 0.0% | 0 | n/a |
| job-020 | 20 | 65.0% | 65.0% | 14 | 92.9% |

**Per convention class (VALIDATION, frozen rule).** On the line: 9 labels, 100%. Above or below: 47 labels, 61.7%. Rotated parallel: 54 labels, 51.9%. Leader: 39 labels, **0.0%** (none correct; most leader labels have gold `missing`, 75 of the 90 in the whole sample, because the leader reaches a column symbol or a detail, which is not a candidate). Other: 1 label, 0%.

**Confidence classes (VALIDATION, frozen).** `high` (margin of at least 40 pt and the best line aligned, or a leader followed): 23 labels, **100%** correct (95% lower bound about 86%; DESIGN 93.3% on 15); `medium`: 54 labels, 70.4%; `low`: 73 labels, 6.8%. The `low` class is mostly labels with no right candidate.

**Failure modes (VALIDATION, frozen, 84 errors).** Candidate generation missed the member: 74. A parallel neighbouring line was chosen: 5 (4 on the same side, 1 on the other). The rule predicted `none` where gold is `group`: 3; a line where gold is `group`: 1; a crossing line chosen: 1. So **88% of the errors are not ranking errors but missing candidates.**

**Exploratory, post-hoc, not tuned and not part of the registered score** (gold `missing` labels, all documents): for the 89 labels on vector documents, a leader ends at a column-sized closed shape for 22 of them (13 in `job-008`), and such a shape lies within 40 pt of the label for 42. For the 68 labels in the two raster documents no vector member exists. So adding small closed shapes as candidates, with leader following to them, could explain roughly a quarter to a half of the vector-document misses, which is a hypothesis to test on new data, not a result.

## 5. Columns (STEP 5)
Hypothesis: columns are small closed shapes of consistent size near beam intersections. Detection without labels: closed rectangular shapes 4 to 60 pt, aspect 0.6 to 1.67.
- **Counts on the plan-like pages (shapes; in the modal size cluster of +-15%; touching a structural line within 2 pt):** `job-004` 152; 140; 104. `job-005` 243; 136; 23. `job-008` 401; 208; 106. `job-009` 590; 339; 71. `job-010` 340; 151; 31. `job-020` 694; 358; 87. `job-002` 125; 74; 0 (raster beams). `job-016` 940; 414; 0 (raster beams).
- **Size consistency:** the modal cluster per page has a coefficient of variation of 0% to 10.4% (median about 4.1%), with modal sizes between 5 and 21 pt; so shapes of one size exist on every page, but **the modal cluster is not the columns**: on viewed overlays (3 pages in 3 documents) the detections are mostly callout and keynote symbols, grid-label boxes, tag boxes, section and detail markers, key-plan thumbnails, base-plate detail drawings and sheet furniture.
- **False-positive sources seen:** grid-bubble and grid-label boxes, callout and section bubbles (their filled tails), keyed-note and tag boxes, symbols in legends and key plans, details inserted on the sheet, text-box outlines. On the viewed pages the true columns are a small minority of the detections (visually estimated at well under 10%).
- **How columns are actually drawn:** hollow squares (five documents), I-shape symbols (three), filled squares (two), and in `job-009`, `job-016`, `job-020` the I-shape is drawn as ticks on the heavy line rather than as a closed shape. The hypothesis "columns are consistent small closed shapes near beam intersections" is therefore **not supported as a detector** on its own; it holds as a weak candidate filter combined with proximity to structural line ends.
- **Column profiles:** by schedule in three documents, by a size beside the column in four (see table); one document has no labels at all. Schedule parsing (rows of the text layer with a mark-like token and a profile in the same row): `job-016` schedule page 8 rows, `job-009` column schedule page 4 rows (and 11 mark-only rows), `job-010` foundation sheet page 4 rows and 53 mark-only rows. Whole-document counts of pages with at least 3 such rows: `job-004` 2, `job-009` 1, `job-010` 2, `job-020` 3, `job-016` 4, others 0. So **schedules do not parse into clean mark-to-profile rows with this method**: the layouts are stick diagrams or tables whose cells are separate columns; a column-aware table parser is needed.

## 6. Self-consistency checks without a takeoff (STEP 6; descriptive)
- **(a) Dimension strings against geometry.** Pages without a single parsed scale are skipped (`job-004` 2 of 4 pages, `job-005` 1, `job-009` 3, `job-010` 2, `job-020` 2). *Arrowhead span:* of 47 dimension strings flanked by two arrowheads (`job-002` 22, `job-004` 13, `job-010` 9, `job-016` 3), 6 agree within 3% or 50 mm (13%); median relative error 82% (`job-004`), 7.7% (`job-010`). *Nearest parallel structural line:* of 99 dimension strings with an adjacent parallel line (`job-004` 33, `job-010` 33, `job-005` 20, `job-020` 11, `job-008` 2), 5 agree (5%). Typical errors are large (median relative error from 7% to 349 times the printed value). Reason (inferred): a dimension string usually spans a grid bay or a clear span between supports, not the length of the nearest member line, and one page often carries several views at different scales. **This check is not usable as a validator of member lengths.**
- **(b) Mark and legend completeness.** Mark-plus-legend labelling is rare, so legend-like lines (a mark followed by a profile in a short line) were found in only 2 of 8 documents (1 legend mark each); mark-shaped tokens used elsewhere on the selected pages range from 19 to 54 per document but most are grid bubbles, detail references and sheet references, so **completeness cannot be measured** (marks used but absent from a legend: not meaningful here).
- **(c) Quantity notes.** Only 5 labels with a quantity prefix exist on the selected plan pages (`job-016` 1, `job-020` 4), none with a candidate line, so this check is **not measurable on this sample**.

## 7. Proposed deterministic rule set v1 (for the next study to validate)
Frozen parameters from the registered DESIGN tuning, unchanged by the validation result:
- **Candidates:** the 6 nearest structural lines within 150 pt (structural classes per document, verified), minimum length 12 pt. *Proposed addition, not validated:* closed column-sized shapes (4 to 60 pt) as additional candidate targets, and a flag when the document's member lines are raster.
- **Ranking:** score = distance + 20 pt if the candidate is more than 5 degrees from the text baseline; best score wins. (Side preference, leader following and group notes: off, not supported by the DESIGN data.)
- **Confidence model:** `high` when the margin between the best two scores is at least 40 pt and the best line is aligned, or a leader was followed; `medium` when the margin is at least 5 pt; otherwise `low`. Measured on VALIDATION: 100% (23), 70.4% (54), 6.8% (73).
- **Output contract:** `high` = suggested link (to be confirmed in the review UI until the bars are confirmed); `medium` = suggested with review; `low` = no automatic link, `needs_review`.

## 8. Handling per convention class
| Class | Handling | Basis |
|---|---|---|
| Label beside, parallel or on the line, member is a vector line, one clear nearest aligned line (`high`) | **Usable now, as a suggestion** (meets the green bar on 23 validation labels, small sample; confirm on new data and the human spot check) | 100% of 23 |
| Same, but margin small or several parallel lines (`medium`) | **Usable with human review** | 70.4% of 54 |
| Same, `low` margin or no candidate | **Needs review, no automatic link** | 6.8% of 73 |
| Leader to a column symbol, tag or detail | **Needs new data and rules** (candidate set must include small symbols; test leader following to them) | 0% on 39; leader reaches a column-like shape for 22 of 89 vector-document misses |
| Raster member lines (`job-002`, `job-016`) | **Not supported without raster handling** (68 of 157 missing labels) | no vector member line |
| Double lines and split lines (30 tagged) | **Needs a merge rule** (parallel pair to one member) before ranking | annotator tags |
| Group and TYP/SIM notes | **Needs new data** (4 group cases in 320 labels) | too few |
| Existing items, legends, details, section and elevation labels (20 not-member, plus elevation labels) | **Exclude by sheet type and by an existing-item prefix/colour rule**; not tested | gold `not_member_label` |
| Quantity prefix | **Needs new data** (5 labels) | too few |

## 9. Joists, deck and miscellaneous steel (scope notes)
- **Joists:** designations of the K, LH and DLH series appear in 4 of 8 documents (K in `job-008`, `job-010`, `job-020`; LH in `job-008`, `job-009`; no DLH). They are **not AISC shapes**: they must be counted as a separate item type and flagged (`joist_series`), never matched to the shape catalog. One document frames with wood joists and rafters (`job-004`), another shows a K-series joist only as a note with a span arrow and no drawn lines.
- **Metal deck:** notes in 7 of 8 documents (direction arrows in 5); deck is out of scope for the steel member takeoff but its notes and direction symbols must not be mistaken for members.
- **Miscellaneous steel seen, out of scope:** stairs (4 documents), handrails (1), lintels (2), embeds and plates (3), others; they carry profile-like strings (angles, channels, plates) and will produce false member labels unless filtered by sheet or note type.

## 10. Risks, ranked
1. **The candidate set does not contain the member for about half of the labels** (49.1% gold `missing`): raster linework (2 of 8 documents) and small symbols (columns drawn as squares or I-ticks) reached by leaders. Ranking improvements cannot fix this.
2. **Gold is AI-annotated** and 23.4% of the labels are `unsure`; the human spot check (32 labels) has not been done. Accuracy figures could move.
3. **Heterogeneity:** eight documents showed eight convention mixes; 17 of 31 plan-like pages are real framing plans; a rule set tuned on 150 DESIGN labels may not transfer (the best configuration was tied by 12 others).
4. **Structural class selection is manual** (verified on overlays by an AI reader) and classes are mixed (steel and wood, new and existing, members and symbols); an automatic member-line detector is a separate piece of work.
5. **Column detection by shape fails** (mostly false positives) and column schedules do not parse into rows with the row method.
6. **Self-consistency checks do not validate lengths** (dimension agreement 5 to 13%); they cannot replace a takeoff.
7. **Double lines, split lines and dense areas** (30 and 25 tagged labels) make the "which line" choice ambiguous even for a person.
8. **Existing, demolished and detail items** produce labels that are not members (20 labels, plus many in details).
9. **Small samples** for group notes (4), quantity prefix (5), leaders to arrow targets, and the `high` band (23).

## 11. What takeoff or pricing data would turn this into an accuracy measurement
1. For a subset of these eight drawing sets (ideally all), the **estimator's member takeoff as a list**: sheet and page, member mark or id, profile as the estimator read it, length, quantity, and whether it is new or existing.
2. The **takeoff markups themselves** (for example the exported markup list from the PDF markup tool with page, geometry and subject) or a **marked-up PDF** in which every counted member is highlighted, so each takeoff line can be tied to the vector line and to the label it came from. This is what turns the gold from AI-annotated into human-measured.
3. The **list of sheets that were taken off** and the rules applied (what was excluded: existing, deck, joists, miscellaneous steel, connections, plates; waste or connection allowances).
4. **Per-profile and per-sheet totals** (counts and lengths) to compare with extracted totals.
5. For columns: the **column heights or elevations used** and the column schedule as the estimator interpreted it; for elevations, the **level or datum table**.
6. For pricing: the **unit weights or prices used per profile** (or the catalog file and edition), the labour rules, and the final priced estimate with its structure, so that weight and cost totals can be compared, not only counts.
7. The **owner's confirmation of the 32 spot-check labels** (fill `human_gold` in `human_spot_check.csv`) and confirmation or change of the usability bars.

## 12. Reproduction
Everything above is reproducible from `worker/tools/study/` with the private inputs: `select_docs.py`, `page_dump.py`, `text_counts.py`, `sample_labels.py`, `make_overlays.py`, then annotation, `spot_check.py`, `score.py tune` and `score.py validate` (refuses a second run), `columns.py`, `selfcheck.py`, `exploratory_columns.py`. Tests: `worker/tests/test_study_tools.py` (synthetic data). Seeds: samples 4000 plus the job number, split seed plus 500, spot check 4999; document selection is deterministic (no random numbers).
