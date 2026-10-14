-- 015_typical_prefix_kinds.sql
-- Phase 10. Additive only: existing rows and behaviour are unchanged.
-- A "x N typical" multiplier on a counted piece is a member_edits row (field 'typical'), so it is
-- undoable like every person's change; only the action log needs to know the new action names.

ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map'));

-- The estimators' mark prefix -> kind of the scope-of-work list, per project (owner decision 124).
-- Filled by a person in the settings or from the owner's file; empty by default.
CREATE TABLE project_prefix_kinds (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{1,6}$'),
  kind       TEXT NOT NULL REFERENCES member_kinds(kind),
  set_by     TEXT NOT NULL,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, prefix)
);
