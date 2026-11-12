-- 039_project_details.sql
-- Phase 0 cover details + drawing index check. Additive only: no existing row changes.
--   project_details        the value the reader found for a field (one row per project and field)
--                          with its source page and box, the rule, a confidence, flags, the other
--                          candidates and the name / number agreement. Not found = no row.
--   project_detail_edits   append-only: a person's edit, "use this alternative", "use as project
--                          name / number". The effective value is the latest edit over the read
--                          value; a re-read never replaces an edit. These rows are truth data.
--   project_detail_reads   what one read did: cover pages, pages with no text, timing.
--   drawing_index_rows     the rows of the drawing index found on the cover / index pages and how
--                          they match our pages.
--   drawing_index_flags    what does not fit (suggestions only; nothing is ever changed).

CREATE TABLE project_details (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  value       TEXT NOT NULL,
  page_index  INTEGER NOT NULL,
  box         JSONB NOT NULL,                     -- [x0, y0, x1, y1] displayed page points
  rule        TEXT NOT NULL,
  confidence  TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  flags       TEXT[] NOT NULL DEFAULT '{}',
  alternatives JSONB NOT NULL DEFAULT '[]',       -- [{value, page_index, box, rule, confidence}]
  agreement   JSONB,                              -- name / number: {state, agree, differ}
  read_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, field)
);

CREATE TABLE project_detail_edits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  before      JSONB,                              -- {"value": ...} the effective value before
  after       JSONB,                              -- {"value": ...} (null value = cleared)
  kind        TEXT NOT NULL CHECK (kind IN ('edit', 'use_alternative', 'use_as_project', 'undo')),
  undo_of     UUID REFERENCES project_detail_edits(id),
  who         TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_detail_edits_idx ON project_detail_edits (project_id, field, created_at);

CREATE TABLE project_detail_reads (
  project_id     UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  read_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  cover_pages    INTEGER[] NOT NULL DEFAULT '{}',
  no_text_pages  INTEGER[] NOT NULL DEFAULT '{}',  -- cover pages with no text layer
  pages          INTEGER NOT NULL DEFAULT 0,
  seconds        NUMERIC,
  repeated       JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE drawing_index_rows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_index       INTEGER NOT NULL,               -- the index page
  number           TEXT NOT NULL,
  title            TEXT NOT NULL,
  box              JSONB NOT NULL,
  rule             TEXT NOT NULL,
  match            TEXT NOT NULL CHECK (match IN ('exact', 'equivalent', 'none')),
  matched_page     INTEGER,
  matched_sheet_id UUID REFERENCES sheets(id) ON DELETE SET NULL
);
CREATE INDEX drawing_index_rows_project_idx ON drawing_index_rows (project_id);

CREATE TABLE drawing_index_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('missing_from_pdf', 'not_in_index', 'page_no_number',
                'number_mismatch', 'number_format', 'name_mismatch', 'role_disagreement')),
  page_index  INTEGER,                            -- our page the flag is about (the jump target)
  sheet_id    UUID REFERENCES sheets(id) ON DELETE SET NULL,
  index_page  INTEGER,                            -- the index page of the row, when there is one
  number      TEXT,
  title       TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drawing_index_flags_project_idx ON drawing_index_flags (project_id);
