# Pilot preparation (branch `pilot-prep`, from `phase-10`)

Local only, nothing pushed. Owner decisions 130, 132, 133 and 134 are in the Decision Log of `docs/SPEC.md`.

## Step 1: backup and migration 015
- Fresh `pg_dump -Fc` of the real database to `fixtures/private/backups/` (git-ignored), 118,554,084 bytes, readable (`pg_restore -l`, 19 table-data entries).
- Migration `015_typical_prefix_kinds.sql` applied (`npm run migrate`: 1 applied, 15 total).
  - Before: 19 tables (catalog_shapes, count_actions, glyph_library, jobs, legend_rows, measurements, member_edits, member_kinds, members, project_files, project_grade_rules, projects, rate_table, schema_migrations, sheet_edits, sheet_lines, sheet_views, sheets, text_items); the action log accepted 10 action names.
  - After: 20 tables (+ `project_prefix_kinds`, 0 rows); the action log accepts 12 (+ `typical`, `prefix_map`). 56 projects before and after.

## Step 2: decision 133 (one counting rule)
The Stage 1 tables (screen and Excel) now count each piece with the takeoff's rule: its label quantity, times N when it is typical, and 0 for a second label on a line that already carries its piece. Before, the tables counted 1 per piece (N for a typical one). Tests: `api/src/__tests__/tables-same-rule.test.ts` (a label of quantity 3, a shared line, tables total = takeoff total = 5) and the updated typical test (base quantity 2 x 4 = 8 in both).

## Step 3: pilot copy of job-018 (`pilot-01`)
Tool: `worker/tools/copy_project.py` (logic in `worker/src/review/copy_project.py`, tests in `worker/tests/test_copy_project.py`). Preview first, then one transaction.
- **Preview (nothing written):** to copy: 1 PDF, 23 sheets, 0 sheet decisions, 23 views, 0 stored line sets, 14,760 text items, 0 legend rows, 0 grade rules, 357 system-made members. Not to copy: 0 person-added members, 0 member edits, 0 count actions, 0 measurements, 0 prefix rows (job-018 had none of these).
- **Applied:** new project `pilot-01` with exactly those counts. Its PDF and page thumbnails are new copies under its own folder (deleting either project never removes the other's file). All 357 members start as undecided suggestions; count mode was off after the copy.
- **The original is untouched:** its row counts before and after are identical (1 file, 23 sheets, 23 views, 14,760 text items, 357 members, 0 edits, 0 actions, 0 measurements), and a content hash of its members, sheets and member edits is the same before and after.
- **Checked through the app's own code** (a read-only API on port 3100, started and stopped by its PID): original and pilot both give 357 members (all suggested), 124 pieces in the takeoff and in the tables, 23 sheets, thumbnails served.
- **Scale:** copied as stored: 21 of the 23 views have a GUESSED scale and none is confirmed (2 have none). The measure tool needs a confirmed scale, so the estimator confirms it on each page first (see the runbook).
