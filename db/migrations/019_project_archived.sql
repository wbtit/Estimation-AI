-- 019_project_archived.sql
-- Phase 11b UI: old test projects are hidden from the projects screen ("Show archived" shows them).
ALTER TABLE projects ADD COLUMN archived boolean NOT NULL DEFAULT false;
