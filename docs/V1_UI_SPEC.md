# V1 target screen: spec (docs only, nothing is built)

Goal: the owner uploads an estimation PDF; in minutes the system marks every counted member on each page the way an estimator does in Bluebeam (a symbol with a tag), coloured green, amber or red by confidence; for each page and for the whole job it produces the CSV columns; the estimator reviews page by page, sees what the system did AND WHY, corrects it, and exports the corrected Excel. No black box: every marking is explainable with evidence the estimator can click.

Scope: MAIN steel (beams, columns, braces, joists). Misc steel and plates are out. Weights and grade come only from the confirmed catalog; the screen never invents them (a missing value is shown as missing and flagged).

What the estimators' markings look like (Phase 5t/5u study, counts in `docs/PHASE5U_RESULTS.md`): one symbol per counted piece, a small shape (circle or triangle) with a short tag that is numbered per piece (the tag is distinct on 193 of 200 pages that have symbols); colour and shape together follow the member kind (96.5% of symbols sit in the dominant colour and shape of their tag prefix); a separate stroke of another colour sometimes points from the symbol to the member. The screen copies this convention so the estimator sees something familiar, with ONE difference: our colour is confidence (green, amber, red), and member kind is shown by the symbol shape and the tag prefix.

## 1. Page view (what the system draws)

Per page, on top of the page image:

- **Symbol:** one per counted piece, placed on the member's line (the middle of the linked line, offset 12 pt to the side of the label so it does not cover the label). Shape by member kind: circle = beam, triangle = column, square = joist, diamond = brace.
- **Tag:** the system's number for that piece on this page, sequential in reading order (the first tag of each kind is 1; the prefix is a letter by kind). Each piece has its own tag. A repeated member (TYP) is NOT collapsed: it gets one symbol and one tag per piece, as the estimators do; where the drawing only says it once (a TYP note, a note such as "take double quantity", or a schedule quantity), the system does NOT generate pieces: it puts an amber FLAG on the page (and on the marked piece nearest to the note) saying "TYP / quantity note: check the number of pieces", and the estimator adds the pieces or confirms the count (decided by the owner).
- **Colour (confidence):** green = the system is sure and a person has not needed to touch it; amber = a person should check (for example a shared line, a medium-confidence link, a length not trusted); red = the system could not decide (no candidate, conflicting profile, no length). **Red pieces are NOT in the main total**: they are listed on their own line under the table ("red, not counted: N pieces") until a person fixes or confirms them. A blue ring on a symbol = a person confirmed or fixed it (the colour then stays as the system's own, the ring says "reviewed"). Grey = existing steel or not a member, listed apart, in no total. **Joists** that are drawn are listed apart as "not counted" (the estimators do not count them; the owner is to confirm), never drawn with a count symbol.
- **Unlinked labels:** labels with no line found are drawn as small red hollow squares at the label, so they are visible and clearly not counted.
- **Filters:** by colour, by kind, "only unreviewed", "only what changed since the last run".

```
+--------------------------------------------------------------------------+
| Job: <id>    Page 12 of 23   [< prev] [next >]   page: reviewed 0/38  |
| Totals: DRAFT - 3 sheets unconfirmed      [Export Excel] [Export CSV]    |
+-------------------------------------------+------------------------------+
|                                           | Members on this page         |
|     (page image, symbols on members)      |  green 31  amber 5  red 2    |
|        (B)  (B)  (B)    <T>  <T>          |  filter: [all v] [kind v]    |
|        o---------o----------o             | ---------------------------  |
|            (B)        (B)                 |  B1  <profile A>  <length>   green  |
|                                           |  B2  <profile A>  <length>   green  |
|   [zoom] [pan] [add member] [undo]        |  B9  <profile B>  --       red    |
+-------------------------------------------+------------------------------+
| Explanation panel (selected marking)  |  Page table (CSV columns)        |
+--------------------------------------------------------------------------+
```

## 2. Explanation panel for one marking (the evidence list)

Selecting a symbol (or a table row) opens the panel. Every line is a clickable link that jumps the page view to the evidence and highlights it:

```
B9   beam   RED   "no length: the line was shared by 2 labels"
-----------------------------------------------------------------
Tag text        [jump]  the label text "<profile B>" highlighted on the page
Size            <profile B> from the beam schedule, row 4   [jump to sheet <n>]
                (or: from a plan label only / not found in any schedule)
Page type       "framing plan" (guess, as an example)   [why]  title and label words found
Link            label -> line #2 of 3 candidates, 9.5 pt away, 0 deg off the text
                rule: nearest aligned line, margin 31 pt = confidence medium
                [show the 3 candidate lines on the page]
Length          <length> = line length x scale <scale> (scale set on view 1)
                trusted: no (the line is shared by B9 and B10)
Confidence      AMBER because: link margin below 40 pt; shared line
Missing         length not confirmed; unit weight: profile not in catalog
-----------------------------------------------------------------
Actions: [confirm] [change size] [change line] [type a length]
         [not a member] [existing, not counted] [undo]
```

The evidence rows are exactly those the product already stores: the label and its position, the candidate list with distance, angle and score, the rule's confidence class and margin, the page type guess and its reason, the scale of the view, the shared-line group, the schedule row for the mark (Phase 5d), and the list of what is missing. Anything the system could not find is written as "not found" in the list, never left out.

## 3. Page table and overall table

Both use the CSV columns, in this order: Reference Dwg No., Quantity, SHAPE, Size, Name, Length ft, Length in, Unit W, Total W, Grade.

- **Page table:** one row per distinct (SHAPE, Size, Name, Length) group on the page; Quantity = the number of pieces in the group; Reference Dwg No. = the sheet. Clicking a row selects and highlights its symbols on the page. A row shows the worst colour of its pieces. Unit W, Total W and Grade come from the confirmed catalog only; a profile that is not in it leaves them empty and the row is amber with "not in catalog".
- **Overall table:** the same grouping across all pages of the job, Reference Dwg No. showing every sheet that contributes (the first, plus a count). Footer: totals of Quantity and Total W, and the line **"draft, N sheets unconfirmed"** while any sheet is unconfirmed.
- **Excel export:** exactly these columns, with one sheet for the job and one per page, plus a corrections sheet (what the estimator changed, by whom, when).

### 3b. How the tables map to the estimator's real workbook (Phase 5u W1)
The finished takeoff of job-018 has one row per GROUP: one drawing reference, one size, one name, one length, with the number of pieces in Quantity (96 main rows hold 463 pieces). It is not one row per size, per name or per mark: the same size appears on several references and with several lengths; up to 14 rows share a reference; rows come in blocks (8 blocks, each introduced by one label row), then a total row, then a separate misc block. So:
- **Per-page table = the estimator's rows for that sheet:** group by (Reference Dwg No., SHAPE, Size, Name, Length ft, Length in); Quantity = pieces in the group; Unit W and Total W (Quantity x length x Unit W) and Grade follow; the sheet's rows keep the estimator's order of blocks when a block structure is known, otherwise are ordered by SHAPE then size.
- **Overall table = all rows of the job in the same grouping, then a total (tonnage) row;** misc and plates are not produced in v1 (out of scope).
- **Name** is a short descriptive text of the member kind and role in the workbook (not a mark). Our system has no such text; v1 fills Name from the member type (beam, column, brace) plus the tag the estimator can edit, and flags it as "system wording". The estimator's own wording is the editable cell.
- **Reference Dwg No.** is the sheet number in the workbook (and may carry a detail number in front; v1 uses the sheet number).
- **Weights:** the estimator's Unit W is not a catalog and is not loaded; Unit W, Total W and Grade come from the confirmed catalog only. The grade the estimator used follows the shape family (A500 for HSS, A992 for WF in this file), so a rule "grade by family" is a suggestion shown as a flag, not silently applied.
- **Lengths:** in the sample only 1 of 15 lengths is printed on the drawing; most are not. A length that is derived from the line and the scale is shown with its evidence and its trust flag; a length typed by the estimator replaces it.

## 4. How corrections update both

Every correction is one saved action with undo (the product already has this for members). After an action: the symbol recolours (or gets the blue ring), the page table and the overall table recompute from the members (never edited by hand), the page counters and the "unreviewed" counters update, and the explanation panel adds a line "changed by <person>, <time>: <what>" with the previous value. A change of a size or a length applies to the one piece; "apply to all pieces with this tag" and "apply to this TYP" are explicit second buttons, shown with the number of pieces affected before the click. Adding a member (the existing "add" tools) creates a symbol with a tag and a blue ring. Re-running a page never overwrites a person's correction; it shows a "the system now suggests X" note instead.

## 5. Flags instead of blocking gates (APPROVED by the owner, 2026-10-13)

Decision: approved with these additions. Red pieces stay OUT of the main total and are shown on their own line. The word "draft" is part of every export header AND every export file name while any sheet is unconfirmed. A TYP or double-quantity note is an amber flag (section 1). Joists are listed as "not counted" (owner to confirm).

Today a person must confirm the line classes of every view and decide include/exclude for every sheet before members are found; undecided sheets are outside the totals. In the calibration this added many extra steps (24 sheet decisions and 48 class confirmations for 24 pages, open question 63). The design:

1. After upload the pipeline runs on its own, end to end, with the best guesses: page types from the page type guess, included/excluded by that guess, line classes by the worker's suggestion, scale by the page's single scale or the most frequent printed scale, links by the frozen rule.
2. Nothing blocks. Every guess that a person has not confirmed is a **flag** on the page, on the view or on the marking: "page type guessed", "line classes suggested, not confirmed", "scale guessed", "sheet included by default", "TYP / quantity note".
3. The totals always show, with the label "draft, N sheets unconfirmed" (N = sheets with at least one unconfirmed flag). When N = 0 the label becomes "reviewed". Red pieces are not in the main total; they are on their own line.
4. A sheet's flags are cleared by one click ("these guesses are right") or by the corrections that fix them. Nothing a person did is overwritten by a later run.
5. Excluding a sheet remains an explicit person action; an excluded sheet is listed in the totals footer ("2 sheets excluded").
6. The existing safeguards stay: a length that is not trusted (a shared line, a missing scale) is never shown as a clean green number; it is amber, with the reason.
7. Risk and mitigation: a draft total that looks complete may be used without review. The "draft" label is in the export header and in the file name (for example `<job>_takeoff_DRAFT.xlsx`), and it goes away only when no sheet is unconfirmed.

Not built; no code or schema change is implied until the build phase is approved.
