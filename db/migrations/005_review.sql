-- 005_review.sql
-- Phase 5 (review screen, takeoff table). Additive only: no existing column or table changes.
-- A subset of docs/SCHEMA_CHANGE_PROPOSAL.md plus what the review slices need (docs/PHASE5_PLAN.md).
-- Original extracted values are never overwritten; human changes are member_edits rows.

-- Sheets: page type and level guesses (overrides go to sheet_edits), plan frame facts --------------
ALTER TABLE sheets
  ADD COLUMN page_type_guess  TEXT CHECK (page_type_guess IN (
    'framing_plan', 'foundation_plan', 'elevation', 'detail', 'schedule_legend',
    'general_notes', 'other')),
  ADD COLUMN page_type_reason TEXT,        -- the rules that matched, never the page text
  ADD COLUMN level_guess      TEXT,        -- suggested from the title; editable via sheet_edits
  ADD COLUMN plan_frame       JSONB;       -- {width_pt, height_pt, rotation}: displayed page facts

-- Views: a box drawn on a sheet, with its own scale (a page can hold several scales) ---------------
CREATE TABLE sheet_views (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id           UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name               TEXT,
  box                JSONB NOT NULL,       -- {x0, y0, x1, y1} in displayed page points
  scale_ratio        NUMERIC CHECK (scale_ratio > 0),   -- real length / drawn length
  scale_source       TEXT CHECK (scale_source IN ('detected_text', 'user_confirmed')),
  scale_text         TEXT,                 -- the scale as written or typed
  scale_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,    -- members are not measured until true
  structural_classes TEXT[] NOT NULL DEFAULT '{}',      -- stroke classes the user confirmed as members
  plan_frame         JSONB,                -- {origin_pt: [x, y], y_up: true}: lower-left of the box
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sheet_views_sheet_idx ON sheet_views (sheet_id);
CREATE TRIGGER sheet_views_set_updated_at
  BEFORE UPDATE ON sheet_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Legend and schedule rows found in the document text (mark -> designation) ------------------------
CREATE TABLE legend_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id        UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  mark            TEXT NOT NULL,
  designation_raw TEXT NOT NULL,           -- as on the drawing
  profile         TEXT,                    -- canonical profile if the designation parses
  remarks_raw     TEXT,
  source          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {text_item_key, bbox}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX legend_rows_project_mark_idx ON legend_rows (project_id, mark);

-- Members: plan position, link suggestion, legend link ---------------------------------------------
ALTER TABLE members
  ADD COLUMN view_id            UUID REFERENCES sheet_views(id) ON DELETE SET NULL,
  ADD COLUMN label_key          TEXT,       -- stable key of the source label (sheet, bbox, text)
  ADD COLUMN mark_ref_status    TEXT CHECK (mark_ref_status IN ('linked', 'no_legend_row', 'ambiguous')),
  ADD COLUMN legend_row_id      UUID REFERENCES legend_rows(id) ON DELETE SET NULL,
  ADD COLUMN length_source      TEXT CHECK (length_source IN ('plan_geometry', 'manual')),
  ADD COLUMN plan_sheet_id      UUID REFERENCES sheets(id) ON DELETE SET NULL,
  ADD COLUMN plan_start_x_mm    NUMERIC,    -- plan frame of the view: origin lower-left, y up, mm
  ADD COLUMN plan_start_y_mm    NUMERIC,
  ADD COLUMN plan_end_x_mm      NUMERIC,
  ADD COLUMN plan_end_y_mm      NUMERIC,
  ADD COLUMN plan_bbox          JSONB,      -- bbox of the proposed line, displayed page points
  ADD COLUMN plan_scale_ratio   NUMERIC CHECK (plan_scale_ratio > 0),
  ADD COLUMN plan_method        TEXT CHECK (plan_method IN ('pdf_geometry', 'manual')),
  ADD COLUMN link_candidates    JSONB,      -- top 3: [{rank, p, q, score, dist, rel_angle}]
  ADD COLUMN link_confidence    TEXT CHECK (link_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN link_margin        NUMERIC,    -- score gap between the best two candidates
  ADD COLUMN link_rule          TEXT;       -- the frozen rule version that proposed the link

CREATE UNIQUE INDEX members_project_label_key_uq
  ON members (project_id, label_key) WHERE label_key IS NOT NULL;
CREATE INDEX members_view_idx ON members (view_id);

-- Member edits: actions group edits; an undo appends inverse rows (nothing is deleted) -------------
ALTER TABLE member_edits
  ADD COLUMN action_id         UUID,
  ADD COLUMN undo_of_action_id UUID;

CREATE INDEX member_edits_action_idx ON member_edits (action_id);
