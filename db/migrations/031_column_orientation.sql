-- 031_column_orientation.sql
-- Phase 0 column orientation (worker/prereg/PHASE0_COLUMN_CAPTURE_PREREGISTRATION.md). Additive.
--   members.orientation_deg: the direction of a column's WEB (the line between the two flanges of a W or
--     W with cover plates; the long side of a rectangular HSS; a side of a square HSS), measured
--     COUNTER-CLOCKWISE as seen on screen from the drawing's +X axis (to the right), in the DISPLAYED
--     page frame (the page after the PDF's own /Rotate; y down on screen), in degrees, normalised to the
--     symbol's symmetry: [0, 180) for W, W with cover plates and rectangular HSS; [0, 90) for a square
--     HSS; NULL for a round HSS or when it could not be read. This is the value the 3D (Tekla) step reads.
--     members.rotation_deg (clockwise, web vertical at 0) stays for the marker and is kept equal to
--     (90 - orientation_deg) mod 180 when the orientation is set.
--   members.orientation_state: clear (read from the symbol, green), unsure (read but doubtful, amber),
--     manual (a person set it; the person's edit is a member_edits row, field 'orientation'), none.
--   members.orientation_source: click (the example column), match (a Find similar match, read from its
--     own lines), manual, backfill.
-- A person's later change is an append-only member_edits row (field_name 'orientation', value
-- {"deg": number | null, "state": "manual"}): undo works like every other edit. No existing row changes.

ALTER TABLE members
  ADD COLUMN orientation_deg    NUMERIC,
  ADD COLUMN orientation_state  TEXT CHECK (orientation_state IN ('clear', 'unsure', 'manual', 'none')),
  ADD COLUMN orientation_source TEXT CHECK (orientation_source IN ('click', 'match', 'manual', 'backfill'));
