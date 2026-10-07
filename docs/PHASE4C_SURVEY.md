# Phase 4c survey: text-layer drawing sets (counts only)

Read-only. No page was rendered or viewed, nothing was OCR'd or decoded into a result, no model was called. Text was matched against generic patterns and only **counts** were kept. Tool: `worker/tools/text_survey.py` (synthetic tests in `worker/tests/test_text_survey.py`). Per-document JSON is in `fixtures/private/survey_phase4c.json` (git-ignored); IDs are the anonymous ids from the inventory.

## Selection (by structure only)
Six of the 19 unique text-layer documents, chosen so that producer category and page count vary: two Bluebeam-type, two AutoCAD-type, two other. Large pages only; at most 20 evenly spaced pages per document (documents over 20 large pages are sampled).

| Doc | Producer | Large pages | Measured | Optional-content layers |
|---|---|---|---|---|
| job-002 | Bluebeam | 7 | 7 | 0 |
| job-015 | Bluebeam | 37 | 20 | 0 |
| job-004 | AutoCAD | 18 | 18 | 32 |
| job-005 | AutoCAD | 35 | 20 | 13 |
| job-008 | other | 16 | 16 | 1 |
| job-013 | other | 23 | 20 | 0 |

## 1. Text quality
| Doc | Printable, non-private-use share of characters | Rotated lines | Words per page (median) |
|---|---|---|---|
| job-002 | 100% | 24.3% | 1858 |
| job-015 | 100% | 9.1% | 1233 |
| job-004 | 100% | 9.2% | 868 |
| job-005 | 100% | 4.6% | 340 |
| job-008 | 100% | 9.6% | 686 |
| job-013 | 100% | 13.9% | 845 |

No garbled font encodings were detected in any of the six. Rotation is measured against the displayed page (rotation matrix applied), so rotated pages do not inflate it.

## 2. Are member labels text?
Hits (regular expressions, generic steel profile forms; overlap between families is possible):

| Doc | Member hits, plan region | Member hits, title-block region | Plan : title | Pages with text only in title region | Profile families seen (hits) |
|---|---|---|---|---|---|
| job-002 | 653 | 8 | 81.6 | 0 | W 649, L 8, ROD 3, PIPE 1 |
| job-015 | 657 | 32 | 20.5 | 0 | W 300, HSS 135, L 116, C 98, PL 33, MC 3, ROD 3, PIPE 1 |
| job-004 | 193 | 21 | 9.2 | 0 | HSS 132, W 72, L 5, ROD 3, PIPE 2 |
| job-005 | 115 | 0 | n/a | 1 of 20 | W 50, PL 19, L 18, C 14, HSS 7, MC 4, ROD 2, PIPE 1 |
| job-008 | 167 | 8 | 20.9 | 0 | HSS 69, W 62, L 31, C 4, WT 4, PIPE 5 |
| job-013 | 198 | 12 | 16.5 | 0 | W 92, HSS 61, L 31, ROD 16, C 4, MC 4, PIPE 2 |

Other patterns:

| Doc | Mark-like tokens (1-2 letters + digits) | Feet-inch dimension strings | Scale strings (ratio / NTS) | Sheet-number-like tokens (dot form) |
|---|---|---|---|---|
| job-002 | 48 | 730 | 13 / 1 | 41 (0) |
| job-015 | 618 | 925 | 176 / 7 | 519 (4) |
| job-004 | 120 | 366 | 88 / 6 | 207 (26) |
| job-005 | 108 | 196 | 55 / 20 | 156 (3) |
| job-008 | 127 | 339 | 44 / 1 | 41 (0) |
| job-013 | 403 | 470 | 49 / 8 | 272 (10) |

In all six, the member text is in the plan body, not only in the title block (ratios 9 to 82). No document had a body that is outlined with text only in the title block. Pipe and rod were counted only as the words PIPE and ROD, not as sizes. `S`, `HP` and `WT` shapes were searched too; only `WT` (job-008) appeared in the table above, and `S` and `HP` gave no hits in these six. Mark-like and sheet-like counts are noisy by construction (they also match other tokens of the same shape).

## 3. Grids and bubbles
| Doc | Circles | Of which made of separate short segments | Exactly one short token | Grid-like (one letter or 1-2 digits) | Two stacked tokens | Callout-like (second token sheet-style) | Grid-like bubbles with a long line attached (solid / chained) |
|---|---|---|---|---|---|---|---|
| job-002 | 181 | 0 | 135 | 95 | 8 | 8 | 0 (0 / 0) |
| job-015 | 747 | 75 | 688 | 362 | 10 | 7 | 1 (1 / 0) |
| job-004 | 173 | 0 | 8 | **0** | 63 | **63** | 0 |
| job-005 | 271 | 6 | 170 | 121 | 4 | 4 | 0 |
| job-008 | 178 | 63 | 99 | 74 | 0 | 0 | 0 |
| job-013 | 161 | 2 | 129 | 115 | 2 | 2 | 0 |

- Five of six have many single-token circles of the grid-bubble type. `job-004` has none and 63 two-line callout bubbles instead (a callout-only drawing like `job-001`).
- **Long lines through or ending at those bubbles were almost never found** (1 attachment in total). The rule is strict (line within 0.35 radius of the centre axis and ending within 1.5 radius) and counts only thin lines of 150 pt or more, solid or reconstructed chained dashes. So this measurement does **not** show that the single-token circles are a grid; they may be keynotes, column marks or other markers, or the grid lines stop short of the bubbles. Unknown.

## 4. Linework
| Doc | Real dash patterns | Chained-dash lines (segments in them) | Of which regular (equal length and gap) | Layers referenced by page content | Distinct layers used by paths |
|---|---|---|---|---|---|
| job-002 | 0 | 0 | n/a | no layers | 0 |
| job-015 | 0 | 1427 (18,042) | 1356 | no layers | 0 |
| job-004 | 0 | 1683 (23,365) | 1478 | yes | 32 |
| job-005 | 0 | 323 (4,345) | 251 | yes | 11 |
| job-008 | 0 | 330 (3,516) | 292 | no (1 layer, unused) | 0 |
| job-013 | 0 | 9205 (190,279) | 7988 | no layers | 8 (path-level layer tags without layer objects) |

Stroke-width histograms (paths per bucket, widths in pt) and colour histograms are in the JSON. Summary: in five of six documents 84% to 98% of stroked paths are 0.5 pt or thinner (`job-004`: 53%); `job-013` alone has about 595 thousand hairlines (0.1 to 0.25 pt). Colours are overwhelmingly black and grey; red, green and blue are at most 0.08% of paths. Real dash patterns were never used; dashes are always chained separate segments, mostly regular (so reconstructible).

## 5. Schedules
| Doc | Aligned-text tables detected | With any header keyword | With 2 or more | Header word occurrences (MARK / SIZE / QTY or QUANTITY / LENGTH / WEIGHT / ELEV or ELEVATION) |
|---|---|---|---|---|
| job-002 | 11 | 3 | 0 | 2 / 19 / 0 / 6 / 6 / 9 |
| job-015 | 6 | 0 | 0 | 21 / 15 / 0 / 3 / 10 / 16 |
| job-004 | 6 | 4 | 0 | 2 / 15 / 0 / 4 / 2 / 27 |
| job-005 | 3 | 1 | 0 | 2 / 5 / 1 / 6 / 2 / 7 |
| job-008 | 19 | 4 | 1 | 2 / 20 / 0 / 0 / 4 / 14 |
| job-013 | 12 | 2 | 0 | 1 / 26 / 0 / 10 / 7 / 16 |

The detector finds aligned rows and columns but flags few as having a header; the keywords themselves are common (SIZE, ELEV, LENGTH, WEIGHT). Whether these are member schedules is **not established** by this survey; the detector is crude (it will also flag note lists, and it misses rotated tables and tables drawn as ruled lines without aligned text).

## How this differs from `job-001`
| | job-001 (Phase 4a) | These six |
|---|---|---|
| Text | No text layer; text is outlined monoline strokes, read only with the glyph library | Real text layer, all characters printable, no garbled encodings |
| Member labels | Only reachable via the Phase 4b glyph reader | Present as text in the plan body (hundreds of profile strings per document) |
| Layers | Many, none linked to content | Present in 3 of 6; referenced by page content in 2 (11 and 32 layers actually used) |
| Grid | No lettered grid; callout bubbles only | Single-token bubbles in 5 of 6, but not shown to be attached to grid lines; one document is callout-only like `job-001` |
| Dashes | Exploded into short segments | The same: exploded and mostly regular; no real dash patterns |

## Feasibility of a first member-extraction MVP on text-layer documents
**Measured (supports an MVP):**
- Text is clean and positioned, with no OCR or glyph library needed.
- Member profile strings are plentiful and in the plan body, in every document.
- Feet-inch dimension strings (196 to 925 per document) and scale strings (13 to 176) exist as text.
- Dashes can be reconstructed deterministically (chains are regular).

**Not measured (unknown):**
- Which member each profile or mark string labels: the association between a label and the beam line it describes is the central unsolved step, and these documents give no grid to anchor it.
- Whether the single-token bubbles are a grid at all.
- Whether schedules are member schedules and whether their rows are parseable.
- Plan versus detail versus schedule classification of sheets, and sheet scales per sheet.
- Accuracy of any extraction (no ground truth for these documents exists).

An MVP restricted to what is measured would be: extract text items with positions (profile strings, marks, dimension strings, scales, sheet numbers), report them per sheet with counts and `needs_review` flags, and stop short of building members until the label-to-geometry association is specified. Building members now would mean inventing that rule.

## Risks, ranked
1. **Label-to-member association is unspecified and unmeasured.** Many profile strings per sheet, no grid, thousands of line segments; the wrong association would produce confident but wrong members.
2. **Grid existence is unproven.** Single-token bubbles are abundant but attached lines were not found (1 in total); one drawing is callout-only. Relying on grids could fail.
3. **Linework is reconstructed, not given.** Dashes are chained segments (up to 190 thousand segments in one document); hairline-dominated pages are heavy to process.
4. **Heterogeneity across producers.** Layers matter in the AutoCAD-type documents (11 and 32 used layers) and are absent elsewhere; behaviour differs by document.
5. **Schedules uncertain.** Few detected tables carry a header; many drawings may carry member information only in schedules or only in plan text.
6. **Rotated and vertical text.** 5% to 24% of lines are rotated; labels along rotated members need orientation handling.
7. **Sampling and pattern noise.** Six documents, at most 20 pages each; mark-like and sheet-like counts overlap with other token types; the circle and attachment rules are heuristics.
8. **No ground truth.** Nothing here measures accuracy; any later accuracy claim needs a labelled set.

## Tool corrections
While building this survey two bugs in the earlier inventory tool were found and fixed (text coordinates on rotated pages were not mapped through the rotation matrix; dash chaining could link backwards). The inventory was rerun and `docs/INVENTORY.md` updated. The first version of this survey's grid-line and schedule measurements were too narrow (solid lines only; header in the first two rows only) and were widened (chained-dash lines count; header looked for in the row above and the first three rows) before the numbers above were taken.
