# Phase 4b plan: deterministic text reader, glyph library, optional OCR cross-check

Branch `phase-4b` (from `phase-4a`). Inputs: `docs/PHASE4A_FINDINGS.md` and the owner decisions (1) a local OCR engine is allowed only as an optional cross-check, never as source of truth, never networked; (2) glyph labels are seeded by OCR majority vote and then reviewed by the owner; (3) first targets: beam legend, member marks, callouts, scale text, sheet number/title, dimension strings.

Conflicts with SPEC or CLAUDE.md: SPEC section 4 says "No OCR in v0". The owner decision overrides it; SPEC section 4 and the Decision Log are updated (see "SPEC changes"). CLAUDE.md is unaffected (it forbids LLM calls, and none are used). No other conflict. Assumptions I had to make are in `docs/OPEN_QUESTIONS.md` (items 23 onward) with the default chosen.

## What is built (and what is not)
| | Item | Notes |
|---|---|---|
| A | `docs/SCHEMA_CHANGE_PROPOSAL.md` | Document only. Contract schemas and migrations for members are NOT touched. Waits for approval. |
| B | Text reader (worker, deterministic) | Stroke clusters per page in displayed (rotation-mapped) coordinates, glyph matching with the 4a tolerances, upright line assembly, decoding with a glyph library, `?` for unknown shapes, vertical text counted as "not read". |
| C | Glyph library | Migration `003`, table `glyph_library`, CLI to build contact sheets of unlabeled groups and to import the owner's CSV corrections. Only `confirmed` labels decode. |
| D | OCR cross-check | Separate optional dependency group, off by default, no network, licence and audit review in `docs/OCR_DEPENDENCY_REVIEW.md`. Proposes labels by majority vote; cross-checks decoded lines; never overwrites the glyph result. |
| E | `text_items` table and `GET .../sheets/:sheetId/text-items` | Same migration. Plus `POST .../read-text` to enqueue the `read_text` job (needed to run the reader at all). |
| F | Accuracy harness | Private, local. Compares decoded text with `fixtures/private/ground_truth_text.csv`; creates a stratified template of 60 lines (30 seeded random upright lines + 5 each of callout, scale, legend, dimension, mark, sheet chosen by page structure only; shortfalls topped up with random lines and reported; `category` column)  if the file does not exist (left blank for the owner). |

Out of scope: member extraction, legend/mark linking, dimension parsing, vertical-text reading, changing the contract (A is a proposal only), any pricing.

## B. Text reader: fixed definitions
Everything numeric below is fixed here, before any scoring on the owner's ground truth. None is tuned.

**Stroke clusters** (same as 4a). Dark (mean colour < 0.5) stroked paths up to 14 pt in their larger dimension; paths whose bounding boxes are within 0.2 pt of each other form one character cluster. All points are mapped through `page.rotation_matrix` first (PyMuPDF reports unrotated coordinates).

**Glyph matching** (same tolerances as 4a). A cluster is normalised for translation and scale (divide by its larger dimension) and resampled to 64 points evenly along its strokes. Two shapes are the same glyph if the symmetric mean Chamfer distance is at most **0.03** and the Hausdorff distance at most **0.10**, both as fractions of the glyph size. Candidates are pre-filtered by bounding-extent difference, which these tolerances imply, so the pre-filter changes no result. No rotation invariance: only upright text is read. A cluster matches the nearest library entry within tolerance; no match means unknown.

**Library use.** Only entries with status `confirmed` and a label decode. A cluster whose nearest entry is `proposed` or that matches nothing decodes to `?` and is counted (`unknown_count`). New groups for unmatched clusters are created as `proposed` entries with no label (leader grouping at the same tolerances); matches to any entry raise its `seen_count`.

**Upright lines** (same as 4a). Character-like clusters are those with a dimension of at least 3 pt; two are on the same line if their vertical centres differ by at most 0.35 x the larger height and the horizontal gap is between -0.6 pt and 1.0 x height. A line has at least 2 characters. Single stray characters are counted as `unassigned`, not emitted.

**Vertical text.** Lines found with the same rule on the other axis are emitted as `text_items` with no text, reason `vertical_text_not_read`, and counted. Not decoded in this phase.

**Fixed size rules for small marks and layout** (defined before scoring; the spacing rule is based on the measured distribution of 22,235 neighbouring-character gaps in 4a, 95% of which are below 0.38 of the character height, with a valley at 0.40 to 0.50):
- *Word space:* gap larger than **0.45 x R**, where R is the median height of the line's clusters taller than 3 pt.
- *Dot:* a cluster smaller than **1.5 pt** in both dimensions decodes to `.`. Two dots stacked within 1.0 pt in x and more than 1.5 pt apart in y decode to `:`.
- *Small marks* (1.5 to 3 pt, for example an apostrophe) are not special-cased: they go through the library like any other glyph.
- *Attached marks:* a small cluster belongs to a line if it is within 0.6 x R horizontally of the line's extent and its vertical centre lies within 0.3 x R of the line's vertical range.
- *Bars:* clusters whose confirmed label is `-` and that are wider than **1.2 x R** are underlines and are dropped from the text (a hyphen is about 0.7 x R). Two other `-` bars stacked, within 0.6 pt in both x edges and with vertical centres 0.15 to 0.6 x R apart, decode to `=`.
- *Case:* a letter decodes in lower case if its height is below **0.8 x C**, where C is the largest height among clusters labelled `A-Z` or `0-9` in that line (the slash and other tall marks are excluded). Library letter labels are therefore upper case; the case-only difference between shapes such as `X` and `x` is handled by this rule.

**Confidence** (rule-based constants, not calibrated probabilities): glyph only with no unknown shape 0.8; with unknown shapes 0.3; OCR agrees 0.95; OCR disagrees 0.5. `needs_review` with a reason for: `unknown_glyph`, `ocr_disagrees`, `vertical_text_not_read`.

## C. Glyph library
`glyph_library(id, font_id, signature_hash, strokes, label, status, source, proposed_label, votes, seen_count, created_at, reviewed_by, reviewed_at, updated_at)`, unique on (`font_id`, `signature_hash`); status `proposed|confirmed`; `confirmed` requires a label. `font_id` names a glyph set (a CAD font as drawn by one firm/exporter); default from config `GLYPH_FONT_ID` (see open question 23). CLI (`python -m src.text_reader.cli`, also `make glyph-*`): `contact-sheets` (PNG sheets of unlabeled groups, most frequent first, with the OCR-proposed label and vote purity, into `fixtures/private/`), `export-csv` (the review file), `import-csv` (applies the owner's edits; atomic: any bad row refuses the whole file; `--dry-run`).

## D. OCR cross-check
Optional dependency group `ocr` (`worker/pyproject.toml`), pinned and hashed in `worker/requirements-ocr.txt`, installed only by `make setup-ocr`; disabled unless `OCR_CROSSCHECK_ENABLED=true`. The engine sits behind a small interface so the logic is tested without the real model. Two uses: (i) majority-vote label proposals, only from lines where the OCR string length equals the number of plain glyph clusters, accumulating `votes` per library entry (letters counted case-insensitively); lines overlapping the ground-truth file are excluded from voting so the labeled set stays separate; (ii) per-line cross-check: agree (case and spaces ignored) raises confidence, disagree flags `needs_review`. The glyph text is never replaced.

## E. Output
`text_items(id, sheet_id, bbox x0 y0 x1 y1 in displayed page points, orientation, text, ocr_text, methods[], confidence, agree, needs_review, review_reasons[], char_count, unknown_count, font_id, created_at)`. The `read_text` job rebuilds a project's items in one transaction. `GET /api/projects/:projectId/sheets/:sheetId/text-items` lists them.

## F. Accuracy harness
`python -m src.text_reader.harness`: with `fixtures/private/ground_truth_text.csv` present it reports (overall and per `category`) exact-match rate, `?` rate (characters and lines) and OCR-agreement rate, matching truth rows to decoded lines by overlap (IoU at least 0.5; unmatched rows are counted as misses). Without the file it writes a template of 60 seeded random upright lines plus their crops for the owner to fill in. Thresholds are never chosen on this set.

## Target strings
The first targets drive reporting only (no parsing yet): the harness reports accuracy per category (marks `B1`, designations like `HSS6x4x1/4`, scale text, sheet numbers like `S4.1`, dimension strings like `12'-6"`). Library groups are listed most frequent first (`seen_count`); ranking groups by target-likeness would need decoded text, which does not exist before labels, so it is not done.

## SPEC changes
Section 4: replace "No OCR in v0" with the owner decision. Decision Log: OCR allowed only as optional local cross-check; glyph library design; fixed rules; licence review result.

## Tests (synthetic only)
A tiny monoline stroke font is generated inside the tests and drawn into synthetic PDFs (including a rotated page, vertical text, two character sizes). Covers geometry, extraction, matching, line assembly, small-mark rules, library lifecycle, CSV import, contact sheets, the job against the real Postgres, the API, OCR vote and cross-check with a fake engine, and (if the optional group is installed) a no-network run of the real engine. No real client PDF in tests.
