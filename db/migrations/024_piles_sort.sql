-- 024_piles_sort.sql
-- Phase 12b: 'Piles' (migration 023) sits at the end of the main kinds, before the misc and the
-- excluded ones, so lists that follow `sort` keep main kinds first. Only `sort` values change.
UPDATE member_kinds SET sort = sort + 1000 WHERE sort >= 22 AND kind <> 'Piles';
UPDATE member_kinds SET sort = 22 WHERE kind = 'Piles';
UPDATE member_kinds SET sort = sort - 1000 + 1 WHERE sort >= 1000;
