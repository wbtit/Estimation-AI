-- 014_pilot_tags_sheet_numbers.sql
-- Phase 9 Part D. Additive only: existing rows and behaviour are unchanged.

-- Tag numbering scope of the counting copilot, stored per project. 'job' (default): one running
-- number per kind across all sheets of the job, in click order; 'sheet': restarts on every sheet.
ALTER TABLE projects
  ADD COLUMN tag_scope TEXT NOT NULL DEFAULT 'job' CHECK (tag_scope IN ('job', 'sheet'));

-- Sheet number: sheet_number / sheet_number_source stay the value that is shown. When the title-block
-- reading replaces the earlier one, the earlier value is kept as the fallback with a flag:
--   title_block      the shown number is the title-block (lower-right corner) reading; sheet_number_old
--                    holds the earlier reading when it differed
--   fallback_old     no title-block number was found; the earlier reading is kept and shown
--   NULL             not re-read (sheets scanned before Phase 9) or no number at all
ALTER TABLE sheets
  ADD COLUMN sheet_number_old        TEXT,
  ADD COLUMN sheet_number_old_source TEXT,
  ADD COLUMN sheet_number_flag       TEXT CHECK (sheet_number_flag IN ('title_block', 'fallback_old'));
