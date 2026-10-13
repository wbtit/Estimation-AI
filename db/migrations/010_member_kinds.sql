-- 010_member_kinds.sql
-- Phase 6a step 3: member kinds (the estimators' scope list). Additive only: no existing column or
-- table changes, existing members keep a NULL kind ("no kind"). docs/SCHEMA_CHANGE_PROPOSAL.md
-- section 9, Stage 1 subset (no length, plan-frame, legend or dimension parts).
--
-- member_kinds is a reference table so the owner can fill `abbreviation` (the tag prefix) later
-- from a CSV without a migration (api: npm run kinds:load-abbreviations). It is empty today; the
-- tag prefix is then provisional (derived from the kind name) and flagged PREFIX_PROVISIONAL.

CREATE TABLE member_kinds (
  kind          TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('main', 'misc', 'excluded')),
  abbreviation  TEXT CHECK (abbreviation IS NULL OR abbreviation <> ''),
  symbol_group  TEXT NOT NULL CHECK (symbol_group IN ('linear', 'column', 'plate', 'other', 'none')),
  sort          INTEGER NOT NULL UNIQUE
);

INSERT INTO member_kinds (kind, scope, symbol_group, sort) VALUES
  ('Column',                          'main', 'column', 1),
  ('Beams',                           'main', 'linear', 2),
  ('Curved Beam/Rolled Beam',         'main', 'linear', 3),
  ('Truss',                           'main', 'other',  4),
  ('Horizontal Brace',                'main', 'linear', 5),
  ('Vertical Brace',                  'main', 'linear', 6),
  ('Kicker/Knee Brace',               'main', 'linear', 7),
  ('Girt & Purlin',                   'main', 'linear', 8),
  ('Lintel/Brick Veneer Supports',    'main', 'linear', 9),
  ('Posts/Pipe',                      'main', 'column', 10),
  ('Hangers',                         'main', 'other',  11),
  ('Deck edge Angle / Bent plate',    'main', 'plate',  12),
  ('Misc. Attachments',               'main', 'other',  13),
  ('Outriggers',                      'main', 'linear', 14),
  ('Sag rod',                         'main', 'linear', 15),
  ('Turn Buckle',                     'main', 'other',  16),
  ('Dock Levellers',                  'main', 'other',  17),
  ('RTU Frame/Roof Hatch Frame',      'main', 'other',  18),
  ('Roof Drain Frame',                'main', 'other',  19),
  ('Embed Plate/Bearing Plates',      'main', 'plate',  20),
  ('Embeds Angle',                    'main', 'other',  21),
  ('Stair',                           'misc', 'other',  22),
  ('Dock Stair',                      'misc', 'other',  23),
  ('Guardrail',                       'misc', 'other',  24),
  ('Handrail/Wallrails',              'misc', 'other',  25),
  ('Landing Frame',                   'misc', 'other',  26),
  ('Roof Ladder',                     'misc', 'other',  27),
  ('Ship Ladder/Cage Ladder',         'misc', 'other',  28),
  ('Pit Ladder',                      'misc', 'other',  29),
  ('Bollard',                         'misc', 'other',  30),
  ('Gates',                           'misc', 'other',  31),
  ('Grating',                         'misc', 'other',  32),
  ('Bike Rack',                       'misc', 'other',  33),
  ('Joist',                           'excluded', 'none', 34),
  ('Wall',                            'excluded', 'none', 35),
  ('Other trades',                    'excluded', 'none', 36);

ALTER TABLE members
  ADD COLUMN kind           TEXT REFERENCES member_kinds(kind),
  ADD COLUMN kind_source    TEXT CHECK (kind_source IN ('keyword', 'legend', 'sheet_context', 'person')),
  ADD COLUMN kind_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN kind_evidence  JSONB,      -- {status, source, keyword, in, candidates}: why the kind was chosen
  ADD COLUMN tag_prefix     TEXT,       -- copied from member_kinds.abbreviation, else derived (provisional)
  ADD COLUMN tag_number     INTEGER CHECK (tag_number IS NULL OR tag_number > 0);

CREATE INDEX members_kind_idx ON members (kind);
CREATE UNIQUE INDEX members_sheet_tag_uq ON members (sheet_id, tag_prefix, tag_number)
  WHERE tag_number IS NOT NULL AND tag_prefix IS NOT NULL;
