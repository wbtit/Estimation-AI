-- 006_review_view_classes.sql
-- Phase 5: the stroke classes seen inside a view (written by the link job) and whether the user has
-- confirmed which of them hold the member lines. Additive only.
ALTER TABLE sheet_views
  ADD COLUMN class_table       JSONB,                           -- [{key, lines, length_pt}] inside the view
  ADD COLUMN classes_confirmed BOOLEAN NOT NULL DEFAULT FALSE;  -- structural_classes chosen by a person
