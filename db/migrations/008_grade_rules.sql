-- 008_grade_rules.sql
-- Phase 5b item 6: material/grade by shape family, SET BY A PERSON. The table is created EMPTY and
-- nothing in the system ever inserts a row: a grade is never defaulted, inferred or filled in by
-- the pipeline (the grade words highlighted in the notes panel stay a reading aid only).
-- Append-only: a change is a new row, the latest row per (project, family) wins, and a NULL grade
-- clears the rule. Additive only.
CREATE TABLE project_grade_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shape_family   TEXT NOT NULL CHECK (shape_family IN (
    'W', 'M', 'S', 'HP', 'C', 'MC', 'L', 'WT', 'MT', 'ST', 'HSS', 'PIPE', 'PL', 'ROD', 'joist')),
  grade          TEXT CHECK (grade IS NULL OR length(btrim(grade)) > 0),   -- e.g. text the person typed
  set_by         TEXT NOT NULL CHECK (length(btrim(set_by)) > 0),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX project_grade_rules_idx ON project_grade_rules (project_id, shape_family, set_at);
