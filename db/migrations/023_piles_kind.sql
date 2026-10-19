-- 023_piles_kind.sql
-- Phase 12b (docs/PHASE12B_PLAN.md rule 3): piles are a kind of their own. A pile plan (a column-plan
-- page whose title or plan view title names piles) stores its glyphs as kind 'Piles' (symbol group
-- column, so type column), and auto mode gives such a page the built-in role 'Pile plan'
-- (behaviour column_plan; a person can switch it). Additive: no existing row changes.
INSERT INTO member_kinds (kind, scope, symbol_group, sort, provisional_prefix)
VALUES ('Piles', 'main', 'column', 37, 'PI');

INSERT INTO role_names (name, behaviour, built_in, position)
VALUES ('Pile plan', 'column_plan', true, 11);
