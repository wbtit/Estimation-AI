-- 002_phase2_scan.sql
-- Phase 2: uploaded PDF per project, page scan results on sheets, and an edit history for sheets.
--
--   * One page of the PDF = one sheets row, identified by (project_id, page_index).
--   * Scan columns hold extracted values and are only written by the scan job. User corrections
--     (for example the scale override) live in their own columns and are recorded in sheet_edits;
--     extracted values are never overwritten.
--   * A sheet number is extracted text, not an identity. The unique index from migration 001 is
--     replaced by a plain index; duplicates are kept and flagged.

-- The uploaded PDF (one per project) ---------------------------------------------------------
CREATE TABLE project_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,                    -- sanitized
  stored_path       TEXT NOT NULL,                    -- relative to UPLOAD_DIR
  sha256            TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0),
  page_count        INTEGER CHECK (page_count >= 0),
  pages_scanned     INTEGER NOT NULL DEFAULT 0 CHECK (pages_scanned >= 0),
  scan_status       TEXT NOT NULL DEFAULT 'pending'
                    CHECK (scan_status IN ('pending', 'scanning', 'done', 'failed')),
  scan_error        TEXT,
  scanned_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_files_set_updated_at
  BEFORE UPDATE ON project_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Scan results on sheets ---------------------------------------------------------------------
DROP INDEX sheets_project_sheet_number_uq;
CREATE INDEX sheets_project_sheet_number_idx ON sheets (project_id, sheet_number);
CREATE UNIQUE INDEX sheets_project_page_index_uq ON sheets (project_id, page_index);

ALTER TABLE sheets
  ADD COLUMN width_pt            NUMERIC CHECK (width_pt > 0),      -- as displayed (rotation applied)
  ADD COLUMN height_pt           NUMERIC CHECK (height_pt > 0),
  ADD COLUMN rotation            INTEGER CHECK (rotation IN (0, 90, 180, 270)),
  ADD COLUMN page_kind           TEXT CHECK (page_kind IN ('vector', 'scanned', 'unknown')),
  ADD COLUMN has_text_layer      BOOLEAN,
  ADD COLUMN has_vector_paths    BOOLEAN,
  ADD COLUMN text_char_count     INTEGER CHECK (text_char_count >= 0),
  ADD COLUMN vector_path_count   INTEGER CHECK (vector_path_count >= 0),
  ADD COLUMN image_count         INTEGER CHECK (image_count >= 0),
  ADD COLUMN image_coverage      NUMERIC CHECK (image_coverage BETWEEN 0 AND 1),
  ADD COLUMN sheet_number_source TEXT,                               -- how the number was found
  ADD COLUMN kind_confidence     NUMERIC CHECK (kind_confidence BETWEEN 0 AND 1),
  ADD COLUMN kind_reason         TEXT,
  ADD COLUMN scales              JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{raw, kind, ratio, count}]
  ADD COLUMN scale_parsed_ratio  NUMERIC CHECK (scale_parsed_ratio > 0),
  ADD COLUMN scale_override_ratio NUMERIC CHECK (scale_override_ratio > 0),
  ADD COLUMN needs_review        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN review_reasons      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN thumbnail_path      TEXT,                               -- relative to UPLOAD_DIR
  ADD COLUMN scanned_at          TIMESTAMPTZ;

-- Edit history for sheets (append-only) -------------------------------------------------------
-- original_value is the effective value before the edit, corrected_value the value after it.
-- The extracted value always stays in its own column.
CREATE TABLE sheet_edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id        UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,
  original_value  JSONB,
  corrected_value JSONB,
  editor          TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sheet_edits_sheet_idx ON sheet_edits (sheet_id, created_at);
