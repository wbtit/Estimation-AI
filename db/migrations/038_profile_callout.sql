-- 038_profile_callout.sql
-- Phase 0 profile from callout (+ profile search). Additive only: existing rows and behaviour are
-- unchanged (a member with no profile_source keeps today's meaning).

-- Every size label (profile, joist) of a view, read from the page text by the worker: the profile
-- search reads these rows, and Find similar / hand-placed columns take their profile from them.
CREATE TABLE page_labels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id      UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  view_id       UUID NOT NULL REFERENCES build_views(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,                                       -- the text line as written
  raw           TEXT NOT NULL,                                       -- the size as written
  canonical     TEXT,                                                -- W12X26, HSS12X12X3/8 (NULL for a joist)
  family        TEXT,                                                -- W, HSS, L, ..., JOIST
  kind          TEXT NOT NULL CHECK (kind IN ('profile', 'joist')),
  valid         BOOLEAN NOT NULL DEFAULT false,                      -- in the AISC catalog with a weight > 0
  catalog_name  TEXT,
  flags         TEXT[] NOT NULL DEFAULT '{}',                        -- existing, typical, joist
  tag           TEXT,                                                -- a mark tag on the same line (BP1)
  x0 NUMERIC NOT NULL, y0 NUMERIC NOT NULL, x1 NUMERIC NOT NULL, y1 NUMERIC NOT NULL,
  leaders       JSONB NOT NULL DEFAULT '[]',                         -- far ends [[x, y], ...] of leader lines
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX page_labels_sheet_idx ON page_labels (sheet_id);
CREATE INDEX page_labels_canonical_idx ON page_labels (canonical);
-- a label is one place on one view: a re-read keeps the row (and the members linked to it)
CREATE UNIQUE INDEX page_labels_place_uq
  ON page_labels (sheet_id, view_id, x0, y0, x1, y1, (COALESCE(canonical, raw)));

-- When the labels of a sheet were read (NULL: not read yet) and how many text lines it had (0 with
-- no text layer: the page card says so).
ALTER TABLE sheets
  ADD COLUMN labels_read_at TIMESTAMPTZ,
  ADD COLUMN labels_text_lines INTEGER;

-- Where a member's profile came from.
ALTER TABLE members
  ADD COLUMN profile_source   TEXT CONSTRAINT members_profile_source_check
    CHECK (profile_source IN ('label', 'typical', 'example', 'person')),
  ADD COLUMN profile_label_id UUID,   -- page_labels.id (no foreign key: a re-read must never touch a member)
  ADD COLUMN profile_link     JSONB;   -- {method, confidence, reason, valid, competitor, note, existing}

-- Two new logged actions: an accepted "Mark all" of the profile search, and an applied list of
-- profile proposals (each one undoable action).
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role', 'approve', 'project',
   'session', 'export', 'find_similar', 'profile_mark', 'profile_apply'));
