-- Review 3, item 4: the project's default column height (mm; typed in feet-inches in the UI). null =
-- not set (the BOM shows "no height" for a column with no other source, never a made-up number).
-- A column's own height and its optional top / base elevations are person edits (member_edits fields
-- column_height, column_top, column_base), so no members column is needed. Additive only.
ALTER TABLE projects
  ADD COLUMN default_column_height_mm NUMERIC CHECK (default_column_height_mm IS NULL OR default_column_height_mm > 0);
