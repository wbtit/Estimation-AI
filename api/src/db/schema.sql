CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  -- queued | processing | review_ready | done | failed
  page_count    INT,
  progress      INT DEFAULT 0,
  current_stage TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID REFERENCES jobs(id) ON DELETE CASCADE,
  page_number           INT NOT NULL,
  image_path            TEXT NOT NULL,
  width_px              INT,
  height_px             INT,
  sheet_type            TEXT,
  -- framing_plan | elevation | section | connection_detail
  -- member_schedule | general_notes | unknown | foundation_plan
  sheet_type_confidence FLOAT,
  title_block_text      TEXT,
  detected_schedule_present BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_schedule_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID REFERENCES jobs(id) ON DELETE CASCADE,
  page_id       UUID REFERENCES pages(id) ON DELETE CASCADE,
  mark_number   TEXT,
  designation   TEXT,
  quantity      INT,
  length_ft     FLOAT,
  remarks       TEXT,
  raw_row       JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID REFERENCES jobs(id) ON DELETE CASCADE,
  page_id              UUID REFERENCES pages(id) ON DELETE CASCADE,
  page_number          INT NOT NULL,

  element_type         TEXT NOT NULL,
  -- member_callout | grid_bubble | grid_line | dimension_line
  -- section_marker | column_symbol | beam_line | connection_symbol

  raw_ocr_text         TEXT,
  ocr_confidence       FLOAT,

  designation          TEXT,
  shape_type           TEXT,
  depth_in             FLOAT,
  weight_per_foot      FLOAT,

  grid_from            TEXT,
  grid_to              TEXT,
  level                TEXT,
  length_ft            FLOAT,
  total_weight_lb      FLOAT,

  schedule_mark        TEXT,
  source_sheet_id      TEXT,
  cross_ref_text       TEXT,
  cross_ref_resolved   BOOLEAN DEFAULT FALSE,

  bbox_x               FLOAT NOT NULL,
  bbox_y               FLOAT NOT NULL,
  bbox_w               FLOAT NOT NULL,
  bbox_h               FLOAT NOT NULL,

  yolo_confidence      FLOAT NOT NULL,
  ocr_confidence_score FLOAT,
  confidence_score     FLOAT,
  needs_review         BOOLEAN DEFAULT FALSE,
  review_reason        TEXT,
  -- ocr_unreadable | callout_unparseable | grid_unresolved
  -- no_schedule_match | cross_sheet_missing | low_detection_confidence

  reviewed_by          TEXT,
  corrected_label      TEXT,
  review_notes         TEXT,
  reviewed_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cross_references (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID REFERENCES jobs(id) ON DELETE CASCADE,
  source_sheet_id    TEXT NOT NULL,
  source_page_number INT NOT NULL,
  reference_text     TEXT NOT NULL,
  target_sheet_id    TEXT,
  target_detail_num  INT,
  resolved           BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS missing_sheets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID REFERENCES jobs(id) ON DELETE CASCADE,
  referenced_sheet TEXT NOT NULL,
  referenced_from  TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detections_job_id     ON detections(job_id);
CREATE INDEX IF NOT EXISTS idx_detections_needs_review ON detections(job_id, needs_review);
CREATE INDEX IF NOT EXISTS idx_pages_job_id          ON pages(job_id);
