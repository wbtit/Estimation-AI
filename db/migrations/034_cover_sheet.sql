-- Review 3, item 1: the page role "Cover / Title page" (project details; no extraction yet: Phase 1)
-- and the page type guess `cover_sheet` that SUGGESTS it (never sets it: a person picks the role).
--   * sheets.page_type_guess accepts 'cover_sheet';
--   * role_names gets the built-in role "Cover / Title page" (behaviour none: not built);
--   * pages scanned before this change are re-guessed from what is stored: a title that names a
--     cover (COVER, TITLE SHEET, DRAWING / SHEET INDEX, INDEX OF DRAWINGS, DRAWING LIST), and the
--     FIRST page of a project when it was guessed notes or other and has no plan text in its title
--     or view title. Only the GUESS column changes; no role, view or person edit is touched.
ALTER TABLE sheets DROP CONSTRAINT sheets_page_type_guess_check;
ALTER TABLE sheets ADD CONSTRAINT sheets_page_type_guess_check CHECK (page_type_guess IN (
  'framing_plan', 'foundation_plan', 'cover_sheet', 'elevation', 'detail', 'schedule_legend',
  'general_notes', 'other'));

INSERT INTO role_names (name, behaviour, built_in, position)
VALUES ('Cover / Title page', 'none', true, 12)
ON CONFLICT (name) DO NOTHING;

UPDATE sheets
SET page_type_guess = 'cover_sheet',
    page_type_reason = 'title names a cover or an index (re-guessed by migration 034)'
WHERE page_type_guess IN ('general_notes', 'other')
  AND coalesce(title, '') ~* '\m(COVER|TITLE\s+SHEET|(DRAWING|SHEET)\s+INDEX|INDEX\s+OF\s+(DRAWINGS|SHEETS)|DRAWING\s+LIST)\M';

UPDATE sheets
SET page_type_guess = 'cover_sheet',
    page_type_reason = 'first page with no plan text (re-guessed by migration 034)'
WHERE page_index = 0
  AND page_type_guess IN ('general_notes', 'other')
  AND (coalesce(title, '') || ' ' || coalesce(view_title, '')) !~* '\m(PLANS?|FRAMING|FOUNDATIONS?|FOOTINGS?|PILES?)\M';
