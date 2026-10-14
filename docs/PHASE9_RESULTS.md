# Phase 9 results

Branch `phase-9` (from `phase-8`). Local only, nothing pushed.

## Part A: housekeeping (owner-approved)
- **Backup.** `pg_dump -Fc` of the real database to `fixtures/private/backups/` (git-ignored), 118,522,222 bytes (113 MB). Checked readable with `pg_restore -l` (16 table-data entries).
- **Migration 013_count_mode.sql applied** to the real database with `npm run migrate` (1 applied, 13 total; the 12 earlier ones were skipped as already applied). Before: 16 tables. After: 19 tables.
  - Before: catalog_shapes, glyph_library, jobs, legend_rows, member_edits, member_kinds, members, project_files, project_grade_rules, projects, rate_table, schema_migrations, sheet_edits, sheet_views, sheets, text_items.
  - Added: count_actions, measurements, sheet_lines (plus new columns on projects and members). Existing rows untouched (56 projects before and after).
- **Scratch database `estimation_ai_phase8demo_test` dropped.** Remaining databases: estimation_ai, estimation_ai_test (the test-suite database), and the postgres system ones.

## Part B: can the 16 Bluebeam markups give quantity ground truth? (read-only; `docs/PHASE9_MARKUPS.md`)
**No, not for sizes.** Pre-registered first (`docs/PHASE9_PREREGISTRATION.md`, committed before any figure was computed).
- **Fields.** 20,835 markups in the 16 matched PDFs (5,323 count symbols, 5,528 tags). Subject, comment, rich text and the 15 Bluebeam column slots were read. **No field carries a steel size on a count symbol or tag** (best 0.1%; the rule asked for 50% in 10 of 16 files). Highlights carry a size in the comment on 37% (17% as the whole comment) but a highlight marks a label, not a piece. Squares 2.5%. So no size table was built from a field.
- **Custom columns** hold only constant zero defaults (slot 08 = `0`, slot 13 = `0.00`): correction of the Phase 5t reading "looks like a quantity of 1".
- **Tags** are letters plus a number (99.3%); symbol colour predicts the prefix on 99.6% of the tags in (page, colour) groups of five or more (exploratory, post-hoc): estimators use one colour per kind.
- **Derived route** (size from our text layer within 80 pt of each symbol): 2,824 of 4,373 symbols get a size. On job-018, 37% of their sizes are within 20%, weight 59% low: **not usable** (Phase 8: linked 21% / 49% low, naive labels 32% / 33% low).
- **Count and place:** 372 symbols on job-018 against 463 pieces in the finished takeoff (0.80). The markups are good evidence of how many pieces were counted and where, not which size.

## Part C: why the 62-piece size is invisible (job-018, read-only; `docs/PHASE9_INVISIBLE.md`)
- **Correction first:** the 62-piece size is the second largest; the largest (110) is found 64 times and is the control.
- **It is not invisible to the reader:** the size is written **twice** in the whole set (sheets 4 and 5, both next to `TYP`), our parser reads both, and both are unlinked, so the linked-line basis counts 0 and a label count gives 2. On sheets 1 and 9, which two of the three rows also cite, it is not written at all.
- **The estimators did not count it by symbol:** 0 symbols on sheets 1 and 9, 14 symbols with another mark prefix on sheets 4 and 5. The 62 pieces (rows of 30, 26 and 6) are a typical-members decision.
- **"Label count x parallel lines":** 0.05, 0.11 and 0.15 of 62 at 150, 300 and 600 pt; the label count alone 0.03. For the control, the label count alone is 110 / 110 and multiplying by parallel lines overshoots 4 to 8 times. No rule was built.

## Part D: copilot fixes (with tests)
1. **Unlinked size labels become amber suggestions** (count mode). Listed apart with a "no line" badge and drawn as dashed amber squares at the label; in no total until a person clicks (count it) or shift-clicks (reject). Labels with no parsed size stay in the unlinked list. Shared-line extra labels are unchanged.
   - **Fix found on the way:** before this phase an unsnapped click, or an accepted unlinked label, had the status "unlinked" and so reached no total although it was kept (Phase 8 claimed clicks are never dropped: they were kept but not counted). A person's piece with no line is now a counted piece (amber, "no line, length unknown"). Test: `count-mode.test.ts` was changed to expect it.
2. **Snap preference.** Candidates within the radius are ranked: solid medium or heavy, solid thin, dashed; then distance, then the longer line, then the lower index. Hatch and detected dimension lines never snap. Tab (Shift+Tab backwards) walks the list before the click; the screen says "line 2 of 3 (Tab: next)"; the server re-ranks and accepts the chosen line only if it is among its own candidates (and the lines version matches), else it uses the best one. The evidence stores the rank, whether Tab chose it and the number of candidates. The hatch, role and dimension rules are the Phase 7 rules ported to merged lines (`worker/src/review/line_roles.py`); `sheet_lines` rows now have role and dimension columns (older rows still work: width decides). API and web run the same cases (`fixtures/synthetic/snap-cases.json`).
3. **Tag numbering** per kind over the job in click order (never reused, editable); the scope (`job` default, or `sheet`) is a project setting (`projects.tag_scope`, migration 014) with a selector in the count tab, logged. The clash check on a typed tag, and kind assignment, use the same scope.
4. **Sheet numbers.** The title-block reading is preferred: the pattern now accepts the `S4-01` form (the earlier pattern could not match it, so it picked a token like `S4`) and a number may sit below-right of its "DRAWING NUMBER" label. The earlier reading is kept as `sheet_number_old` when it differs, and is shown with a flag as the fallback when no title-block number is found. Shown in the sheet list and the sheet header (`S4-01 *`, tooltip with the earlier value). **On job-018 the new reading equals the Phase 8 title-block mapping on 16 of 16 sheets** (the other 7 sheets read a number too).
   - **Preview over every stored project (read-only, nothing written):** 1,134 pages in 55 projects: 899 keep their number, 139 get a number where none was stored, 96 change (in 7 projects), 0 fall back. `python -m tools.reread_sheet_numbers <project>` previews; `--apply` writes only the number columns.
5. **Pilot switch.** Count mode per project, default off, as a switch in the top bar (asks before turning on; needs your name; logged). When off, the count tab and the K and M tools are not there and nothing about the old screens changes.

## Verified in a real browser
`worker/tools/phase9_shots.py` on a made-up drawing in a scratch database (dropped afterwards): the pilot off shows no count tab; turning it on (confirm) shows it; the hatch patch gives no snap line; the ranked snap highlights the beam first and Tab moves to the thin line beside it ("line 2 of 2"), the click is logged `snap_by: tab, rank: 1`; the dashed amber unlinked label accepts with one click and becomes a counted piece ("accepted", no line). The title block of the made-up page reads `S4-01` with the earlier `S4` kept. Screenshots: `fixtures/private/shots/phase9/` (7 images; I looked at 3 of them: 04, 06 and 07). One demo bug was found and fixed this way (a click on the dashed square also made a count click).

## Proven / likely / unknown
- **Proven (ran):** the markup fields carry no size; the derived route is not usable on the one job it can be checked on; the 62-piece size is a typical-members count; the new sheet-number reading equals the Phase 8 mapping on 16 of 16 sheets; the new snap ranking, Tab, tag scope, suggestions and pilot switch behave as described (tests below and the browser run).
- **Likely:** unlinked-label suggestions will lift the draft total toward the naive count (not measured on real pages with a person clicking); the title-block reading is better on the 6 other projects with changes (no ground truth there); estimator colours give the kind (question 124).
- **Unknown:** time saved (no timing evidence, the action log is ready for it); how well the ported hatch and dimension rules work on real pages (not measured, question 128; on the made-up page they were 24 of 24 hatch lines and the one dimension line); whether role ranking (relative to the page's own widths) picks the beam on a real page; whether the 62-piece quantity is on any drawing.
- **Limits:** one job for every quantity figure; the demo drawing is synthetic.

## What was run
- Lint (`make lint`): clean. API 576 tests, worker 626, web 117, all passing (before this phase: 556, 576, 95).
- New tests: `api/src/__tests__/pilot-copilot.test.ts` (11), ranked snap cases (shared fixture, API 25 snap tests, web 22), `worker/tests/test_line_roles.py` (8), `test_sheet_number_title_block.py` (8), `test_phase9_lib.py` (34), `web/src/components/pilot.test.tsx` (12).
- Processes (PIDs recorded, stopped by PID): a read-only API on port 3100 for Part C (stopped); the browser demo's API, worker, web server and geckodriver (all stopped, pid file empty). The API on port 3000 was not touched. The scratch database of the demo was dropped.
- **Not applied to the real database:** migration 014 and the sheet-number re-read (questions 123).
