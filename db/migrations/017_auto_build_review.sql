-- 017_auto_build_review.sql
-- Phase 11b (docs/PHASE11B_PLAN.md): auto mode, the review UI, the system-vs-final report.
-- Additive: new columns and tables; one CHECK is widened (count_actions.action gets new actions).
--
-- A setup value is a SYSTEM value while its *_confirmed_by is NULL (crop, scale, T.O.S., pen class
-- as in 016; role and column plan below) and a person's value once it is set. Auto mode builds with
-- system values; "Save page" confirms what is still a system value in the person's name.

ALTER TABLE sheets
  ADD COLUMN role_confirmed_by        TEXT,
  ADD COLUMN role_confirmed_at        TIMESTAMPTZ,
  ADD COLUMN column_plan_sheet_id     UUID REFERENCES sheets(id) ON DELETE SET NULL,  -- framing pages
  ADD COLUMN column_plan_confirmed_by TEXT,   -- set with a NULL sheet id = "no column plan" chosen
  ADD COLUMN column_plan_confirmed_at TIMESTAMPTZ,
  ADD COLUMN setup_changed_at         TIMESTAMPTZ,  -- last setup change: "Requesting Build" if after the last build
  ADD COLUMN reviewed_by              TEXT,         -- "Save page"
  ADD COLUMN reviewed_at              TIMESTAMPTZ;

-- One auto run of a project: proposals for every page, builds, then the snapshots (SYSTEM VERSION).
CREATE TABLE auto_builds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed', 'refused')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  pages_total  INTEGER NOT NULL DEFAULT 0,
  pages_done   INTEGER NOT NULL DEFAULT 0,
  rules_version TEXT,
  counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT
);
CREATE INDEX auto_builds_project_idx ON auto_builds (project_id, started_at);

ALTER TABLE build_runs
  ADD COLUMN mode          TEXT NOT NULL DEFAULT 'person' CHECK (mode IN ('auto', 'person')),
  ADD COLUMN auto_build_id UUID REFERENCES auto_builds(id) ON DELETE SET NULL;

-- The SYSTEM VERSION: one row per page per auto run, written once. No foreign key but the project's,
-- so nothing can change a row through ON DELETE SET NULL; the trigger rejects every UPDATE and any
-- DELETE while the project still exists (deleting the project removes its snapshots).
CREATE TABLE build_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  auto_build_id UUID NOT NULL,
  sheet_id      UUID NOT NULL,
  build_run_id  UUID,               -- NULL when the page was not built (reasons in setup)
  setup         JSONB NOT NULL,     -- every setup value with its source, and the refusal reasons
  pieces        JSONB NOT NULL,     -- [{member_id, kind, tag, profile, ...}] as built
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auto_build_id, sheet_id)
);
CREATE INDEX build_snapshots_project_idx ON build_snapshots (project_id, created_at);

CREATE FUNCTION build_snapshots_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'build_snapshots rows are never changed';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id) THEN
    RAISE EXCEPTION 'build_snapshots rows are removed only with their project';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER build_snapshots_frozen
  BEFORE UPDATE OR DELETE ON build_snapshots FOR EACH ROW EXECUTE FUNCTION build_snapshots_frozen();

-- Pieces: Ignore (shown grey, out of the BOM), and who drew a piece by hand.
ALTER TABLE members
  ADD COLUMN ignored  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN added_by TEXT,
  ADD COLUMN added_at TIMESTAMPTZ;

-- One tag counter per project (Decision Log): the build, the review UI and the copilot all take
-- numbers here. scope_key is '' for job-wide tags and the sheet id for sheet-scoped tags; prefix ''
-- stands for "no prefix". A number is never reused.
CREATE TABLE tag_counters (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_key   TEXT NOT NULL DEFAULT '',
  prefix      TEXT NOT NULL DEFAULT '',
  last_number INTEGER NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (project_id, scope_key, prefix)
);

-- Project status as the estimator sees it (projects.status keeps the processing state).
ALTER TABLE projects
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'Estimating'
    CHECK (stage IN ('Estimating', 'Submitted', 'Won', 'Lost'));

-- The action log gets the review UI's actions (setup changes, pen picks, rebuilds, adds, ignores,
-- page saves, page views).
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length', 'mode',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view'));
