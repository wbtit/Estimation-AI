# Phase 8 pre-registration: quantity-level evaluation (Part A)

Written and committed BEFORE any quantity of ours was compared with the estimator's. Part A is read-only. Deterministic code only: no LLM, no trained model. Nothing is pushed. Process rules: PIDs recorded, only those stopped, no `pkill` or `pgrep -f`, the API on port 3000 is not touched (a read-only API on port 3100 is started and stopped by its recorded PID, as in earlier phases), no filesystem search (the estimator rows are the ones already extracted into `fixtures/private/target/rows.json`), no client, project or file names in code, docs, logs or chat, private data only under `fixtures/private`. Only the ten registered columns of the main-steel sheet were ever read from the workbook (Phase 5u); no cost, price or rate cell is read. The weights used are the AISC catalog's, not the workbook's.

Context (owner decision after Phase 7): matching against the estimators' rings is no longer the headline metric; the product is a counting copilot. This phase asks how close the QUANTITIES are, per size.

## 0. Facts found before writing this (so the design is honest about what is possible)
- **Only one job has quantity-level ground truth.** The estimator's finished takeoff is one workbook, the one tied to job-018 in Phase 5u (the `estimator_csv` folder is empty). So "per job" is one job, and "without the two largest jobs" (by marked symbols: job-012 and job-015) removes nothing: both are reported as the same figure, stated as such. Every result is one project; wide uncertainty, no generalisation.
- **Our extracted sheet numbers do not match the workbook's.** For this project all 23 of our sheet numbers have the form letter plus one digit (a title-block extraction that picked something else), while the workbook references have the form `S#-##`. The Phase 5u post-hoc finding stands: the references appear as text on the drawings. Mapping rule below.
- **Workbook structure:** 128 rows read, of which 104 have a numeric quantity; the rest are section labels. Rows carry a reference of the form detail/sheet, several per row in 50 of 104 rows. Quantities are per row (a row can span several sheets).
- **Our kinds are mostly blank for this project** (322 of 357 members have no kind: a kind is set only by the label's own line or the legend). So the kind-keyed tables will show many "kind differs" groups; the size-keyed tables do not depend on kind and are the primary ones.
- **Disclosure:** while looking at the row structure I printed the workbook's section and name strings once into a tool log. None is recorded in any file; no such string appears here or later. The mapping rule below was designed after looking at match COUNTS of the reference strings against the page text (16 of 19 distinct sheet references fall in the title-block corner of exactly one page); no quantity of ours was looked at.

## 1. Ground truth rows (theirs)
Source: `fixtures/private/target/rows.json` (columns: reference, quantity, shape, size, name, grade).
- **Data row:** numeric quantity.
- **Profile row:** the shape code is one of the catalog families (HSS, WF read as W, C, L, HP, M, S, MC, T, WT, PL) and the size matches a dimension pattern; the canonical size is the family plus the size with `X` separators (`HSS` + `12X12X3/8` gives `HSS12X12X3/8`; `WF` + `12X26` gives `W12X26`; `PL` rows are kept without a catalog shape). Rows without a shape (stairs, rails, section labels) are not profile rows and are dropped as non-steel-member rows (counted, reported).
- **Kind** of a row: the Phase 5u registered keyword table (`kind_study.TABLE`, first match on the Name, case-insensitive). A row whose kind falls in the misc or excluded group (stair, guardrail, joist, wall ...) is dropped as "not main steel". A row whose kind is `unmapped` or ambiguous stays with the kind `unmapped`.
- **Main-steel theirs** = profile rows not dropped by kind.

## 2. Mapping the references to our sheets
A reference token is the text after the last `/` of each comma-separated part of the Reference Dwg No. cell (whitespace and line breaks removed), normalised to letters and digits only. It maps to one of our pages when it equals, in the same normalisation, a whole text line of the page (database `text_items`, level `line`) whose centre lies in the lower-right corner (x above 70% of the page width and y above 70% of the page height) of EXACTLY ONE page of the project. A token with no such page, or more than one, is **unmapped** and is reported, never guessed. A row is **fully mapped** when all its tokens are mapped; its sheet set is the set of those pages.

## 3. Ours
The Phase 6b project of job-018 (every vector sheet is in), read through a read-only API on port 3100 running the current code: the members with their effective values.
- **Live and counted:** not deleted, not merged, not marked not-a-member, not existing steel, linked (status colour not `unlinked`), type not joist, kind scope main or no kind.
- **Display basis (the current one):** one piece per linked line = `pieceQuantity` (a label on a line that already has its piece adds 0).
- **Old label basis:** the quantity of every live counted member.
- **Size:** the member's canonical profile; members without a profile are not counted by size (reported).
- **Scopes:** S1 (primary) = the sheets that are mapped from theirs references; S2 = all sheets of the project.

## 4. Groupings and metrics
Keys: **G1** (size) per job [primary]; **G2** (kind, size) per job; **G3** (sheet, size) and **G4** (sheet, kind, size) for the rows that are fully mapped AND have exactly one distinct mapped sheet (theirs side); ours is summed over the same sheet. Quantity of a key = sum of quantities. Our kind for G2 and G4 is the member's kind, blank written `unmapped`.
For each grouping, over the union of keys (a key present on one side only has quantity 0 on the other):
- the number of keys, the share of **theirs keys** (their quantity above 0) for which ours is **exact**, **within plus or minus 1**, and **within 20%** of theirs (their quantity at least 1); and the same shares over the union of keys;
- the **quantity error rate** = sum of |ours minus theirs| over keys / sum of theirs;
- **sizes theirs has that we never found** (distinct sizes, and their share of their quantity) and **sizes we found that theirs does not have** (distinct sizes, and the share of our quantity);
- **weight:** W = sum over sizes of quantity times the catalog unit weight (lb/ft) of the default catalog edition (counts times unit weight only; length is not part of this); sizes with no catalog weight are excluded from both sums and reported. Signed relative error (ours minus theirs) / theirs, and absolute.
Reported for the display basis, the old label basis and the baselines, for S1 and S2. "With and without the two largest jobs" and "per job": the same figure (one job), stated in the tables.

## 5. Control (what the linking adds)
- **B1, naive label count:** every live member with a profile on the scope's sheets counts 1 (linked or not), regardless of the link or review state; kind and size as for ours.
- **B2, distinct sizes:** each distinct size on a sheet counts 1.
The linking "adds something" at the size level if the display basis beats B1 by at least 10 percentage points in the share of theirs keys within 20% on G1, or has the smaller absolute weight error by at least 5 percentage points. Otherwise it is not distinguishable from counting labels.

## 6. Reading guide (fixed now)
On G1 (S1) for the display basis: **usable as a first draft** if at least 70% of theirs keys are within 20% AND the absolute weight error is at most 10%; **partial** if at least 40% and at most 25%; otherwise **not usable**. No threshold is changed after the run.

## 7. Limits fixed in advance
One job; the kind mapping of theirs is the Phase 5u keyword table (not blind); the workbook may hold scope decisions (typical counts, quantities per repeated detail) that are not on the drawings; a row's quantity cannot be split between its sheets, so sheet-level groups use single-sheet rows only and are biased; our kinds are mostly blank; weights are unit weights times counts, not lengths.

## 8. Parts B and C (features, not evaluations)
Count mode (human-click pieces, snapping, size autofill, suggestions, undo and action log) and the two-click measure tool are built with unit and route tests; no performance claim is made for them in this phase. The action log is designed so that time per page can be measured later; that measurement will be pre-registered when it is done.
