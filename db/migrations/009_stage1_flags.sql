-- 009_stage1_flags.sql
-- Phase 6a step 2 (flags instead of gates). Additive only.
-- A person's click "these guesses are right" on a sheet: who and when. The flags themselves are
-- derived (no person decision, scale not confirmed, line classes not confirmed), so nothing else is
-- stored; confirming sets the same confirmations a person could make one by one.
ALTER TABLE sheets
  ADD COLUMN guesses_confirmed_by TEXT,
  ADD COLUMN guesses_confirmed_at TIMESTAMPTZ;

-- Views the pipeline created on its own (a whole-sheet view), so the screen can say so.
ALTER TABLE sheet_views
  ADD COLUMN auto_created BOOLEAN NOT NULL DEFAULT FALSE;
