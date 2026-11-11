-- Phase 0 perimeter angle / bent plate: the project's material grade for these manual items.
-- null = the confirmed default A36 (set in code, review/perimeter-angle.ts). Free text: the list of
-- grades stays open (another grade will come later). Additive only.
ALTER TABLE projects
  ADD COLUMN perimeter_angle_grade TEXT CHECK (perimeter_angle_grade IS NULL OR length(btrim(perimeter_angle_grade)) > 0);
