-- 025_project_purpose.sql
-- Projects screen cleanup: what a project is for, and when it was last opened.
--   purpose: 'real' (default; every new upload), 'demo' (walkthrough copies), 'evaluation'
--            (measurement copies made by evaluation tools). The projects screen shows real and
--            demo by default; evaluation only when its filter is on.
--   last_opened_at: set when a person opens the project (the cards sort by it, newest first).
-- Existing projects are classified by their internal name prefix: measurement copies are
-- evaluation, demo copies and the review project of the manager's session are demo; every other
-- project stays real.
ALTER TABLE projects
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'real'
    CHECK (purpose IN ('real', 'demo', 'evaluation')),
  ADD COLUMN last_opened_at TIMESTAMPTZ;

UPDATE projects SET purpose = 'evaluation'
WHERE name ~ '^(p1[0-9][a-z]?-|phase[0-9]+[a-z]?-|measure-|dryrun-|synthetic-)'
   OR name ~ '\((calibration|review test)';

UPDATE projects SET purpose = 'demo'
WHERE name ~ '^demo[0-9]*-' OR name = 'phase12-job-018';
