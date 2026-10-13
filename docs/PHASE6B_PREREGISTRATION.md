# Phase 6b pre-registration: why do our counts disagree with the estimators', and does a different count basis fix it?

Written and committed BEFORE any of the Phase 6b measurements was run on a real drawing. Part A (small owner decisions) is code and docs only; it is committed separately and is not measured here.

## Not blind (disclosure)
- We have seen the Stage 1 totals (docs/PHASE6A_RESULTS.md): 2,718 symbols drawn against 4,373 of theirs, equal on 4 of 136 pages, 66 of the 136 pages left out by the page type default.
- We have seen the Phase 5t finding: only 19% of their 4,373 count symbols lie within 6 pt of a structural line of the Phase 5t classes, 33% within 12 pt, 50% within 25 pt, 34% farther than 60 pt; and where a line has a symbol within 12 pt it has ONE in 92% of cases. So a line-based basis is expected to be limited in recall by where their symbols sit (about one third at 12 pt) and a precision problem is not expected from shared lines. These expectations are written here so a surprise can be recognised; the numbers of this phase are new (position-level, one-to-one matching, three bases, an oracle).
- The Phase 5v result (lines are often split or overshoot) is known; the merge rule below is fixed from reading that sentence, not from fitting.
Nothing below is changed after the results are seen.

## Data
- The 16 jobs that have a marked-up takeoff PDF in `fixtures/private/takeoffs`, with the Phase 5t page mapping (`inventory.json`, takeoff page to drawing page) unchanged: 330 mapped pages.
- Ground truth: their count symbols = Polygon annotations with 3 or 8 vertices on the marked-up page (the Phase 5t/5u rule). Position of a symbol = the mean of its vertices, mapped through the page rotation matrix into displayed page points (the same space as the drawing lines). Colour-plus-shape group = (stroke colour key of the Phase 5u colour study, 3 or 8 vertices); the tag prefix is NOT used (its meaning is not known). "Their pages" = the mapped pages with at least one symbol (136 in the Stage 1 run).
- Ours: the Stage 1 pipeline run again on the clean drawings after Part A (every vector sheet included), no human action. The pieces are the "symbols drawn" of Stage 1: counted kinds and pieces without a kind, not unlinked labels, not existing, not misc, not excluded kinds; colours are the pieces' status colours (green, amber, red).
- The pre-Part-A run is the existing Stage 1 run (projects still in the database); its pieces are re-read (positions and linked lines are stored, not recomputed), only for the "sheet excluded" reason and for the Stage 1 comparison.

## Matching rule (all bases, all parts)
- Per page, one-to-one between their symbols and our pieces. Candidate pairs: distance <= R. Assignment: GREEDY by ascending distance (ties: their symbol index, then our piece index), each symbol and each piece used at most once. R = 12 pt primary; 6 pt and 24 pt also reported.
- Distance from their symbol centre to a piece: to the piece's linked line segment (point to segment); for a label-first piece with no linked line, to the label box (point to rectangle). Line-first pieces are their segments.
- precision = matched pieces / our pieces; recall = matched symbols / their symbols; F1 = 2PR/(P+R). Pooled over all their pages of all jobs, and per job. Our pieces on pages where they have no symbol count in the denominator of precision only in the "all mapped pages" variant; the primary precision is over THEIR pages (pieces on pages where they placed no symbol are reported separately as "extra pieces on pages without symbols").

## Count bases (Part C), same pages, same matching rule
1. Label-first (current): one piece per linked label (the pipeline's own pieces).
2. Line-with-label: one piece per DISTINCT linked line (two labels linked to the same line, endpoints equal within 0.6 pt, give one piece).
3. Line-first (study only): one piece per structural line of the included vector page after fixed merging; labels attached afterwards (the frozen rule's best candidate) only to report how many lines have a size and how many do not. Lines with no label are pieces with size missing.
   - Line set: lines inside the whole-sheet view box (the box the pipeline uses), sheet-border lines removed, of the view's SUGGESTED structural class (worker suggestion, no human), at least 12 pt long (the frozen candidate minimum).
   - Merge rule (fixed, not tuned): two lines of the class are joined when their directions differ by at most 1 degree, the perpendicular offset of one end from the other's line is at most 1 pt, and the gap between their nearest ends is at most 12 pt (overlaps join); repeated until nothing joins. A joined line is one piece.
   - Split measure: for each of their symbols whose nearest line within 12 pt exists, report whether that line was produced by joining two or more raw lines ("merged"), was a single raw line with a collinear neighbour (same angle and offset tolerance) whose gap is between 12 and 60 pt ("split remains"), or neither ("single").
- Line set for all three bases: the worker's suggested structural class per view (the primary). UPPER BOUND (clearly an oracle, not a result): the class per page, chosen from the page's classes of at least 3 lines of 12 pt or more, that gives the highest F1 at 12 pt against their symbols for that basis (ties: smaller count difference, then class key order); the linking of basis 1 and 2 is re-run in-process with the frozen rule on that class.

## Bars (proposed by the owner, kept)
Evaluated on their pages, basis by basis, at R = 12 pt, with "equal or within plus or minus 1" per page:
- **worth building on**: equal or within +-1 on at least 50% of pages AND precision and recall both at least 0.6.
- **promising**: at least 30% of pages AND precision and recall both at least 0.4.
- otherwise **not enough**.
Reasons for keeping the owner's numbers: they are round, they were fixed by the owner before this run, and a count that is right on half of the pages with two thirds of the symbols found in the right place is the least that lets a person review by exception.
Also reported for every basis: pages equal / within +-1 / within 20% (|ours - theirs| <= 0.2 x theirs), totals against theirs, P/R/F1 at 6, 12 and 24 pt, by colour for bases 1 and 2 (the colour of a piece; recall by colour is not defined, so by colour = precision and the share of matched pieces), per job, by their colour-plus-shape group (recall).

## Miss reasons (Part B), ONE reason per unmatched symbol of theirs, fixed order (first that applies), judged at 24 pt around the symbol and for the label-first basis
1. raster page: the sheet is not a vector page or one image covers half the page or more;
2. no extracted line: no line of the suggested class within 24 pt;
3. unlinked (no label reached it): there are such lines within 24 pt, and none of them is among the top six candidate lines (frozen radius 150 pt) of any label of the page;
4. linked elsewhere: labels reach those lines (they are candidates) but no piece is linked to any of them;
5. sheet excluded: the sheet had no pieces because the page type default left it out (reported for the pre-Part-A run only);
6. other, with the sub-count "several of their symbols on one linked line: a piece is linked to a line within 24 pt but it was used by another symbol".
For each unmatched piece of ours, ONE reason in this order: (1) the page has no symbol of theirs; (2) extra piece on a shared line (its linked line is linked by two or more pieces); (3) no symbol of theirs within 24 pt; (4) other.

## Coverage limits (Part D)
- Share of their symbols on raster pages; on vector pages where the suggested class has no line in the view; outside the whole-sheet view box.
- Share of their symbols that lie inside a small closed shape of the drawing (a stroked or filled rectangle or polygon whose box is at most 40 pt on a side with aspect 0.5 to 2, a column symbol or similar) and have no line of the class within 12 pt.
- Counts of their symbols per job and per colour-plus-shape group (the size of the human-made position data). Nothing is trained or built.

## Pictures (Part E)
12 pages with at least 10 symbols of theirs: the 6 where the largest relative difference |ours - theirs| / theirs over the three bases (suggested class) is smallest, and the 6 where it is largest (ties: job id, page number). Rendered to the git-ignored `fixtures/private/shots/phase6b/`: their symbols as blue rings, label-first pieces as red dots, line-with-label lines in green, line-first lines in orange. I look at them and write the dominant causes in plain words.

## What would change the plan (decision table, fixed now)
- A basis reaches "worth building on": next build = that basis, with the class choice as an open item if the oracle is far above the suggested-class result.
- No basis passes but the oracle of some basis reaches at least "promising": the class choice is the larger problem than the count basis; next build = class choice by the person per view (a picker) before anything else.
- Recall at 24 pt below 0.6 for every basis and the share of their symbols off the lines of the class above 0.4: the lines are not where the estimators count (symbols sit beside members, on column shapes, or on raster pages); next build = a detector over shapes or a different reference, not a line method.
- Raster pages above 15% of their symbols: raster is a scope decision for the owner before any basis.

## What this cannot show
Positions of their symbols are where the estimator clicked, not the true member position; matching is within a radius, so a near symbol can match a wrong member. Equal counts and matched positions do not prove size or kind. The marked pages are the pages the estimators chose.
