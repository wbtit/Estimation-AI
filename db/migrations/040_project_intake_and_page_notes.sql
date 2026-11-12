-- 040_project_intake_and_page_notes.sql
-- Phase 0 project intake + page notes. Additive only: no existing row changes.
--   projects.client, projects.building_type   the owner's four project details are name, client,
--                                             location (column exists since 001) and building type;
--                                             saved from the Project details step after an upload
--                                             (every change is also a person edit in
--                                             project_detail_edits, with who and when).
--   sheet_notes                               one plain-text note per page (sheet): who / when of the
--                                             last save and a version number, so a second person
--                                             saving over a newer note is warned. Not in the BOM or
--                                             the report; last save wins.

ALTER TABLE projects
  ADD COLUMN client        TEXT,
  ADD COLUMN building_type TEXT;

CREATE TABLE sheet_notes (
  sheet_id    UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note        TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sheet_notes_project_idx ON sheet_notes (project_id);
