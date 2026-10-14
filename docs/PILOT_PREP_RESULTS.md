# Pilot preparation (branch `pilot-prep`, from `phase-10`)

Local only, nothing pushed. Owner decisions 130, 132, 133 and 134 are in the Decision Log of `docs/SPEC.md`.

## Step 1: backup and migration 015
- Fresh `pg_dump -Fc` of the real database to `fixtures/private/backups/` (git-ignored), 118,554,084 bytes, readable (`pg_restore -l`, 19 table-data entries).
- Migration `015_typical_prefix_kinds.sql` applied (`npm run migrate`: 1 applied, 15 total).
  - Before: 19 tables (catalog_shapes, count_actions, glyph_library, jobs, legend_rows, measurements, member_edits, member_kinds, members, project_files, project_grade_rules, projects, rate_table, schema_migrations, sheet_edits, sheet_lines, sheet_views, sheets, text_items); the action log accepted 10 action names.
  - After: 20 tables (+ `project_prefix_kinds`, 0 rows); the action log accepts 12 (+ `typical`, `prefix_map`). 56 projects before and after.

## Step 2: decision 133 (one counting rule)
The Stage 1 tables (screen and Excel) now count each piece with the takeoff's rule: its label quantity, times N when it is typical, and 0 for a second label on a line that already carries its piece. Before, the tables counted 1 per piece (N for a typical one). Tests: `api/src/__tests__/tables-same-rule.test.ts` (a label of quantity 3, a shared line, tables total = takeoff total = 5) and the updated typical test (base quantity 2 x 4 = 8 in both).
