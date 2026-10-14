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
