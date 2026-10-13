# V1 target screen: spec (docs only, nothing is built)

Goal: the owner uploads an estimation PDF; in minutes the system marks every counted member on each page the way an estimator does in Bluebeam (a symbol with a tag), coloured green, amber or red by confidence; for each page and for the whole job it produces the CSV columns; the estimator reviews page by page, sees what the system did AND WHY, corrects it, and exports the corrected Excel. No black box: every marking is explainable with evidence the estimator can click.

Scope: MAIN steel, in the estimators' own 21 kinds (section 6). The 12 MISC kinds are reserved for later; Joist, Wall and Other trades are excluded kinds and are only listed as "not counted". Hours per quantity (the estimators' pricing rule) is out of scope and is not built. Weights and grade come only from the confirmed catalog; the screen never invents them (a missing value is shown as missing and flagged).

What the estimators' markings look like (Phase 5t/5u study, counts in `docs/PHASE5U_RESULTS.md`): one symbol per counted piece, a small shape (circle or triangle) with a short tag that is numbered per piece (the tag is distinct on 193 of 200 pages that have symbols); colour and shape together follow the member kind (96.5% of symbols sit in the dominant colour and shape of their tag prefix); a separate stroke of another colour sometimes points from the symbol to the member. The screen copies this convention so the estimator sees something familiar, with ONE difference: our colour is confidence (green, amber, red), and member kind is shown by the symbol shape and the tag prefix.

## 1. Page view (what the system draws)

Per page, on top of the page image:

- **Symbol:** one per counted piece, placed on the member's line (the middle of the linked line, offset 12 pt to the side of the label so it does not cover the label). Shape is a GROUP of kinds, not a kind: **circle = linear member** (beams, braces, girts, lintels and the like), **triangle = column or post**, **square = plate** (embed, bearing and bent plates), **diamond = other** (frames, hangers, rods and other attachments). The old rule "square = joist" is removed; joists get no symbol.
- **Tag:** the system's number for that piece on this page, sequential in reading order, with a prefix that is the kind's ABBREVIATION (the full list is the owner's and is being collected in a private inventory of the tag prefixes, `prefix_inventory.csv`, whose meaning column is empty). Until the owner's list is filled the prefix is provisional (first letters of the kind name) and the tag carries the flag "provisional prefix". Each piece has its own tag. A repeated member (TYP) is NOT collapsed: it gets one symbol and one tag per piece, as the estimators do; where the drawing only says it once (a TYP note, a note such as "take double quantity", or a schedule quantity), the system does NOT generate pieces: it puts an amber FLAG on the page (and on the marked piece nearest to the note) saying "TYP / quantity note: check the number of pieces", and the estimator adds the pieces or confirms the count (decided by the owner).
- **Colour (confidence):** green = the system is sure and a person has not needed to touch it; amber = a person should check (for example a shared line, a medium-confidence link, a length not trusted); red = the system could not decide (no candidate, conflicting profile, no length). **Red pieces are NOT in the main total**: they are listed on their own line under the table ("red, not counted: N pieces") until a person fixes or confirms them. A blue ring on a symbol = a person confirmed or fixed it (the colour then stays as the system's own, the ring says "reviewed"). Grey = existing steel or not a member, listed apart, in no total. **Excluded kinds** (Joist, Wall, Other trades) that are drawn are listed apart as "not counted" (owner to confirm for joists), never drawn with a count symbol.
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
Length          <length> measured (source: measured_auto | measured_manual | written | typed); scale <scale> from view 1
                trusted: no (the line is shared by B9 and B10)   [show the measuring line]
Confidence      AMBER because: link margin below 40 pt; shared line
Missing         length not confirmed; unit weight: profile not in catalog
-----------------------------------------------------------------
Actions: [confirm] [change size] [change line] [measure] [type a length]
         [not a member] [existing, not counted] [undo]
```

The evidence rows are exactly those the product already stores: the label and its position, the candidate list with distance, angle and score, the rule's confidence class and margin, the page type guess and its reason, the scale of the view, the shared-line group, the schedule row for the mark (Phase 5d), and the list of what is missing. Anything the system could not find is written as "not found" in the list, never left out.

## 3. Page table and overall table

Both use the CSV columns, in this order: Reference Dwg No., Quantity, SHAPE, Size, Name, Length ft, Length in, Unit W, Total W, Grade.

- **Page table:** a **Kind** column comes first (the member kind, a dropdown the estimator can change); one row per distinct (Kind, SHAPE, Size, Name, Length) group on the page; Quantity = the number of pieces in the group; Reference Dwg No. = the sheet. Clicking a row selects and highlights its symbols on the page. A row shows the worst colour of its pieces. Unit W, Total W and Grade come from the confirmed catalog only; a profile that is not in it leaves them empty and the row is amber with "not in catalog".
- **Summary by kind (top of the overall output):** one line per kind with Quantity (pieces), the number of groups and the total weight when weights are known; main kinds first, then misc (reserved), then "not counted" (excluded kinds). Red pieces are on their own line below it.
- **Overall table:** the same grouping across all pages of the job, Reference Dwg No. showing every sheet that contributes (the first, plus a count). Footer: totals of Quantity and Total W, and the line **"draft, N sheets unconfirmed"** while any sheet is unconfirmed.
- **Excel export:** exactly these columns, with one sheet for the job and one per page, plus a corrections sheet (what the estimator changed, by whom, when).

### 3b. How the tables map to the estimator's real workbook (Phase 5u W1)
The finished takeoff of job-018 has one row per GROUP: one drawing reference, one size, one name, one length, with the number of pieces in Quantity (96 main rows hold 463 pieces). It is not one row per size, per name or per mark: the same size appears on several references and with several lengths; up to 14 rows share a reference; rows come in blocks (8 blocks, each introduced by one label row), then a total row, then a separate misc block. So:
- **Per-page table = the estimator's rows for that sheet:** group by (Reference Dwg No., SHAPE, Size, Name, Length ft, Length in); Quantity = pieces in the group; Unit W and Total W (Quantity x length x Unit W) and Grade follow; the sheet's rows keep the estimator's order of blocks when a block structure is known, otherwise are ordered by SHAPE then size.
- **Overall table = all rows of the job in the same grouping, then a total (tonnage) row;** misc and plates are not produced in v1 (out of scope).
- **Name** is a short descriptive text of the member kind and role in the workbook (not a mark). Our system has no such text; v1 fills Name from the kind plus the tag, editable, and flags it as "system wording". The estimator's own wording is the editable cell.
- **Reference Dwg No.** is the sheet number in the workbook (and may carry a detail number in front; v1 uses the sheet number).
- **Weights:** the estimator's Unit W is not a catalog and is not loaded; Unit W, Total W and Grade come from the confirmed catalog only. The grade the estimator used follows the shape family (A500 for HSS, A992 for WF in this file), so a rule "grade by family" is a suggestion shown as a flag, not silently applied.
- **Lengths (measured by default, Phase 5v):** the Length is MEASURED the way an estimator does it: two clicks on the member's two ends on the page, with the view's confirmed scale (distance in pt x 25.4/72 x scale ratio). The system makes the two clicks itself when a drawn line is found at both ends (`measured_auto`), a person makes them with the measure tool (`measured_manual`), a length printed in the PDF is read and kept only as a cross-check (`written`), and a typed number is `typed`. Each length shows its source and the scale used. The written length is never the default; when it differs from the measured one by more than 1 inch or 0.5% the row gets an amber flag "measured and written lengths differ". When no line is found and no one has measured, the cell is blank and flagged "length not measured".

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

## 6. Member kinds and how a kind is detected (proposal; nothing is built)

**Kinds.** MAIN (21): Column; Beams; Curved Beam/Rolled Beam; Truss; Horizontal Brace; Vertical Brace; Kicker/Knee Brace; Girt & Purlin; Lintel/Brick Veneer Supports; Posts/Pipe; Hangers; Deck edge Angle / Bent plate; Misc. Attachments; Outriggers; Sag rod; Turn Buckle; Dock Levellers; RTU Frame/Roof Hatch Frame; Roof Drain Frame; Embed Plate/Bearing Plates; Embeds Angle. MISC (12, reserved): Stair; Dock Stair; Guardrail; Handrail/Wallrails; Landing Frame; Roof Ladder; Ship Ladder/Cage Ladder; Pit Ladder; Bollard; Gates; Grating; Bike Rack. EXCLUDED (listed as "not counted"): Joist; Wall; Other trades.

**Detection is deterministic where text allows.** For a symbol or label the kind is looked up from, in order: (1) words in the same text line or within 150 pt of the label (the frozen rule's candidate radius); (2) words in the legend or note that the tag or mark points to; (3) the sheet context (page type guess and view title words). The first source with a keyword wins, the source is shown in the explanation panel, and the kind is flagged "guessed" until a person confirms it. When no keyword is found the kind is left EMPTY (grey symbol, kind dropdown in the panel), never defaulted. A plain "brace" without a direction, or "rail" or "ladder" alone, is kept as an ambiguous kind that the person resolves. The table is the keyword table pre-registered for the workbook study (`docs/PHASE5U_PREREGISTRATION.md`, K), in its priority order (specific words before general ones). It is a proposal; nothing is implemented.

| Kind | Symbol group | Keywords (lower case, substring) | Sheet context hint |
|---|---|---|---|
| Curved Beam/Rolled Beam | circle (linear) | curved, rolled | framing plans |
| Truss | diamond (other) | truss | roof framing |
| Girt & Purlin | circle (linear) | girt, purlin | roof or wall framing |
| Lintel/Brick Veneer Supports | circle (linear) | lintel, brick, veneer | elevations, wall sections |
| Deck edge Angle / Bent plate | square (plate) | deck edge, edge angle, bent plate | roof framing, details |
| Kicker/Knee Brace | circle (linear) | kicker, knee | framing plans, sections |
| Horizontal Brace | circle (linear) | horizontal brace, horiz | framing plans |
| Vertical Brace | circle (linear) | vertical brace, x-brace, chevron | elevations, sections |
| Embeds Angle | diamond (other) | embed angle, embeds angle | foundation plans |
| Embed Plate/Bearing Plates | square (plate) | embed, bearing plate, bearing | foundation plans, details |
| RTU Frame/Roof Hatch Frame | diamond (other) | rtu, hatch | roof framing |
| Roof Drain Frame | diamond (other) | drain | roof framing |
| Dock Levellers | diamond (other) | dock level, leveller, leveler | plans at docks |
| Sag rod | circle (linear) | sag | roof framing |
| Turn Buckle | diamond (other) | turn buckle, turnbuckle | bracing |
| Outriggers | circle (linear) | outrigger | framing plans |
| Hangers | diamond (other) | hanger | framing plans |
| Misc. Attachments | diamond (other) | attachment | any |
| Posts/Pipe | triangle (column or post) | post, pipe | plans, details |
| Column | triangle (column or post) | column | foundation and framing plans |
| Beams | circle (linear) | beam | framing plans |
| Joist (excluded) | none | joist | framing plans |
| Wall (excluded) | none | wall | plans |
| MISC kinds (reserved) | later | stair, dock stair, guardrail, handrail, wallrail, landing, roof ladder, pit ladder, ship ladder, cage, bollard, gate, grating, bike | later |

**What the keywords reach in the one finished takeoff (job-018, Name column).** Of 96 main rows, 79 (82%; 329 of 463 pieces, 71%) map to 5 main kinds (Beams 50 rows, Column 15, Vertical Brace 12, Girt & Purlin 1, Horizontal Brace 1); 1 row says brace or rail without a kind; 16 rows (17%; 130 pieces, 28%) carry no kind word and would be left to the person with the dropdown. The 7 rows after the total row are the misc block (6 rows: stair, dock stair, handrail, guardrail; 1 unmapped). No joist, wall or other-trade rows exist. This measures the words of the finished sheet, not the words near labels on a drawing; the second is not yet measured.


## 7. Measure tool (Phase 5v; proposal, nothing is built)
- **Purpose:** give a member its length the way the estimators do in their markup tool. Length is measured by default; a written length is only a cross-check.
- **How it works:** select a member (or none), press the measure key, click the first end and then the second end on the page. The end points snap to the nearest line end within 12 pt when there is one. The length is the distance between the two points in pt x 25.4/72 x the view's scale ratio, shown in feet and inches (nearest 1/16 inch).
- **What is drawn:** a BLUE measuring line between the two points with an end marker at each point, and a label with the length and the scale used (for example the scale text of the view). Blue is not a confidence colour (green, amber and red stay for confidence). The line is kept so the estimator can see what was measured; it can be dragged at either end, which re-measures.
- **Automatic first pass:** where a linked line exists, the system places the same measuring line on its two ends (`measured_auto`) and shows it in blue like a manual one. Phase 5v (docs/PHASE5V_RESULTS.md) found that the auto line often does not match the estimator's own clicks, so every auto length stays amber until confirmed, and the estimator can re-click.
- **Flag for sloped or unclear members:** a member that is sloped (a brace, a rake beam) or whose ends are unclear in plan can be flagged with one click ("sloped or unclear"). The flagged member keeps its plan-measured length, is amber, and is listed in the page table notes as "length needs a person (slope or unclear ends)". The system does not compute slope lengths in v1.
- **No scale:** when the view has no confirmed scale the tool is disabled and says so (the same rule as for the view scale in section 1).
- **Stored per measure:** the two points, the scale ratio used, the length, the source, who measured and when (see docs/SCHEMA_CHANGE_PROPOSAL.md section 9).
