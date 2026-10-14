-- 013_count_mode.sql
-- Phase 8 Part B/C: the counting copilot. The system suggests, the estimator confirms with clicks,
-- every count keeps evidence. Additive only: existing rows and behaviour are unchanged
-- (count_mode is off by default; a member that nobody decided stays 'suggested').

-- Project settings. count_mode = true: totals, tables and exports take CONFIRMED pieces only.
ALTER TABLE projects
  ADD COLUMN count_mode      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN snap_radius_pt  NUMERIC NOT NULL DEFAULT 24 CHECK (snap_radius_pt > 0),
  ADD COLUMN label_radius_pt NUMERIC NOT NULL DEFAULT 80 CHECK (label_radius_pt > 0);

-- Count state and click evidence of a piece (the stored value; a person's later decision is a
-- member_edits row, so it can be undone). state: suggested (the system found it, nobody decided),
-- confirmed, rejected. source: how a confirmed piece came to be.
ALTER TABLE members
  ADD COLUMN count_state         TEXT NOT NULL DEFAULT 'suggested'
    CHECK (count_state IN ('suggested', 'confirmed', 'rejected')),
  ADD COLUMN count_source        TEXT CHECK (count_source IN ('human_click', 'suggestion_accepted')),
  ADD COLUMN click_x             NUMERIC,
  ADD COLUMN click_y             NUMERIC,
  ADD COLUMN click_at            TIMESTAMPTZ,
  ADD COLUMN snapped             BOOLEAN,
  ADD COLUMN snapped_line        JSONB,      -- {id, p, q, class, version}: the extracted line the click snapped to
  ADD COLUMN snapped_distance_pt NUMERIC,
  ADD COLUMN size_source         TEXT CHECK (size_source IN ('linked_label', 'nearest_label', 'manual', 'none')),
  ADD COLUMN size_evidence       JSONB;      -- {member_id, distance_pt} of the label the size was taken from

-- Every extracted line of a sheet, of ANY class (the snap targets). Written by the sheet_lines job.
CREATE TABLE sheet_lines (
  sheet_id   UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  classes    JSONB NOT NULL,                 -- ["0.5-1|black|solid", ...]
  lines      JSONB NOT NULL,                 -- [[x0, y0, x1, y1, class_index, width], ...] displayed page points
  n_lines    INTEGER NOT NULL,
  version    TEXT NOT NULL,                  -- hash of the lines: evidence stays meaningful after a re-extraction
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The action log: every create, accept, reject, edit, delete, undo and redo of the copilot, with
-- time, so time per page can be measured and clean member-linked labels can be collected later.
CREATE TABLE count_actions (
  id             BIGSERIAL PRIMARY KEY,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id       UUID REFERENCES sheets(id) ON DELETE SET NULL,
  member_id      UUID REFERENCES members(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN
                   ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length', 'mode')),
  who            TEXT NOT NULL,
  edit_action_id UUID,                       -- the member_edits action this belongs to, if any
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX count_actions_project_time ON count_actions (project_id, created_at);
CREATE INDEX count_actions_sheet ON count_actions (sheet_id, created_at);

-- Two-click measurements (Part C). A measurement may be attached to a piece (member_id).
CREATE TABLE measurements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id    UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  a           JSONB NOT NULL,                -- the click, page points {x, y}
  b           JSONB NOT NULL,
  a_snap      JSONB,                         -- {x, y, kind: endpoint|intersection, distance_pt} or null
  b_snap      JSONB,
  scale_ratio NUMERIC NOT NULL,
  length_mm   NUMERIC NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_id   UUID REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX measurements_sheet ON measurements (sheet_id, created_at);
