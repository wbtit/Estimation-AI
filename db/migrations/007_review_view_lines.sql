-- 007_review_view_lines.sql
-- Phase 5 slice 4: the structural lines of a view as the link job found them, so the review screen
-- can offer them as click targets ("link this label to that line"). Additive only.
ALTER TABLE sheet_views
  ADD COLUMN structural_lines JSONB;   -- [[x0, y0, x1, y1], ...] in displayed page points, capped
