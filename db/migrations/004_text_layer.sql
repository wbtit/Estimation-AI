-- 004_text_layer.sql
-- Phase 4d: text items read from the PDF text layer, and the evidence behind scanned values.
-- Additive and nullable only. No existing column changes; the member contract and its
-- migrations are not touched.

ALTER TABLE text_items
  ADD COLUMN angle_deg NUMERIC,                                  -- baseline angle, degrees CCW, 0 = left to right
  ADD COLUMN level     TEXT CHECK (level IN ('word', 'line')),   -- pdf_text granularity
  ADD COLUMN parsed    JSONB;                                    -- deterministic parser output

ALTER TABLE sheets
  ADD COLUMN text_source   TEXT CHECK (text_source IN ('pdf_text', 'glyph', 'none')),
  ADD COLUMN text_quality  NUMERIC CHECK (text_quality BETWEEN 0 AND 1),
  ADD COLUMN scan_evidence JSONB;
