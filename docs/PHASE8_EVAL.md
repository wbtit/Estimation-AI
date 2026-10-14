# Phase 8 Part A: quantity-level evaluation against the estimator's finished takeoff

Pre-registration: `docs/PHASE8_PREREGISTRATION.md` (committed before any quantity was compared; nothing in it was changed after the run). Read-only, deterministic, nothing pushed. Counts and generic size codes only: no workbook text, project or file name is recorded here.

## 1. Short answer
- **The count is not usable as a first draft at the quantity level on this project.** On the primary grouping (size per job, scope S1) the display basis gets 21% of the estimator's sizes within 20% and is 49% low in unit-weighted count. The pre-registered reading is **not usable** (needs 70% and a weight error of 10% or less).
- **The linking does not add anything at this level; it takes away.** The naive count (every size label on the sheets counts 1, linked or not) is closer to the estimator on every primary measure: 32% of sizes within 20% (display basis: 21%), weight error 33% low (display: 49% low). By the registered rule the linking would have to beat the naive count by 10 points; it is 11 points worse. The cause is clear in the counts: 62 labels on the mapped sheets have no linked line and are left out of the display total, and 27 linked labels add 0 pieces because they share a line.
- **The biggest single gap is not a linking problem.** The estimator's largest size (62 pieces, in rows that read like typical repeated members, 26 to 30 per row) is found by us 0 times (2 times as a label); the next (110 pieces) is found 58 times (77 as labels, 110 only by the naive count). Rows with quantities of 10 to 30 pieces per row exist because the estimator counts repeated members that are drawn without a label each; labels and lines cannot give those.
- **The totals:** theirs 463 pieces over 96 main-steel rows; ours 233 (display), 260 (labels), 322 (naive), 42 (distinct sizes).
- **Kind-level tables are empty of information** (G2 and G4 about 0% within 20%) because our kind is blank for 322 of 357 members of this project; they say nothing about kind accuracy.
- **One job only.** "Per job" and "without the two largest jobs" are the same figure: the only quantity ground truth is the finished takeoff of job-018; the two largest jobs by marked symbols (job-012, job-015) have none. Nothing here generalises beyond one project.

## 2. Data and mapping
| item | result |
|---|---|
| workbook rows with a quantity | 104 |
| kept as main-steel profile rows | 96 (8 dropped: no shape or no dimension size, i.e. stairs, rails and similar) |
| dropped by the misc or excluded keyword groups | 0 |
| quantity of the 96 rows | 463 pieces |
| sheet references (distinct, normalised) | 16 |
| references mapped to exactly one of our pages | **16 of 16** (title-block corner rule); none unmapped, none ambiguous |
| rows fully mapped / with no reference at all | 76 / 20 (the 20 carry 64 pieces) |
| rows with exactly one mapped sheet (sheet-level groups) | 36 rows, 139 pieces |
| our pages mapped / in the project | 16 of 23 |
| our counted members (live, linked or not, main scope, with a profile) | 323; 34 left out (joists and not-counted kinds) |
| sizes: theirs / ours | 19 / 19; one of each has no catalog weight (a plate on their side; a channel spelled 13.7 on ours, 13.75 in the catalog) |

Our own extracted sheet numbers cannot be used for this project (all 23 have the form letter plus one digit); the mapping used the text on the pages as registered.

## 3. Primary grouping: G1, size per job, scope S1 (the 16 mapped sheets)
Their sizes: 19 keys (the shares below are over these).
| basis | ours total | exact | within plus or minus 1 | within 20% | quantity error rate | sizes they have that we never found | sizes we found that they do not have | weight (unit weight times count), ours against theirs |
|---|---|---|---|---|---|---|---|---|
| display (one piece per linked line) | 233 | 11% | 21% | **21%** | 0.55 | 5 (17% of their pieces) | 2 (2% of ours) | 8,510 against 16,851 (-49%) |
| old label basis | 260 | 5% | 16% | 26% | 0.52 | 4 (17%) | 2 (3%) | 9,348 (-45%) |
| B1 naive: every label counts 1 | 322 | 16% | 37% | **32%** | 0.42 | 2 (3%) | 2 (3%) | 11,214 (-33%) |
| B2 naive: each size once per sheet | 42 | 5% | 11% | 5% | 0.92 | 2 (3%) | 2 (5%) | 1,535 (-91%) |
Over the union of keys (21): display 10% / 24% / 19%, label 5% / 19% / 24%, B1 14% / 33% / 29%, B2 5% / 19% / 5% (exact / within 1 / within 20%). The weight columns leave the two sizes without a catalog weight out of both sums (theirs 16,851 and ours differ only by the counts). Scope S2 (all 23 pages) is the same to within one member (234 against 233 pieces); every figure above is unchanged at the precision shown, except weight and the totals by at most 1 point.

## 4. Other groupings (scope S1)
| grouping | keys (theirs) | display: exact / within 1 / within 20% | label | B1 | B2 |
|---|---|---|---|---|---|
| G2 kind and size per job | 28 | 0% / 4% / 0% | 0% / 4% / 0% | 0% / 4% / 0% | 0% / 4% / 0% |
| G3 sheet and size, single-sheet rows only | 18 | 17% / 50% / 33% | 44% / 56% / 44% | 56% / 67% / 56% | 11% / 33% / 11% |
| G4 sheet, kind and size | 18 | 0% / 11% / 0% | 0% / 11% / 0% | 0% / 11% / 0% | 0% / 11% / 0% |
G3 covers 139 of their 463 pieces (36 rows); on those sheets our display total is 150, the label total 177, B1 236. The quantity error rates of G3 are 0.87 (display), 0.85 (label), 0.93 (B1), 0.95 (B2): the totals are close, the per-size split is not. G2 and G4 show only that our kind is blank (`unmapped`) where theirs is a kind such as a column.

## 5. By size (generic codes; pieces)
| size | theirs | display | label basis | naive | of which unlinked labels |
|---|---|---|---|---|---|
| HSS8X4X1/2 | 110 | 58 | 77 | 110 | 33 |
| HSS12X12X3/8 | 62 | 0 | 0 | 2 | 2 |
| HSS4X4X1/4 | 55 | 28 | 28 | 34 | 6 |
| HSS8X6X1/4 | 45 | 8 | 9 | 11 | 2 |
| W12X65 | 28 | 13 | 13 | 13 | 0 |
| HSS6X6X1/4 | 27 | 14 | 14 | 14 | 0 |
| HSS12X8X1/4 | 23 | 20 | 21 | 28 | 7 |
| W21X55 | 19 | 27 | 27 | 27 | 0 |
| HSS6X6X1/2 | 18 | 18 | 19 | 19 | 0 |
| W16X26 | 15 | 15 | 17 | 17 | 0 |
| HSS16X8X1/2 | 14 | 12 | 12 | 13 | 1 |
| HSS12X12X1/2 | 13 | 7 | 7 | 7 | 0 |
| HSS6X6X5/16 | 10 | 6 | 6 | 6 | 0 |
| plate (3/4 x 12 x 1'-0") | 8 | 0 | 0 | 0 | 0 |
| W8X10 | 6 | 0 | 0 | 6 | 6 |
| C8X13.75 (ours spelled 13.7) | 4 | 4 | 6 | 7 | 1 |
| C12X20.7 | 3 | 1 | 1 | 4 | 3 |
| W8X24 | 2 | 1 | 1 | 1 | 0 |
| W12X26 | 1 | 0 | 1 | 1 | 0 |
| HP10X42 | 0 | 1 | 1 | 2 | 1 |
Where the size is read and linked (W16X26, HSS6X6X1/2, W21X55, HSS12X8X1/4) the display count is within a few pieces of theirs. The big deficits are HSS8X4X1/2, HSS12X12X3/8, HSS4X4X1/4 and HSS8X6X1/4 (170 of the 237 missing pieces): repeated members and unlinked labels. One size we found 27 times against their 19 (W21X55) shows the opposite error (labels that are not members, or members the estimator counted elsewhere).

## 6. Proven, likely, unknown
**Proven (measured, one project):**
- At the (size, job) level the display count is 49% low in unit-weighted count and has 21% of the sizes within 20%; the pre-registered reading is "not usable".
- The naive label count beats the linked count on every primary measure, so linking, as it is, does not add at the quantity level; leaving out 62 unlinked labels and 27 shared-line labels costs 89 pieces (322 against 233).
- Sheet-number extraction for this project cannot be used for mapping; the title-block corner rule mapped all 16 references uniquely.
- Their largest size is invisible to us (0 of 62).

**Likely (supported, not proven):**
- A material part of the estimator's quantity is repeated or typical members that are not individually labelled; only a person's clicks (the copilot) can reach them. The rows with 20 to 30 pieces each support this; I did not check the drawings for those rows.
- Unlinked labels are mostly real pieces: the naive count is closer than the linked count, and the 62 unlinked labels sit on sizes where theirs is higher than ours.

**Unknown:**
- Whether any of this holds on a second job: there is no second finished takeoff.
- Which share of their 463 pieces is typical-by-note (a note says "typical") against drawn repeats.
- Kind accuracy: our kind is blank for almost every member, so it was not measured.

## 7. Consequences for the copilot (Parts B and C)
1. Unlinked labels must stay visible and acceptable as pieces (a suggestion layer that includes them), not be dropped from the draft.
2. Quantities per row of 10 to 30 mean the estimator needs a fast "count this many like this one" action; the click-count mode with size autofill is the direct way to produce them.
3. A kind per piece (the click mode asks for it) is needed for any kind-level comparison; today it is blank.

## 8. Decisions for the owner
See OPEN_QUESTIONS 113 to 116.
