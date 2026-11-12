-- Review 4: the page beam style of a view. Beams are drawn as one heavy single line (today) or as two
-- thin parallel flange-edge lines with a dashed centreline between (double line). The style is
-- learned at the pen pick (worker job learn_style) and a person can override it:
--   single = every line of the pen is a beam (the old behaviour, also NULL)
--   double = the thin pens are paired; a thin line in no pair is not a beam
--   both   = pairs first; thin lines left over stay single-line beams
-- gap range in page points (the learned gap), centreline required, who/what set it, the evidence.
ALTER TABLE build_views
  ADD COLUMN beam_style text
    CONSTRAINT build_views_beam_style_check CHECK (beam_style IN ('single', 'double', 'both')),
  ADD COLUMN beam_gap_min_pt numeric CONSTRAINT build_views_beam_gap_min_check CHECK (beam_gap_min_pt > 0),
  ADD COLUMN beam_gap_max_pt numeric CONSTRAINT build_views_beam_gap_max_check CHECK (beam_gap_max_pt > 0),
  ADD COLUMN beam_centreline_required boolean NOT NULL DEFAULT true,
  ADD COLUMN beam_style_source text
    CONSTRAINT build_views_beam_style_source_check CHECK (beam_style_source IN ('learned', 'person')),
  ADD COLUMN beam_style_evidence jsonb,
  ADD COLUMN beam_style_by text,
  ADD COLUMN beam_style_at timestamptz;
