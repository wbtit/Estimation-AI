-- 012_kind_provisional_prefix.sql
-- Phase 6a step 3: the provisional tag prefix of a kind, until the owner's abbreviations are loaded.
-- Rule (V1_UI_SPEC section 1): the first letters of the kind name = the initials of its words, or
-- the first two letters when the name is one word. Computed here from the names so no prefix is
-- typed anywhere in code; the tag uses COALESCE(abbreviation, provisional_prefix).
ALTER TABLE member_kinds ADD COLUMN provisional_prefix TEXT;

UPDATE member_kinds k SET provisional_prefix = (
  SELECT CASE WHEN count(*) = 1 THEN upper(left(min(w), 2))
              ELSE upper(string_agg(left(w, 1), '' ORDER BY ord)) END
  FROM regexp_split_to_table(k.kind, '[^A-Za-z]+') WITH ORDINALITY AS t(w, ord)
  WHERE w <> ''
);

ALTER TABLE member_kinds
  ALTER COLUMN provisional_prefix SET NOT NULL,
  ADD CONSTRAINT member_kinds_provisional_prefix_uq UNIQUE (provisional_prefix);
