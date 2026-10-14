# Phase 9 Part C: why the 62-piece size of job-018 is invisible (diagnostic, read-only)

Definitions: `docs/PHASE9_PREREGISTRATION.md` section 3 and its addendum (committed before the run). Tool: `worker/tools/takeoff/phase9_invisible.py` (synthetic tests of the geometry helper in `worker/tests/test_phase9_lib.py`). Patterns and counts only; no drawing text, sheet number or row text is in this document. Sheets are named by page index. The size is named by family only (a hollow section, HSS). The read-only API on port 3100 was started for this and stopped by its PID; the API on port 3000 was not touched.

**Correction made before the run:** the 62-piece size is the second largest, not the largest (the largest has 110 pieces and is found 64 times). The 110-piece size (also HSS) is run as a **control**.

## Answer
**The size is not invisible to the text reader; it is nearly absent from the drawings.** The estimators' 62 pieces are three rows of 30, 26 and 6. On the four sheets those rows point to, the size is written **twice in all** (once on each of two sheets), as a typical note, and the estimators placed **no count symbol on two of the four sheets** and 14 symbols (a different mark prefix) on the other two. So the quantity does not come from counting labels or lines: it comes from a repeat count stated outside the drawing marks. "Label count x lines in the region" does not approach it (ratio 0.03 to 0.15). The control shows the diagnostic can tell the difference: for the 110-piece size the label count alone equals the takeoff quantity (110 / 110).

## C1. Where the size sits
Rows of the size: 3 (quantities 30, 26, 6); 3 references each, all mapped, pointing to sheets (page indexes) **1, 4, 5 and 9** (rows 1, 5, 9 / 1, 4, 9 / 1, 5, 9).

| | text layer (full size written) | stroke text | dimensions only / fragment | nowhere |
|---|---|---|---|---|
| sheet 1 | 0 | 0 | 0 | **yes** |
| sheet 4 | **1 line** | 0 | 0 | |
| sheet 5 | **1 line** | 0 | 0 | |
| sheet 9 | 0 | 0 | 0 | **yes** |

- Whole project (23 sheets): the full size appears on **2 lines** (sheets 4 and 5) and a bare dimension pair (no family letters) on 7 more lines (1 on sheet 10, 6 on sheet 12; none on the sheets the rows point to).
- Sheets 1 and 9 do have a text layer (115 and 239 text lines), no stroke lettering and no unreadable item: the size is simply not written there, not missed by the reader.
- **Our parser reads both occurrences** (2 of 2 give the same profile). The project holds **2 members with this profile, 0 linked**: in the display basis (one piece per linked line) they count 0, and as a label count 2. That is why Phase 8 found the size "0 times": the two labels have no linked line.
- **Pattern around the 2 occurrences:** the line itself has no `@` spacing, no `TYP`, no `EQ SP`, no `O.C.`, no `U.N.O.`, no count `(n)`, fewer than 5 words (0 of 2). In the text within 120 pt, **`TYP` appears for 2 of 2**; no `@`, `EQ SP`, `O.C.`, `U.N.O.` or count. Both labels have a line of some class within 24 pt, neither is linked by our linking.
- **Estimators' marks on those sheets (exploratory, from the marked-up PDF):** 0 count symbols on sheets 1 and 9; 6 on sheet 4 and 8 on sheet 5, all with one mark prefix (P). Fourteen symbols against 62 pieces; the 62 are not counted by symbol.

## C2. Parallel member lines in the region the label points to
Anchor = the label's linked line, else the nearest line of any class within 80 pt. Both labels are unlinked: anchors are "nearest line within 80 pt" (2 of 2). Parallel lines of the same stroke class, at least half the anchor's length, within 3 degrees, region along the anchor +/-10% and +/-150 / 300 / 600 pt across.

| half-width | parallel lines per label (min / median / max) | labels (2) x median | ratio to 62 | band |
|---|---|---|---|---|
| 150 pt | 1 / 1.5 / 2 | 3 | 0.05 | below |
| 300 pt | 3 / 3.5 / 4 | 7 | 0.11 | below |
| 600 pt | 4 / 4.5 / 5 | 9 | 0.15 | below |
| label count alone | | 2 | 0.03 | below |

## Control: the 110-piece HSS size
17 rows (quantities 1 to 22), references on sheets 11, 17, 18 and 19. The size is written **110 times** in the text layer (36, 2, 50, 22 on those sheets), every one read by the parser, one member per label (110 members, 77 linked). Label count / takeoff = **1.00 (in band)**. The pre-registered product (labels x median parallel lines) is 4.0, 5.0 and 8.0 times the takeoff at 150, 300 and 600 pt (**above**): multiplying by parallel lines over-counts a size that is already counted label by label. Around the labels `TYP` appears for 2 of 110 and `U.N.O.` for 1 of 110 (within 120 pt); none has `@`, `EQ SP`, `O.C.` or a count.

## What is proven, likely, unknown
- **Proven (counts above):** the 62-piece size is written twice in the whole drawing set, both times as an unlinked label near `TYP`; the reader and the parser read both; our linked-line basis therefore counts 0 and a label count gives 2; the estimators put no symbol on 2 of the 4 sheets; "label count x parallel lines" gives 0.05 to 0.15 of the quantity for this size and overshoots 4 to 8 times for a size counted one label per piece.
- **Likely:** the 62 pieces are a typical-members decision (a size stated once as typical, applied to many positions, quantities typed into the workbook). This matches OPEN_QUESTIONS 114. The rows of 30 and 26 pieces and the missing symbols fit this reading.
- **Unknown:** where the 62 members are on the drawings (if drawn at all, possibly as columns drawn without a label; I did not look at a page image); whether the typical note covers exactly these members; whether the estimators counted them from a schedule that is not in our document (the takeoff PDF holds more pages than ours).
- **Limits:** one size on one job against a control of one more; the region is a geometric guess; "nowhere" means the text layer has no such string on those pages (a size drawn as a picture would be "nowhere" too: image coverage is 0.2% on these sheets, so this is unlikely). No rule was built from this diagnostic.
