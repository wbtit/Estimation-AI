-- Phase 0 perimeter angle: an L-section (edge angle / pour stop / deck support angle) a person adds
-- on the top flange of a beam. It is a member row of its own (so it is a piece: tag, BOM line,
-- delete / undo like any other) linked to its parent beam. Its ends are NOT stored as the truth:
-- they are derived from the parent's current ends (so the angle follows a moved or edited beam),
-- from the optional start offset and the optional fixed length below. Additive only.
--   parent_member_id        the beam it sits on (null: not a perimeter angle)
--   angle_length_mm         a typed REAL length; null = follows the whole beam (capped at the beam)
--   angle_start_offset_mm   real distance from the beam's start to the angle's start (default 0)
--   slab_edge_side          optional, for the later 3D stage: slab edge on the left / right of the
--                           beam direction (null = not given)
--   vertical_leg            optional: which leg of an unequal angle is vertical (null = not given)
-- projects.perimeter_angle_kind / perimeter_angle_profile: the scope kind the BOM line uses
-- (null = the default 'Deck edge Angle / Bent plate') and the last profile used on the project.
ALTER TABLE members
  ADD COLUMN parent_member_id      UUID REFERENCES members(id) ON DELETE CASCADE,
  ADD COLUMN angle_length_mm       NUMERIC CHECK (angle_length_mm IS NULL OR angle_length_mm > 0),
  ADD COLUMN angle_start_offset_mm NUMERIC CHECK (angle_start_offset_mm IS NULL OR angle_start_offset_mm >= 0),
  ADD COLUMN slab_edge_side        TEXT CHECK (slab_edge_side IS NULL OR slab_edge_side IN ('left', 'right')),
  ADD COLUMN vertical_leg          TEXT CHECK (vertical_leg IS NULL OR vertical_leg IN ('long', 'short'));

CREATE INDEX members_parent_idx ON members (parent_member_id) WHERE parent_member_id IS NOT NULL;

ALTER TABLE projects
  ADD COLUMN perimeter_angle_kind    TEXT CHECK (perimeter_angle_kind IS NULL OR length(btrim(perimeter_angle_kind)) > 0),
  ADD COLUMN perimeter_angle_profile TEXT;
