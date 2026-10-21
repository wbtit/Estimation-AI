-- 026_project_action.sql
-- Projects screen cleanup: a person's change to a project (rename, change purpose, archive or
-- unarchive, duplicate as demo) is logged as the count_actions action 'project' with who, when and
-- the ids in `detail` ({change, from, to, new_project_id}). Additive: no row changes.
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role', 'approve', 'project'));
