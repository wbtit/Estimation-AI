-- 028_page_names_and_section_role.sql
-- Phase 14a (estimator feedback).
--   Page names read from the page's stored text (worker src/build/sheet_names.py, deterministic):
--     view_title (the main view title: printed under a view, underlined and / or with a scale under
--     it), view_titles (every one found: text, box, scale, underlined), title_block_name (the sheet
--     title in the bottom-right title block) and the rule that found it ('label' | 'largest'), the
--     rules version and when they were read. The page card shows the view title, else the
--     title-block name. NULL = not read yet or none found.
--   Detail and Section: the page type guess 'detail' covers DETAIL, SECTION and CONNECTION words;
--     a page whose matched words are only SECTION(S) now gets the role "Section". Existing views
--     move only when the system set the role (no person confirmed it), the role is "Detail", the
--     page type reason's first clause names only "section", and the project is not an evaluation
--     (measurement) project. Both roles stay "do not build" (behaviour 'none').

ALTER TABLE sheets
  ADD COLUMN view_title          TEXT,
  ADD COLUMN view_titles         JSONB,
  ADD COLUMN title_block_name    TEXT,
  ADD COLUMN title_block_rule    TEXT CHECK (title_block_rule IN ('label', 'largest')),
  ADD COLUMN names_rules_version TEXT,
  ADD COLUMN names_read_at       TIMESTAMPTZ;

UPDATE build_views v
SET role_name = 'Section', updated_at = now()
FROM sheets s, projects p
WHERE s.id = v.sheet_id
  AND p.id = s.project_id
  AND p.purpose <> 'evaluation'
  AND v.role_name = 'Detail'
  AND v.role_confirmed_by IS NULL
  AND s.page_type_guess = 'detail'
  AND btrim(regexp_replace(split_part(coalesce(s.page_type_reason, ''), ';', 1), '^.* match ', ''))
      = 'section';
