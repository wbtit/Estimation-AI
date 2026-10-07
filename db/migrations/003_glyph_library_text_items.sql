-- 003_glyph_library_text_items.sql
-- Phase 4b: the glyph library (shapes of a CAD stroke font and their labels) and the text items
-- read from sheets.
--
--   * glyph_library: one row per distinct glyph shape of a font. A row is created by the reader
--     as `proposed` with no label. Only `confirmed` rows (label set by a person) decode text.
--     An OCR vote may add a `proposed_label` and `votes`, but never confirms anything.
--   * text_items: what the reader found on a sheet. The glyph-decoded text is never replaced by
--     OCR; OCR output is kept in its own column.

CREATE TABLE glyph_library (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  font_id        TEXT NOT NULL CHECK (font_id <> ''),
  signature_hash TEXT NOT NULL CHECK (signature_hash ~ '^[0-9a-f]{64}$'),
  strokes        JSONB NOT NULL,          -- normalised polylines [[[x,y],...],...] in the unit box
  label          TEXT CHECK (char_length(label) BETWEEN 1 AND 3),
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed')),
  source         TEXT NOT NULL DEFAULT 'reader' CHECK (source IN ('reader', 'ocr_vote', 'csv_import')),
  proposed_label TEXT CHECK (char_length(proposed_label) BETWEEN 1 AND 3),
  votes          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"B": 12, "8": 1}: OCR votes per character
  seen_count     INTEGER NOT NULL DEFAULT 0 CHECK (seen_count >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glyph_library_font_signature_uq UNIQUE (font_id, signature_hash),
  CONSTRAINT glyph_library_confirmed_needs_label_and_reviewer CHECK (
    status <> 'confirmed' OR (label IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX glyph_library_font_status_idx ON glyph_library (font_id, status);

CREATE TRIGGER glyph_library_set_updated_at
  BEFORE UPDATE ON glyph_library FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE text_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id       UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  item_key       TEXT NOT NULL,           -- stable key: sha-256 of the sheet and the bbox rounded to 0.5 pt
  x0             NUMERIC NOT NULL,        -- displayed page points (rotation applied), origin top-left
  y0             NUMERIC NOT NULL,
  x1             NUMERIC NOT NULL,
  y1             NUMERIC NOT NULL,
  orientation    TEXT NOT NULL CHECK (orientation IN ('horizontal', 'vertical')),
  text           TEXT,                    -- glyph-decoded text; NULL when not read (vertical text)
  ocr_text       TEXT,                    -- optional cross-check output, never copied into text
  methods        TEXT[] NOT NULL DEFAULT '{}',
  confidence     NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  agree          BOOLEAN,                 -- NULL when no cross-check ran
  needs_review   BOOLEAN NOT NULL DEFAULT FALSE,
  review_reasons TEXT[] NOT NULL DEFAULT '{}',
  char_count     INTEGER NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  unknown_count  INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  font_id        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT text_items_sheet_key_uq UNIQUE (sheet_id, item_key)
);

CREATE INDEX text_items_sheet_idx ON text_items (sheet_id);
