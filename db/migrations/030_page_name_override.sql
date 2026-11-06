-- 030_page_name_override.sql
-- A person can correct the page name and the sheet number of a page (fix/crop-anywhere, 2026-11-06).
--   name_override: the person's page name; the page shows it instead of the name read on the page
--     (view_title, else title_block_name). The read names stay as they were. NULL = no override.
--   sheet_number: a person's sheet number is written in place with sheet_number_source 'person'; the
--     number it replaced is kept in the append-only sheet_edits row (field_name 'sheet_number'), and
--     the scan never overwrites a person's number.
--   *_confirmed_by / *_confirmed_at: who changed it and when.

ALTER TABLE sheets
  ADD COLUMN name_override             TEXT,
  ADD COLUMN name_confirmed_by         TEXT,
  ADD COLUMN name_confirmed_at         TIMESTAMPTZ,
  ADD COLUMN sheet_number_confirmed_by TEXT,
  ADD COLUMN sheet_number_confirmed_at TIMESTAMPTZ;
