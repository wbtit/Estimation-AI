# Phase 9 results

Branch `phase-9` (from `phase-8`). Local only, nothing pushed.

## Part A: housekeeping (owner-approved)
- **Backup.** `pg_dump -Fc` of the real database to `fixtures/private/backups/` (git-ignored), 118,522,222 bytes (113 MB). Checked readable with `pg_restore -l` (16 table-data entries).
- **Migration 013_count_mode.sql applied** to the real database with `npm run migrate` (1 applied, 13 total; the 12 earlier ones were skipped as already applied). Before: 16 tables. After: 19 tables.
  - Before: catalog_shapes, glyph_library, jobs, legend_rows, member_edits, member_kinds, members, project_files, project_grade_rules, projects, rate_table, schema_migrations, sheet_edits, sheet_views, sheets, text_items.
  - Added: count_actions, measurements, sheet_lines (plus new columns on projects and members). Existing rows untouched (56 projects before and after).
- **Scratch database `estimation_ai_phase8demo_test` dropped.** Remaining databases: estimation_ai, estimation_ai_test (the test-suite database), and the postgres system ones.
