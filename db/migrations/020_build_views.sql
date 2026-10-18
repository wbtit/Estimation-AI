-- 020_build_views.sql
-- Phase 11c (docs/PHASE11C_PLAN.md): views per page, role names, several beam pens, exclude areas
-- and deselected lines. A page has one or more build views; each view holds the setup the build
-- reads (box, role, scale, T.O.S., beam pens, exclusions, deselections, column plan link). Every
-- page gets one first view with exactly its current setup values and sources; the sheets setup
-- columns stay as a read-only legacy copy. No sheets, members or snapshot row is changed:
-- members.build_view_id NULL means "the page's first view".
--
-- A value is a SYSTEM value while its *_confirmed_by is NULL and a person's value once set, as in
-- 016 and 017.

-- Role names: a name a person sees and the build behaviour the engine understands. Organisation-wide.
CREATE TABLE role_names (
  name        TEXT PRIMARY KEY CHECK (length(btrim(name)) > 0 AND length(name) <= 60),
  behaviour   TEXT NOT NULL CHECK (behaviour IN ('column_plan', 'framing', 'none')),
  built_in    BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 1000,   -- order in the dropdown (built-in names first)
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO role_names (name, behaviour, built_in, position) VALUES
  ('Column plan',     'column_plan', true, 1),
  ('Framing plan',    'framing',     true, 2),
  ('Roof framing',    'framing',     true, 3),
  ('Foundation plan', 'column_plan', true, 4),
  ('Detail',          'none',        true, 5),
  ('Section',         'none',        true, 6),
  ('Elevation',       'none',        true, 7),
  ('Notes',           'none',        true, 8),
  ('Schedule',        'none',        true, 9),
  ('Other',           'none',        true, 10);

-- Views of a page.
CREATE TABLE build_views (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id                 UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  position                 INTEGER NOT NULL CHECK (position > 0),   -- 1 = the first view
  name                     TEXT NOT NULL,
  box                      JSONB,          -- {x0, y0, x1, y1} displayed page points (the crop)
  box_confirmed_by         TEXT,
  box_confirmed_at         TIMESTAMPTZ,
  role_name                TEXT REFERENCES role_names(name) ON UPDATE CASCADE,
  role_confirmed_by        TEXT,
  role_confirmed_at        TIMESTAMPTZ,
  scale_ratio              NUMERIC CHECK (scale_ratio > 0),          -- real / drawn
  scale_text               TEXT,
  scale_confirmed_by       TEXT,
  scale_confirmed_at       TIMESTAMPTZ,
  tos_mm                   NUMERIC,
  tos_raw                  TEXT,
  tos_source               TEXT CHECK (tos_source IN ('read', 'typed')),
  tos_confirmed_by         TEXT,
  tos_confirmed_at         TIMESTAMPTZ,
  no_beams_by              TEXT,           -- "No beams": a person set the beam pen to none
  no_beams_at              TIMESTAMPTZ,
  column_plan_view_id      UUID REFERENCES build_views(id) ON DELETE SET NULL,
  column_plan_confirmed_by TEXT,           -- set with a NULL view id = "no column plan" chosen
  column_plan_confirmed_at TIMESTAMPTZ,
  setup_changed_at         TIMESTAMPTZ,    -- "Requesting Build" if after the view's last build
  built_at                 TIMESTAMPTZ,
  registration             JSONB,          -- page -> project plan transform of the last build
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, position)
);
CREATE INDEX build_views_sheet_idx ON build_views (sheet_id);
CREATE TRIGGER build_views_set_updated_at
  BEFORE UPDATE ON build_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Beam pens of a view: position 1 is the first pen ("Replace pen"), 2+ added pens ("Add pen").
CREATE TABLE view_pens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id      UUID NOT NULL REFERENCES build_views(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL CHECK (position > 0),
  pen_class    TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('suggested', 'person')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (view_id, position),
  UNIQUE (view_id, pen_class)
);

-- Exclude areas: everything inside an accepted box is ignored by the build of the view.
CREATE TABLE view_exclusions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id     UUID NOT NULL REFERENCES build_views(id) ON DELETE CASCADE,
  box         JSONB NOT NULL,                 -- {x0, y0, x1, y1} displayed page points
  status      TEXT NOT NULL CHECK (status IN ('suggested', 'accepted')),
  rule        TEXT CHECK (rule IN ('frame', 'title_block', 'table')),   -- suggestions only
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ
);
CREATE INDEX view_exclusions_view_idx ON view_exclusions (view_id);

-- Deselected lines of the pen preview: stored by position (the sheet_lines row), matched by the
-- build by geometry (direction within 1 deg, axis distance <= 1.0 pt, >= 50% overlap).
CREATE TABLE view_deselections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id       UUID NOT NULL REFERENCES build_views(id) ON DELETE CASCADE,
  x0 NUMERIC NOT NULL, y0 NUMERIC NOT NULL, x1 NUMERIC NOT NULL, y1 NUMERIC NOT NULL,
  line_index    INTEGER,
  lines_version TEXT,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (view_id, x0, y0, x1, y1)
);

ALTER TABLE members ADD COLUMN build_view_id UUID REFERENCES build_views(id) ON DELETE SET NULL;
ALTER TABLE build_runs ADD COLUMN view_id UUID REFERENCES build_views(id) ON DELETE SET NULL;

-- Every new page gets its first view (empty: auto mode or a person fills it).
CREATE FUNCTION sheets_first_view() RETURNS trigger AS $$
BEGIN
  INSERT INTO build_views (sheet_id, position, name) VALUES (NEW.id, 1, 'View 1');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sheets_first_view AFTER INSERT ON sheets FOR EACH ROW EXECUTE FUNCTION sheets_first_view();

-- Backfill: one first view per existing page with its current values and sources.
INSERT INTO build_views (
  sheet_id, position, name, box, box_confirmed_by, box_confirmed_at,
  role_name, role_confirmed_by, role_confirmed_at,
  scale_ratio, scale_text, scale_confirmed_by, scale_confirmed_at,
  tos_mm, tos_raw, tos_source, tos_confirmed_by, tos_confirmed_at,
  no_beams_by, no_beams_at, column_plan_confirmed_by, column_plan_confirmed_at,
  setup_changed_at, built_at, registration, created_by)
SELECT s.id, 1, 'View 1', s.crop_region, s.crop_confirmed_by, s.crop_confirmed_at,
  CASE
    WHEN s.build_role = 'column_plan' AND s.page_type_guess = 'foundation_plan' THEN 'Foundation plan'
    WHEN s.build_role = 'column_plan' THEN 'Column plan'
    WHEN s.build_role = 'framing' THEN 'Framing plan'
    WHEN s.build_role IS NULL AND s.role_confirmed_by IS NULL AND s.crop_region IS NULL THEN NULL
    WHEN s.page_type_guess = 'detail' THEN 'Detail'
    WHEN s.page_type_guess = 'elevation' THEN 'Elevation'
    WHEN s.page_type_guess = 'general_notes' THEN 'Notes'
    WHEN s.page_type_guess = 'schedule_legend' THEN 'Schedule'
    ELSE 'Other'
  END,
  s.role_confirmed_by, s.role_confirmed_at,
  s.build_scale_ratio, s.build_scale_text, s.scale_confirmed_by, s.scale_confirmed_at,
  s.tos_mm, s.tos_raw, s.tos_source, s.tos_confirmed_by, s.tos_confirmed_at,
  CASE WHEN s.pen_class IS NULL AND s.pen_class_source = 'person' THEN s.pen_class_confirmed_by END,
  CASE WHEN s.pen_class IS NULL AND s.pen_class_source = 'person' THEN s.pen_class_confirmed_at END,
  s.column_plan_confirmed_by, s.column_plan_confirmed_at,
  s.setup_changed_at, s.built_at, s.registration, 'migration 020'
FROM sheets s;

INSERT INTO view_pens (view_id, position, pen_class, source, confirmed_by, confirmed_at)
SELECT v.id, 1, s.pen_class, COALESCE(s.pen_class_source, 'suggested'),
       s.pen_class_confirmed_by, s.pen_class_confirmed_at
FROM sheets s JOIN build_views v ON v.sheet_id = s.id AND v.position = 1
WHERE s.pen_class IS NOT NULL;

UPDATE build_views v SET column_plan_view_id = p.id
FROM sheets s, build_views p
WHERE s.id = v.sheet_id AND v.position = 1
  AND p.sheet_id = s.column_plan_sheet_id AND p.position = 1;

-- The action log: 'role' (a role name added or edited; no page). View, pen, exclusion and
-- deselection changes are 'setup' / 'pick_pen' rows with the view id in detail.
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role'));
