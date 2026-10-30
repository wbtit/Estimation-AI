-- 029_column_symbols.sql
-- Phase 14b (columns: follow the label, find similar, symbol families; worker
-- src/build/col_symbols.py, docs/PHASE14B_PREREGISTRATION.md and PHASE14B2).
--   members: the column symbol family (one of 14, or NULL), how the column was found
--     (label = a callout's leader ends at it; similar = same family and real size as an example;
--     click = a user-drawn example; drawn = drawn with the palette; find_similar = accepted from
--     Find similar), the red cross-check reason (label family vs drawn family), and the symbol's
--     real size in inches [short, long].
--   page_symbols: the candidate symbols of each Build of a column-plan page (family, box, centre,
--     rotation, real size), so Find similar answers from the stored page without a new Build.
--   member_kinds: "Stud/Post" (column symbol, counted apart from Column), after "Posts/Pipe".
--   count_actions: 'find_similar' (an accepted Find similar: one undoable action).

ALTER TABLE members
  ADD COLUMN symbol         TEXT,
  ADD COLUMN symbol_source  TEXT CHECK (symbol_source IN
    ('label', 'similar', 'click', 'drawn', 'find_similar')),
  ADD COLUMN symbol_flag    TEXT,
  ADD COLUMN symbol_real_in JSONB;

CREATE TABLE page_symbols (
  build_run_id UUID PRIMARY KEY REFERENCES build_runs(id) ON DELETE CASCADE,
  sheet_id     UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  view_id      UUID,
  ratio        NUMERIC NOT NULL,
  rules        TEXT NOT NULL,
  symbols      JSONB NOT NULL,   -- [{family, box: [x0, y0, x1, y1], centre: [x, y], rotation_deg, real_in: [short, long]}]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX page_symbols_sheet_idx ON page_symbols (sheet_id, created_at);

UPDATE member_kinds SET sort = sort + 1000 WHERE sort >= 11;
UPDATE member_kinds SET sort = sort - 999 WHERE sort >= 1000;
INSERT INTO member_kinds (kind, scope, symbol_group, sort, provisional_prefix)
  VALUES ('Stud/Post', 'main', 'column', 11, 'SP');

ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role', 'approve', 'project',
   'session', 'export', 'find_similar'));
