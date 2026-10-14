# Phase 10 results

Branch `phase-10` (from `phase-9`). Local only, nothing pushed. Owner decisions 123, 124, 126, 127 and 128 are recorded in the Decision Log of `docs/SPEC.md`; no decision was given on 125 (highlights), which stays open.

## Part A: decisions 123 and 128
**A1. Backup and migration 014.**
- **Backup:** fresh `pg_dump -Fc` of the real database to `fixtures/private/backups/` (git-ignored), 118,553,248 bytes (113 MB), readable (`pg_restore -l`, 19 table-data entries).
- **Migration 014 applied** (`npm run migrate`: 1 applied, 14 total). Tables before and after are the same 19 (014 adds columns only): catalog_shapes, count_actions, glyph_library, jobs, legend_rows, measurements, member_edits, member_kinds, members, project_files, project_grade_rules, projects, rate_table, schema_migrations, sheet_edits, sheet_lines, sheet_views, sheets, text_items. Columns of projects and sheets went from 60 to 64 (projects.tag_scope; sheets.sheet_number_old, sheet_number_old_source, sheet_number_flag). 56 projects before and after.

**A2. Sheet-number re-read** (`worker/tools/sheet_number_review.py`; preview first, then apply).
- **Preview (nothing written):** 55 projects with their PDF, 1,134 pages. 139 pages had no number stored and get one; 96 pages would change a stored number (23 in job-018, 73 in 6 other projects).
- **Applied:** job-018's project re-read in full (23 pages, owner-approved), and the 139 fill-ins in every project (a page that had no number). **Written: 162 pages.** A stored number was never overwritten outside job-018.
- **For your review:** `fixtures/private/review/sheet_number_changes.csv` lists all 96 changed pages (project id, page index, old, new, `applied_job018` yes/no, blank `owner_ok`) and `fixtures/private/shots/phase10/titleblocks/` holds a crop of each page's title-block corner (96 PNGs, file name = first 8 characters of the project id and the page index). The 73 pages marked `no` are NOT applied and wait for `owner_ok`. I did not look at the crops (real drawing text).
- The 23 job-018 rows are listed too (marked `applied_job018 = yes`) so the file holds all 96.

**A3. Hatch and dimension detection on your pages: skipped.** `fixtures/private/review/pages_128.txt` does not exist. The read-only tool is ready: `PYTHONPATH=. .venv/bin/python -m tools.line_roles_review` reads the file (one `<job id or project id> <page index>` per line), writes an overlay PNG per page (hatch red, dimension lines blue, other grey) to `fixtures/private/shots/phase10/line_roles/` and prints counts per role. Tested on synthetic pages only.

## Part B: "x N typical" (decision 126)
- A counted piece (a click or an accepted suggestion, count mode on) may carry `x N typical`, N an integer of 2 or more, with a **required note**. Refused: N below 2 or not whole, no note, a suggestion nobody decided, count mode off (`POST /api/projects/:id/members/:id/typical`; `n: null` removes it).
- It is a member edit (`typical`), so undo and redo work like every other change, and it is a `typical` row of the action log (create / edit / remove, with before and after). Migration 015 adds the log action names.
- **It counts N everywhere:** the member's quantity becomes base quantity x N, so the takeoff totals, sheet counts and the takeoff Excel count it; the Stage 1 tables count N for the piece (they count one per piece otherwise) and flag the row `typical xN`; the tables Excel follows the tables. Weight (Total W) is quantity x length x Unit W, so it scales too.
- Shown **amber** with the reason "typical xN", a `typical xN` badge in the count tab (note as tooltip), an editor for the selected piece, and the note in the evidence panel.

## Part C: pieces without length (decision 127)
- Counted pieces with no length stay in the quantity; their Total W stays blank (unchanged).
- Job and page tables now carry `weight`: Total W (lb) of the rows with a length and a Unit W, **pieces without length**, and pieces with a length but no Unit W. The tables screen shows "Total W ... lb · N pieces without length" on the job and page totals, and the tables Excel adds both lines under each TOTAL. The takeoff Excel sheet adds "N pieces without length" under its total (the takeoff's own count of pieces with no length of any source).

## Part D: kind from the estimator mark prefix (decision 124)
- **`fixtures/private/review/prefix_meanings.csv` does not exist**, so the mapping is **empty** for every project. Built and tested:
  - the project table `project_prefix_kinds` (migration 015), the settings section "Estimator mark prefixes" in the count tab (set, remove, paste the file, preview, apply), every change logged (`prefix_map`); a prefix must be 1 to 6 letters, a kind of the list, given once, and not another kind's own tag prefix;
  - the loader for the owner file: `npm --prefix api run prefixes:load -- --project <id> [--file ...] [--apply]` (preview by default; the whole file is refused on any problem). Run now: "prefix file not found", nothing written;
  - in count mode a new piece of a mapped kind takes the estimators' prefix as its tag (B1, B2, ...; not marked provisional); an unmapped kind keeps the list's prefix;
  - the markup import for comparison: `worker/tools/takeoff/import_markups.py <job>` gives each estimator symbol its tag and the kind from the mapping (no mapping: no kind, nothing guessed). It reads the mapping table, which exists on the test database only (question 130), so it was run on synthetic data only.

## Part E: pilot timing report
- `GET /api/projects/:id/pilot-report` and `.csv`, and a **report** tab (with the pilot on). Per sheet and per person: active time (a person's actions in time order; each gap goes to the sheet of the later action, so moving between sheets never counts time twice; gaps over 5 minutes are left out and shown as a count and minutes), actions created / accepted / rejected / edited / deleted / undo / redo / measured / typical changes, and, from the pieces as they are now, the live counted pieces the person made on the sheet, how many are typical and how many have no length. Read-only. Tested on synthetic logs (gap boundary at exactly 5 minutes, sheet switching, two people, deleted pieces, CSV quoting).

## Verified in a real browser
`worker/tools/phase10_shots.py` on the made-up drawing of Phase 9 in a scratch database (dropped afterwards): with the pilot on the tabs include count and report; a piece with typical x6 shows the badge and the editor; the tables show "Total W 0 lb · 7 pieces without length" (6 + 1); the report shows 2 created, 2 pieces, 1 typical, 2 without length. It showed the tab row overflowing with eight tabs (fixed: the tabs wrap) and the report table wider than the panel (now scrolls). Screenshots: `fixtures/private/shots/phase10/` (3; I looked at 2: 01 and 03).

## Proven / likely / unknown
- **Proven (ran):** migration 014 is on the real database; the title-block numbers are applied to job-018 and 139 empty pages; the 73 other changes wait for you; typical, pieces-without-length, the prefix setting and the report behave as described (tests below and the browser run).
- **Likely:** the typical multiplier is how the 62-piece size of job-018 can enter a draft (one counted piece x N with the note); the report gives time per page once people count on real pages.
- **Unknown:** any timing on real work (no person has used the pilot on a real project yet; the API on port 3000 runs older code); the accuracy of the hatch and dimension detection (no pages file); what the prefixes mean (no prefix file); whether the 73 changed sheet numbers are right.

## What was run
- Lint (`make lint`): clean. API 599 tests, worker 632, web 127, all passing (Phase 9 ended at 576, 626 and 117).
- Processes (PIDs recorded, stopped by handle): the browser demo's API, worker, web server and geckodriver, twice (pid file empty after each). No read-only API was needed. The API on port 3000 was not touched. The scratch database was dropped both times.
- **Real-database writes in this phase:** migration 014 (after a backup) and 162 sheet-number rows (job-018 in full, fill-ins elsewhere). Migration 015 is NOT applied to the real database (question 130).
