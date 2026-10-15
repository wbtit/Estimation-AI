# Phase 11 Part C: pre-registration of the quantity check on job-018

Written and committed BEFORE any build runs on job-018 and before any setup picture is rendered. Nothing in this file is changed after the run; deviations are reported in `docs/PHASE11_RESULTS.md` as deviations, and any look that is not described here is labelled post-hoc there.

## 0. Is job-018 held-out? No.
- **job-018 was a DEV job of the Phase 7 structural grammar** (`docs/PHASE7_RESULTS.md`, table C3: dev side). The grammar's four dev revisions (r1 to r4, rules for main spans, column glyphs and side-by-side spans) were judged on the dev jobs including job-018. Those revisions are NOT ported to the Phase 11 build; what is ported (the vector parser, the hatch rule, the dimension-line rule, bubble and glyph size limits, collinear chaining) was registered in the Phase 7 pre-registration before any dev result, but it was run and looked at on job-018 pages then.
- **Its workbook was used before**: Phase 8 (quantity evaluation of the label-first count), Phase 9 (the derived size route, the typical-member study), Phase 10 (sheet numbers mapped to the workbook references), and the pilot preparation (pilot-01 is a copy of it).
- **Phase 11 constants** (24 pt gap bridge, 1 degree / 1 pt merge, 12 pt column snap, 36 / 48 / 60 pt label reach, glyph support by 2 lines, 30 pt "at grid") were fixed in the Phase 11 plan and code (commit `320bdde`) without opening a job-018 page in this phase; the 24 pt bridge comes from the audit's line-weight check on job-003, job-015 and job-020.
- **Therefore the result is NOT held-out and NOT an accuracy.** It is a best case on a drawing set the project has seen several times. This sentence goes at the top of the results.

## 1. Project
- A copy of the job-018 project of Phase 6b (the source of pilot-01; listed in the private `phase6b_projects.json`), made with `tools.copy_project` under the name `phase11-job-018`: preview first (counts only), then the copy, with the existing proof that the source is unchanged (row counts and content hash before and after). job-018's own project and pilot-01 are never written to.
- The build writes only into the copy. Built pieces carry a build run id, so the copy's label-first members (copied as stored) are untouched and stay out of the line-first BOM.

## 2. Pages
- **Candidate pages:** the pages of job-018 that the workbook references, by the Phase 8 rule (`tools/takeoff/phase8_eval_lib.py`: the sheet part of each `detail/sheet` reference matched to exactly one page that has a whole text line equal to it in the lower-right corner). Recomputed read-only before this file: 16 references, 16 pages.
- **Proposed role** from the stored page type guess: foundation plan -> `column_plan`; framing plan -> `framing`; any other guess -> `skip`. This is only a proposal. **The owner's `phase11_setup.json` decides the role of every page** (`column_plan`, `framing` or `skip`). Only pages he marks `column_plan` or `framing` are built.
- A framing page uses the column plan page the owner names for it; "none" means it is built without one (note `no_column_plan`). If he names none and only one column plan page is marked, that one is used.

## 3. Proposals (the harness proposes, renders, and STOPS)
Per candidate page, with the existing code only:
- **Crop:** grid lines are found on the whole page (`src/build/grids.py` after `src/build/clean.py`); the box around the bubbles that anchor those grid lines, grown by CROP_MARGIN_PT = 36 pt beyond each bubble's radius, clipped to the page. With no anchored grid line: the existing whole-sheet view box (2.5% margin each side, far-right 14% left out; Phase 5b), marked "fallback" in the picture and the template.
- **Pen class:** the existing suggester (`src/linking/structural.py`: `class_table` of `page_lines` inside the proposed crop, then `suggest_classes`: the heaviest solid non-grey width class with at least 8 lines of 12 pt or more). When nothing qualifies the proposal is blank.
- **Scale:** the sheet's stored effective scale ratio (override, else parsed); blank when there is none.
- **T.O.S.:** no proposal. The template lists, as hints for the owner only, up to five text lines inside the proposed crop that contain `T.O.S`, `TOS` or `T/S` (in the private file only).
- **Pictures** (`fixtures/private/shots/phase11/setup-<page>.png`, git-ignored, not viewed by me): the page faint; the proposed crop (dashed box); the lines of the proposed pen class highlighted; grid lines found on the page with their labels; bubbles; column glyph candidates (marked differently at a grid crossing); a small legend with the page index, proposed role, pen class key, scale ratio and counts (bubbles, grid lines, crossings, glyphs).
- **Template** `fixtures/private/study/phase11_setup.json`: one entry per candidate page with the proposed values and empty fields for the owner: `role`, `crop_ok` or `crop` (a corrected box), `pen_class_ok` or `pen_class`, `scale_ok` or `scale_ratio`, `tos_mm` (with `tos_raw` optional), `column_plan_page` (framing pages). Nothing is confirmed by me; an empty field means not confirmed, and such a page is not built (it is reported as not set up).
- **Then the harness STOPS** until the owner's file exists.

## 4. Run (after the owner's file)
- Every confirmation is written to the copy's sheets through the same columns as the API (`*_confirmed_by` = the owner's name as written in the file, source `person` for a corrected pen class and `suggested` for an accepted one), column plan pages first, then framing pages, each by the worker code `src/build/job.build_sheet` in-process (rules version `phase11-build-v1`, the commit recorded). A refused page is reported with its reasons and not retried with other inputs.
- No constant, rule or threshold is changed after any build output is seen. A bug that stops a page from building may be fixed only if the fix does not use what the page produced; any such fix is reported as a deviation with its commit.

## 5. Theirs (the workbook)
- Source: the main-steel rows already extracted with the registered columns (`fixtures/private/target/rows.json`: reference, quantity, shape, size, name, length ft and in, unit weight, total weight, grade). **The workbook file itself is not opened; no cost, price or rate cell is read.**
- Rows as in Phase 8: a quantity, a profile size by `canonical_size` (96 rows, 463 pieces); kind by `tools/takeoff/kind_study.kind_of` on the name. **Beams = rows of kind `Beams`; columns = rows of kind `Column`.** Other kinds and rows with no kind are reported in a separate line, not in the bars.
- Length per piece = length ft x 304.8 + length in x 25.4 mm; a row with no length counts its pieces, not its length.
- **Primary scope:** all their beam and column rows (the job total; the built pages are the pages the workbook refers to). **Sensitivity:** only rows whose every reference maps to a built page.

## 6. Ours
- Built members of the copy: beams = kind `Beams`; columns = kind `Column` (members of column plan pages only).
- **Primary set:** the line-first BOM main total (build state `found` or `needs_review`). **Sensitivity:** every piece that has a size, whatever its state.
- Pieces with no size (`undefined`) are counted on a line of their own ("no size") and are in no size group.
- Size key: the canonical profile, normalised like theirs (upper case, no spaces); the same for both sides.

## 7. Measures
Per beam size of THEIRS (their beam size keys; the shares are over these):
- piece count, ours against theirs; "within 20%" = |ours - theirs| <= 0.2 x theirs;
- total length (sum of piece lengths), ours against theirs.
Totals:
- **total beam weight** = sum over sizes of total length (m) x catalog weight (AISC edition `aisc-v16.0`, kg/m), the same catalog weight for both sides; sizes without a catalog weight are left out of both sums and listed; weight error = (ours - theirs) / theirs. Their own `Total W` column is reported beside it as a secondary figure (their own unit weights).
- total column count, and **per column size: count only** (length stays empty unless typed; not compared).
- sizes we have that they do not (count and pieces), and sizes they have that we never found.
- the same figures by kind for columns: count per size, within 20% share.

## 8. Bars (fixed in advance; beams only)
- **"worth continuing"**: total beam weight within 15% AND per-size count within 20% on at least 60% of their beam sizes.
- **"promising"**: total beam weight within 30% AND per-size count within 20% on at least 40% of their beam sizes.
- otherwise **"not yet"**.
The verdict is read on the primary scope and the primary set. The sensitivity rows are reported beside it and do not change the verdict.

## 9. Label-first on the same pages (comparison)
- The source job-018 project (read-only), display basis (one piece per linked line), through the read-only API on a separate port (PID recorded, stopped by PID; port 3000 untouched), members with a profile, not deleted, merged, existing or "not a member", on the BUILT pages. Beams = such pieces on the built framing pages; columns = such pieces on the built column plan pages (its kinds are mostly blank, Phase 8).
- Count per size against the same theirs, the same "within 20%" share; weight from the member's length where the system has one (its linked-line plan length) x the same catalog weight; pieces without a length are counted and reported. The same bars are applied and reported, for comparison only.

## 10. Failure reasons by count (diagnostics of our build, per page and in total)
Each is a count from the stored build output; a piece or label can appear in more than one.
- **missed column:** on a column plan page, grid crossings with no column within 30 pt; on a framing page, unsupported beam ends within 30 pt of a grid crossing of that page.
- **broken beam line:** unsupported ends of a beam piece that have a collinear beam line of the same pen (direction within 1 degree, offset within 1 pt) starting 24 to 72 pt away (a gap the bridge did not close).
- **wrong pen:** size labels inside the crop that attached to no piece (not as sized, not as inferred) AND have a line of another class parallel (within 10 degrees) within 36 pt.
- **no line:** size labels inside the crop that attached to no piece and have no such line.
- **unsupported:** pieces with one end (`one`) or no end (`none`) supported, separately.
- **no label:** pieces with size `undefined`.
- **grid detection, per page, its own line:** bubbles, grid lines found, grid lines labelled, crossings, grid lines matched for registration (framing pages), registration result (ok, or the reason).

## 11. Outputs
`docs/PHASE11_RESULTS.md` (the not-held-out statement at the top, numbers, the bar verdict, label-first beside it, the failure counts and the grid line per page), overlay pictures of the built pages in `fixtures/private/shots/phase11/` (git-ignored). Counts and generic size codes only in the repository: no page text, file, project or client name.
