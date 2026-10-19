-- 022_approve_action.sql
-- Phase 11c (approve members): a person's confirmation of a built member is a member edit row
-- (field 'approved', true or false), so undo and the rebuild's "touched" rule apply to it as to
-- any edit. Its log row is the new count_actions action 'approve'. Additive: no row changes.
ALTER TABLE count_actions DROP CONSTRAINT count_actions_action_check;
ALTER TABLE count_actions ADD CONSTRAINT count_actions_action_check CHECK (action IN
  ('create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'measure', 'attach_length',
   'mode', 'typical', 'prefix_map',
   'setup', 'pick_pen', 'rebuild', 'add', 'ignore', 'save', 'view', 'role', 'approve'));
