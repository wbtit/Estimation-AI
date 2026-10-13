-- 011_member_tag_null_prefix.sql
-- Phase 6a step 3: a member with no kind has no prefix; its tag number is still unique per sheet.
CREATE UNIQUE INDEX members_sheet_tag_noprefix_uq ON members (sheet_id, tag_number)
  WHERE tag_number IS NOT NULL AND tag_prefix IS NULL;
