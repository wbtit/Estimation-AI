-- Review 3, item 2: "Foundation plan" and "Column plan" are one thing to the estimators. The UI shows
-- ONE role, "Foundation / column plan". Its behaviour stays column_plan (the count rule, the build,
-- Find similar and the symbol storage read the behaviour, never the name), so a firm that keeps a
-- separate column plan can still be told apart later. "Pile plan" stays (its columns are stored as
-- kind Piles).
--   * every view with the role "Column plan" moves to "Foundation plan";
--   * "Foundation plan" is renamed "Foundation / column plan" (build_views.role_name follows:
--     ON UPDATE CASCADE) and goes first in the list;
--   * the "Column plan" role is deleted (no view uses it any more).
-- Nothing else is rewritten: no member, symbol, setup or edit row changes.
UPDATE build_views SET role_name = 'Foundation plan' WHERE role_name = 'Column plan';
UPDATE role_names
SET name = 'Foundation / column plan', position = 1
WHERE name = 'Foundation plan'
  AND NOT EXISTS (SELECT 1 FROM role_names WHERE name = 'Foundation / column plan');
DELETE FROM role_names WHERE name = 'Column plan';
