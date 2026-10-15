-- 016_line_first_build.sql
-- Phase 11: the line-first build (docs/PHASE7_AUDIT.md section 3). Additive only: no existing
-- column, constraint or row changes, so label-first projects behave exactly as before.
--
-- A page is built only after a person confirmed its crop, scale, T.O.S. and beam pen class. Every
-- build is a build_runs row (inputs, counts, notes such as "no registration", error). Its geometry
-- (grid lines, support nodes, beam lines) belongs to the run. The pieces are members rows with the
-- build columns below; a piece a person touched (an edit row, reviewed, or confirmed) is never
-- changed by a rebuild: member_edits stays the source of truth for edits.

-- Per-page setup of the build (who and when for every confirmation). crop_region, tos_notes,
-- build_status and built_at exist since 001 and are reused: crop_region is the confirmed crop box
-- {x0, y0, x1, y1} in displayed page points; tos_notes keeps parsed notes as before.
ALTER TABLE sheets
  ADD COLUMN crop_confirmed_by      TEXT,
  ADD COLUMN crop_confirmed_at      TIMESTAMPTZ,
  ADD COLUMN build_scale_ratio      NUMERIC CHECK (build_scale_ratio > 0),  -- real / drawn
  ADD COLUMN build_scale_text       TEXT,
  ADD COLUMN scale_confirmed_by     TEXT,
  ADD COLUMN scale_confirmed_at     TIMESTAMPTZ,
  ADD COLUMN tos_mm                 NUMERIC,     -- top of steel of the page, mm (0 is a value)
  ADD COLUMN tos_raw                TEXT,        -- as read or typed
  ADD COLUMN tos_source             TEXT CHECK (tos_source IN ('read', 'typed')),
  ADD COLUMN tos_confirmed_by       TEXT,
  ADD COLUMN tos_confirmed_at       TIMESTAMPTZ,
  ADD COLUMN pen_class              TEXT,        -- stroke class key (width bucket|colour|solid/dash)
  ADD COLUMN pen_class_source       TEXT CHECK (pen_class_source IN ('suggested', 'person')),
  ADD COLUMN pen_class_confirmed_by TEXT,
  ADD COLUMN pen_class_confirmed_at TIMESTAMPTZ,
  ADD COLUMN build_role             TEXT CHECK (build_role IN ('column_plan', 'framing')),
  ADD COLUMN registration           JSONB;       -- page -> project plan transform of the last build

-- One row per Build press (also refused and failed ones).
CREATE TABLE build_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id      UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'failed', 'refused')),
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  inputs        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- crop, scale, T.O.S., pen class, column plan
  rules_version TEXT,
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes         TEXT[] NOT NULL DEFAULT '{}',        -- e.g. no_registration, no_column_plan
  error         TEXT
);
CREATE INDEX build_runs_sheet_idx ON build_runs (sheet_id, started_at);

-- Grid lines found on a page by a build (or drawn by a person), in displayed page points.
CREATE TABLE grid_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id     UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  build_run_id UUID REFERENCES build_runs(id) ON DELETE CASCADE,
  label        TEXT,                                -- exact characters from the bubble
  family       TEXT CHECK (family IN ('N', 'A')),   -- digits, or anything else
  x0 NUMERIC NOT NULL, y0 NUMERIC NOT NULL, x1 NUMERIC NOT NULL, y1 NUMERIC NOT NULL,
  bubble       JSONB,                               -- {cx, cy, r}
  source       TEXT NOT NULL CHECK (source IN ('found', 'person')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grid_lines_sheet_idx ON grid_lines (sheet_id);

-- Points where a beam may be supported: a column glyph on the page, a column projected from the
-- column plan through the registration, a beam-to-beam intersection (a girder), or a person.
CREATE TABLE support_nodes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id         UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  build_run_id     UUID REFERENCES build_runs(id) ON DELETE CASCADE,
  x_pt NUMERIC NOT NULL, y_pt NUMERIC NOT NULL,
  plan_x_mm        NUMERIC,
  plan_y_mm        NUMERIC,
  grid_x           TEXT,
  grid_y           TEXT,
  source           TEXT NOT NULL
                   CHECK (source IN ('glyph', 'projected', 'beam_intersection', 'person')),
  column_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  evidence         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_nodes_sheet_idx ON support_nodes (sheet_id);

-- A beam line before it is split into pieces: the merged segments of the confirmed pen class.
CREATE TABLE beam_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id        UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  build_run_id    UUID REFERENCES build_runs(id) ON DELETE CASCADE,
  x0 NUMERIC NOT NULL, y0 NUMERIC NOT NULL, x1 NUMERIC NOT NULL, y1 NUMERIC NOT NULL,
  source_segments INTEGER NOT NULL CHECK (source_segments > 0),
  gaps_bridged    INTEGER NOT NULL DEFAULT 0 CHECK (gaps_bridged >= 0),
  gaps_pt         JSONB NOT NULL DEFAULT '[]'::jsonb,
  pen_class       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('girder', 'beam')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX beam_lines_sheet_idx ON beam_lines (sheet_id);

-- Piece fields of a built member. Category = members.kind (member_kinds); type stays filled.
-- Length comes from the resolved end points (start/end x, y, z in mm), as for every member.
ALTER TABLE members
  ADD COLUMN build_run_id   UUID REFERENCES build_runs(id) ON DELETE SET NULL,
  ADD COLUMN beam_line_id   UUID REFERENCES beam_lines(id) ON DELETE SET NULL,
  ADD COLUMN piece_index    INTEGER CHECK (piece_index IS NULL OR piece_index > 0),  -- B_1, B_2 ...
  ADD COLUMN page_x0        NUMERIC,   -- displayed page points, start
  ADD COLUMN page_y0        NUMERIC,
  ADD COLUMN page_x1        NUMERIC,   -- end
  ADD COLUMN page_y1        NUMERIC,
  ADD COLUMN start_node_id  UUID REFERENCES support_nodes(id) ON DELETE SET NULL,
  ADD COLUMN end_node_id    UUID REFERENCES support_nodes(id) ON DELETE SET NULL,
  ADD COLUMN support_state  TEXT CHECK (support_state IN ('both', 'one', 'none')),
  ADD COLUMN size_state     TEXT CHECK (size_state IN ('sized', 'inferred', 'undefined')),
  ADD COLUMN build_state    TEXT CHECK (build_state IN ('found', 'needs_review', 'attention')),
  ADD COLUMN label_evidence JSONB;     -- {size: {rule, text, distance_pt, ...}, studs, camber}
CREATE INDEX members_build_run_idx ON members (build_run_id) WHERE build_run_id IS NOT NULL;
