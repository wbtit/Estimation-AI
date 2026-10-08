# Phase 4d plan: text-layer reader and parsers

Status: implemented. Coverage results: `docs/PHASE4D_COVERAGE.md`.

Scope: positioned text items from the PDF text layer, deterministic parsers, a scan upgrade that uses text with provenance, tests on synthetic PDFs, and a private coverage run (counts only). **Not in scope:** label-to-member association, any change to the member contract, its schema or its migrations, any LLM or OCR.

## Owner decisions applied
1. **Canonical profile form:** uppercase, no spaces, `X` separator, fractions as written (`1/4`), decimals as decimal (`0.25`), mixed numbers with a hyphen (`3-1/2`). The raw string is always kept beside the canonical one. Catalog matching normalizes both sides identically (case, spaces, separator variants). A fraction and a decimal match **only** by exact numeric equality (1/4 = 0.25 = .250) and such matches are recorded as `matched_by_numeric_equivalence`. No other fuzzy matching. Without a loaded catalog, or without a match: `unvalidated`.
2. **Pipe, plate, rod:** canonical forms `PIPE4STD`, `PL1/2X8`, `ROD3/4`. Always `unvalidated` unless an exact (normalized) catalog row matches. No weights or sizes are ever invented.
3. **Migration 004:** additive and nullable only; no change to existing columns, the member contract or its migrations (listed below).
4. **Elevations:** relative notes (`+4'-0"`, `-2'-6"`) are parsed to mm as offsets with `is_relative = true`; `datum_unknown` is always true; they are not combined with any other value and not assigned to members.

**Catalog note.** The owner's AISC file has not been supplied yet. When it arrives, the column holding the nomenclature (the shape name) must be confirmed; the catalog importer already takes the column names as arguments, and the profile matcher only needs the shape names as imported.

## Migration 004 (`db/migrations/004_text_layer.sql`), exact columns
`text_items` (existing columns unchanged):

| Column | Type | Null | Meaning |
|---|---|---|---|
| `angle_deg` | `NUMERIC` | yes | text baseline angle on the displayed page, degrees counter-clockwise, 0 = left to right; NULL for glyph-read items |
| `level` | `TEXT` `CHECK (level IN ('word','line'))` | yes | granularity of a `pdf_text` item; NULL for glyph-read items |
| `parsed` | `JSONB` | yes | output of the deterministic parsers for this item (kind, raw, canonical, values, flags); NULL when nothing parsed |

`sheets` (existing columns unchanged):

| Column | Type | Null | Meaning |
|---|---|---|---|
| `text_source` | `TEXT` `CHECK (text_source IN ('pdf_text','glyph','none'))` | yes | which reader produced this page's text items; never mixed on one page |
| `text_quality` | `NUMERIC` `CHECK (text_quality BETWEEN 0 AND 1)` | yes | share of text-layer characters that are printable, assigned and not private-use or U+FFFD |
| `scan_evidence` | `JSONB` | yes | provenance and confidence of the scanned values (sheet number, title, scales, classification) and any conflicts |

For `pdf_text` items: `methods = ['pdf_text']`, `font_id = 'pdf_text'`, `confidence` = the item's text quality, `unknown_count` = number of unprintable characters. Word and line items of one sheet get different `item_key`s (the level is part of the hash input for `pdf_text` items; glyph-read keys are unchanged). Rotated text sets `angle_deg`; `orientation` is `vertical` within 5 degrees of 90 or 270 and `horizontal` otherwise.

## Per-page reader choice (no silent mixing)
A page uses `pdf_text` when it has a real text layer (at least 20 non-space characters, as in the scan) and `text_quality >= 0.90` (a tunable default, not a measured value). Otherwise it uses the existing glyph reader (confirmed labels only; unknown shapes stay `?`). The choice is stored in `sheets.text_source` with the quality, and a page that has text but fails the quality check records the review reason `text_layer_garbled`.

## Parsers (pure functions, `worker/src/text_layer/parsers/`)
`profile` (W M S HP C MC L WT MT ST HSS PIPE PL ROD), `dimension` (feet-inch to mm, exact fractions), `elevation`, `marks` (candidates only, never claimed as members), `sheet` (number forms like S4.1 and title strips, reusing the Phase 2 rules), and the existing `pdf_scan.scale` for scales.

## Scan upgrade
The page scan reads sheet number, title and scales from the text layer as before, and now also writes `scan_evidence`: per value the source rule, confidence, bbox of the matched text and method `pdf_text`; classification evidence; conflicts (for example a label-anchored sheet number that differs from the title-block candidate) become `needs_review` with a reason. A garbled text layer is not used. User overrides (scale override and the edit history) are never touched.

## Coverage run (private, counts only)
Over the six survey documents: share of profile-like tokens that parse, unparsed tokens by pattern class (no strings), share of pages with a sheet number found, share with a scale found, share of dimension-like tokens that parse. **This measures coverage, not correctness**: there is no ground truth for these documents.
