-- 018_action_check_fix.sql
-- 017 widened count_actions.action but dropped 'typical' and 'prefix_map' (added by 015). This puts
-- back the full list: 015's actions plus 017's review UI actions. No row changes.
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view'));
