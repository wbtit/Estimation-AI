-- 021_view_undo.sql
-- Phase 11c polish round (docs/PHASE11C_PLAN.md, P2): adding a view, deleting a view and changing a
-- view's box go on the person's Undo stack. One row per undoable view change holds the state before
-- it; an undo puts that state back and stamps undone_at (rows are never deleted). For a delete the
-- snapshot holds the view row, its pens, exclude boxes and deselections, the untouched pieces'
-- member rows and their support-node links, and the ids of edited pieces moved to the first view.
-- Additive only: no existing row changes.
CREATE TABLE view_undo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id    UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  view_id     UUID NOT NULL,                  -- no FK: a deleted view's id is kept to restore it
  kind        TEXT NOT NULL CHECK (kind IN ('add', 'delete', 'box')),
  snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  who         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at   TIMESTAMPTZ,
  undone_by   TEXT
);
CREATE INDEX view_undo_open_idx ON view_undo (project_id, who, created_at) WHERE undone_at IS NULL;
