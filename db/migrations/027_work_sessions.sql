-- 027_work_sessions.sql
-- Session preparation (the first estimator session: timed comparison and first training data).
--   work_sessions: who works on a project now (actor 'owner' or 'estimator'), from Start to End in
--     the workspace header; at most one open session per project.
--   actor + session_id on every row that records a person's action (and on build runs, page
--     activity and snapshots). A BEFORE INSERT trigger fills them from the project's open session,
--     so no route can forget: a system row (who 'system', a member the system made, a snapshot)
--     gets actor 'system'; with no open session a person's row gets actor 'owner'. Rows written
--     before this migration keep NULL (not tagged).
--   page_events: the workspace's activity pings ('active' at most every 30 s while there is input
--     on the page, 'leave' when the page is left or hidden); the page open is the existing
--     count_actions 'view' row. Used for active time per page (idle gaps over 2 min not counted).
--   build_snapshots: one frozen row per person Build too (auto_build_id NULL, mode 'person'),
--     written by the build job in the same transaction that finishes the run, so it is the system
--     result before any edit of that build; before_user_edit says whether the page had no member
--     edit and no drawn piece at that moment.
--   count_actions: actions 'session' (start / end) and 'export' (BOM, Excel).
-- Additive only: no existing row changes.

CREATE TABLE work_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL CHECK (actor IN ('owner', 'estimator')),
  started_by  TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  ended_by    TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX work_sessions_open_idx ON work_sessions (project_id) WHERE ended_at IS NULL;
CREATE INDEX work_sessions_project_idx ON work_sessions (project_id, started_at);

CREATE TABLE page_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id    UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('active', 'leave')),
  who         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE count_actions     ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE member_edits      ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE sheet_edits       ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE build_runs        ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE view_deselections ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE view_exclusions   ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE measurements      ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE view_undo         ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE members           ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE page_events       ADD COLUMN actor TEXT, ADD COLUMN session_id UUID;
ALTER TABLE build_snapshots   ADD COLUMN actor TEXT, ADD COLUMN session_id UUID,
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'person')),
  ADD COLUMN view_id UUID,
  ADD COLUMN before_user_edit BOOLEAN;
ALTER TABLE build_snapshots ALTER COLUMN auto_build_id DROP NOT NULL;
ALTER TABLE build_snapshots ADD CONSTRAINT build_snapshots_kind_check CHECK (
  (mode = 'auto' AND auto_build_id IS NOT NULL)
  OR (mode = 'person' AND auto_build_id IS NULL AND build_run_id IS NOT NULL));
CREATE UNIQUE INDEX build_snapshots_person_run_idx ON build_snapshots (build_run_id)
  WHERE mode = 'person';
CREATE INDEX count_actions_session_idx ON count_actions (session_id, created_at)
  WHERE session_id IS NOT NULL;
CREATE INDEX page_events_session_idx ON page_events (session_id, created_at);

-- TG_ARGV[0]: the row's "who" column, 'origin' (members: only 'manual' is a person's) or 'system';
-- TG_ARGV[1]: how to find the project: 'project', 'member', 'sheet' or 'view'.
CREATE FUNCTION tag_actor_session() RETURNS trigger AS $$
DECLARE
  r      JSONB := to_jsonb(NEW);
  pid    UUID;
  who    TEXT;
  sid    UUID;
  sactor TEXT;
  system BOOLEAN;
BEGIN
  pid := CASE TG_ARGV[1]
    WHEN 'project' THEN (r->>'project_id')::uuid
    WHEN 'member' THEN (SELECT m.project_id FROM members m WHERE m.id = (r->>'member_id')::uuid)
    WHEN 'sheet' THEN (SELECT s.project_id FROM sheets s WHERE s.id = (r->>'sheet_id')::uuid)
    WHEN 'view' THEN (SELECT s.project_id FROM build_views v JOIN sheets s ON s.id = v.sheet_id
                      WHERE v.id = (r->>'view_id')::uuid)
  END;
  SELECT w.id, w.actor INTO sid, sactor FROM work_sessions w
   WHERE w.project_id = pid AND w.ended_at IS NULL;
  IF TG_ARGV[0] = 'system' THEN
    system := true;
  ELSIF TG_ARGV[0] = 'origin' THEN
    system := coalesce(r->>'origin', '') <> 'manual';
  ELSE
    who := r->>TG_ARGV[0];
    system := who = 'system';
  END IF;
  IF NEW.session_id IS NULL THEN
    NEW.session_id := sid;
  END IF;
  IF NEW.actor IS NULL THEN
    NEW.actor := CASE WHEN system THEN 'system' ELSE coalesce(sactor, 'owner') END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER count_actions_tag BEFORE INSERT ON count_actions
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('who', 'project');
CREATE TRIGGER member_edits_tag BEFORE INSERT ON member_edits
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('reviewer', 'member');
CREATE TRIGGER sheet_edits_tag BEFORE INSERT ON sheet_edits
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('editor', 'sheet');
CREATE TRIGGER build_runs_tag BEFORE INSERT ON build_runs
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('requested_by', 'project');
CREATE TRIGGER view_deselections_tag BEFORE INSERT ON view_deselections
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('created_by', 'view');
CREATE TRIGGER view_exclusions_tag BEFORE INSERT ON view_exclusions
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('created_by', 'view');
CREATE TRIGGER measurements_tag BEFORE INSERT ON measurements
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('created_by', 'project');
CREATE TRIGGER view_undo_tag BEFORE INSERT ON view_undo
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('who', 'project');
CREATE TRIGGER members_tag BEFORE INSERT ON members
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('origin', 'project');
CREATE TRIGGER page_events_tag BEFORE INSERT ON page_events
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('who', 'project');
CREATE TRIGGER build_snapshots_tag BEFORE INSERT ON build_snapshots
  FOR EACH ROW EXECUTE FUNCTION tag_actor_session('system', 'project');

ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role', 'approve', 'project',
   'session', 'export'));
