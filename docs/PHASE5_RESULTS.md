# Phase 5 results: review screen and takeoff table (v1)

Test document: **job-005**, 35 pages, vector. Views were drawn on four pages (14, 15, 27, 29) by the test harness acting as a person: the box around the Phase 4e gold labels of the page (+150 pt), scale confirmed (page 15 typed by hand from the page's own scale text, pages 14, 27 and 29 from the detected text; all `1/2" = 1'-0"`, ratio 24). Nothing else on the document was reviewed.

## What was run
- API tests 352 passed (28 files), worker tests 453 passed, web tests 11 passed; lint (eslint, ruff, prettier, tsc) clean. Tests use the separate `_test` database; both clients refuse the real one.
- Browser checks (headless Firefox, screenshots in the git-ignored `fixtures/private/shots/`): page list and viewer; view box and scale confirmation; label overlays; find members and colors; keys 1/2/3, Enter, Delete, N, L (click a line), U; takeoff tab and a row jump to another sheet.

## Counts on the four views (190 members, all `beam`)
| page | green | amber | red |
|---|---|---|---|
| 14 | 8 | 14 | 2 |
| 15 | 8 | 3 | 0 |
| 27 (detail) | 0 | 23 | 11 |
| 29 | 53 | 54 | 14 |
| **all** | **69 (36%)** | **94 (49%)** | **27 (14%)** |

Most marks are NOT red. Green means the rule was sure, not that a person checked it. No beam has a mark or legend row on this document (it has no legend rows), so the mark and column paths were tested only on synthetic data.

## Color calibration against the Phase 4e gold (AI-made, not a person's check)
40 gold labels, all 40 matched to a member. Correct = the rule's proposed line is the gold line.
| color | labels | rule line correct |
|---|---|---|
| green | 16 | 16 |
| amber | 21 | 14 |
| red | 3 | 2 |
| all | 40 | 32 |

All 8 wrong links have gold `missing` (no correct line among the candidates). 7 of them were amber and 1 red; none was green. The sample is small and the gold was made by an AI; treat it as a check that colors are not wildly off, not as an accuracy.

## Actions to fix
- Measured in the browser: keyboard "next to review, Enter" = 2 key presses and turns a member green with the check mark; "next, Delete" = 2; undo restored the exact earlier counts (53/54/14 on page 29). Relink: click the member, press L, click the line = 3 interactions.
- By count, not timed: pick from the top 3 = 2 (select, 1/2/3).
- The average for fixing a wrong link on job-005 **could not be measured**: all 8 wrong links have no correct line to click. Deleting them is 2 actions.

## Not done / limits
Pricing, weights, AISC check, raster or outlined-text documents, automatic column detection, dimension strings, cross-document learning are out of scope and not built. Takeoff length = the length of the chosen drawn line (no end allowances). See `docs/OPEN_QUESTIONS.md` 39 to 47.
