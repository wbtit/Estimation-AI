-- 001_initial_schema.sql
-- Core tables for the estimate stage (docs/SPEC.md sections 5 and 9, schema_version 0).
--
-- Conventions:
--   * Lengths and elevations are canonical millimetres (*_mm). Original display strings
--     from the drawing are kept alongside in *_raw columns.
--   * Missing extracted values are stored as NULL and flagged by the validator. Columns
--     are nullable on purpose so incomplete members are kept, never dropped or defaulted.
--   * members holds the values as extracted (or entered). Human corrections live only in
--     member_edits; the effective value of a field is its latest edit, else the member column.
--   * Computed values (length, weight, cost) are not stored here; the engine derives them.

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Projects --------------------------------------------------------------------------------
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version  INTEGER NOT NULL DEFAULT 0,
  name            TEXT NOT NULL,
  number          TEXT,
  status          TEXT NOT NULL,
  design_standard TEXT NOT NULL DEFAULT 'AISC',
  unit_system     TEXT NOT NULL DEFAULT 'mm',
  location        TEXT,
  grids           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{axis, label, position_mm}], labels stored verbatim
  levels          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, elevation_mm}]
  drawing_issue   TEXT,                                -- issue / revision label
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sheets ----------------------------------------------------------------------------------
CREATE TABLE sheets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_number   TEXT,                                 -- e.g. S030; NULL until identified
  title          TEXT,
  kind           TEXT NOT NULL DEFAULT 'other'
                 CHECK (kind IN ('plan', 'schedule', 'detail', 'notes', 'other')),
  page_index     INTEGER NOT NULL CHECK (page_index >= 0),
  scale_parsed   TEXT,
  scale_override TEXT,
  scale_source   TEXT,
  tos_notes      TEXT,
  crop_region    JSONB,                                -- bbox
  build_status   TEXT NOT NULL DEFAULT 'not_built'
                 CHECK (build_status IN ('not_built', 'building', 'built', 'failed')),
  built_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sheets_project_id_idx ON sheets (project_id);
CREATE UNIQUE INDEX sheets_project_sheet_number_uq
  ON sheets (project_id, sheet_number) WHERE sheet_number IS NOT NULL;

-- Members ---------------------------------------------------------------------------------
CREATE TABLE members (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id                UUID REFERENCES sheets(id) ON DELETE CASCADE,  -- NULL for form-entered members
  member_id               TEXT NOT NULL,                                 -- stable id across rebuilds/revisions
  origin                  TEXT NOT NULL CHECK (origin IN ('extracted', 'manual', 'seed')),
  type                    TEXT NOT NULL CHECK (type IN ('beam', 'column', 'brace', 'joist', 'other')),
  mark                    TEXT,

  profile_raw             TEXT,                                          -- exactly as on the drawing
  profile                 TEXT,                                          -- normalized catalog name, NULL if unresolved
  material                TEXT,                                          -- never defaulted
  grade                   TEXT,                                          -- never defaulted

  start_grid_x            TEXT,
  start_grid_y            TEXT,
  start_offset_x_mm       NUMERIC,
  start_offset_y_mm       NUMERIC,
  start_elevation_mm      NUMERIC,
  start_elevation_raw     TEXT,
  start_x_mm              NUMERIC,
  start_y_mm              NUMERIC,
  start_z_mm              NUMERIC,
  start_resolution_method TEXT,

  end_grid_x              TEXT,
  end_grid_y              TEXT,
  end_offset_x_mm         NUMERIC,
  end_offset_y_mm         NUMERIC,
  end_elevation_mm        NUMERIC,
  end_elevation_raw       TEXT,
  end_x_mm                NUMERIC,
  end_y_mm                NUMERIC,
  end_z_mm                NUMERIC,
  end_resolution_method   TEXT,

  level                   TEXT,
  rotation_deg            NUMERIC,
  camber_raw              TEXT,
  camber_mm               NUMERIC,
  studs                   INTEGER CHECK (studs >= 0),                    -- NULL = not stated
  quantity                INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  supported_by            TEXT[] NOT NULL DEFAULT '{}',                  -- stable member_ids
  connection_type         TEXT,                                          -- label only in v0
  connection_raw          TEXT,
  coating                 TEXT,

  source_bbox             JSONB,
  source_callout_ref      TEXT,
  field_sources           JSONB NOT NULL DEFAULT '{}'::jsonb,            -- {field: {sheet_id, bbox, callout_ref}}
  field_confidence        JSONB NOT NULL DEFAULT '{}'::jsonb,            -- {field: 0..1}
  confidence              NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  status_color            TEXT CHECK (status_color IN ('green', 'amber', 'red')),  -- NULL = not validated yet
  status_reason           TEXT,
  review_status           TEXT NOT NULL DEFAULT 'unreviewed'
                          CHECK (review_status IN ('unreviewed', 'approved', 'edited', 'rejected')),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT members_project_member_id_uq UNIQUE (project_id, member_id)
);

CREATE INDEX members_sheet_id_idx ON members (sheet_id);

-- Member edits (human corrections, append-only) ---------------------------------------------
CREATE TABLE member_edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,
  original_value  JSONB,
  corrected_value JSONB,
  review_status   TEXT NOT NULL CHECK (review_status IN ('approved', 'edited', 'rejected')),
  reviewer        TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX member_edits_member_field_idx ON member_edits (member_id, field_name, created_at);

-- Rate table (pricing inputs supplied by estimators; rows are placeholders until confirmed) --
CREATE TABLE rate_table (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT NOT NULL UNIQUE,
  category       TEXT NOT NULL,
  value          NUMERIC NOT NULL,
  unit           TEXT NOT NULL,
  is_placeholder BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catalog shapes (imported from the AISC shapes database; no rows seeded here) -------------
CREATE TABLE catalog_shapes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition          TEXT NOT NULL,                      -- catalog source/version of the import
  shape_name       TEXT NOT NULL,
  family           TEXT NOT NULL,
  weight_kg_per_m  NUMERIC NOT NULL CHECK (weight_kg_per_m > 0),
  weight_lb_per_ft NUMERIC CHECK (weight_lb_per_ft > 0),
  properties       JSONB NOT NULL DEFAULT '{}'::jsonb, -- remaining catalog columns as imported
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_shapes_edition_shape_uq UNIQUE (edition, shape_name)
);

CREATE INDEX catalog_shapes_shape_name_idx ON catalog_shapes (shape_name);

-- Jobs (Node -> Python handoff; workers claim rows with FOR UPDATE SKIP LOCKED) ------------
CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX jobs_claimable_idx ON jobs (created_at) WHERE status IN ('pending', 'processing');

-- updated_at triggers ---------------------------------------------------------------------
CREATE TRIGGER projects_set_updated_at   BEFORE UPDATE ON projects   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sheets_set_updated_at     BEFORE UPDATE ON sheets     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER members_set_updated_at    BEFORE UPDATE ON members    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rate_table_set_updated_at BEFORE UPDATE ON rate_table FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_set_updated_at       BEFORE UPDATE ON jobs       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
