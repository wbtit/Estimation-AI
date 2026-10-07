# PDF inventory (read-only): counts and flags only

Tool: `worker/tools/pdf_inventory.py` (run as `python -I`, from outside the data folders), summary: `worker/tools/pdf_inventory_summary.py`. It counts and flags; it does not extract, OCR or decode text, and prints no names. The ID-to-filename mapping (`inventory_map.csv`) and the per-file table (`inventory.csv`) are in `fixtures/private/` (git-ignored). No PDF was copied anywhere. The two items were folders (no extraction needed), 15 and 19 PDFs, with no other file types.

## Result (date of run: 2026-10-07)
| Measure | All 34 files | 19 unique contents |
|---|---|---|
| PDFs / pages | 34 / 671 | 19 / 373 (6 to 37 pages each) |
| Type guess | drawing set 34, estimate/takeoff 0 | all drawing sets |
| Page size | large (>= 1000 pt) 34 | all |
| Real text layer | yes 32, no 2 | yes 18, no 1 |
| Vector with zero text (outlined text, like job-001) | 2 | 1 |
| Raster-only (scanned) | 0 | 0 |
| With optional-content layers | 17 (8 with a layer referenced by page content, 9 not) | |
| Creator category | Bluebeam 22, AutoCAD 4, other 6, unknown 2 | 13 / 2 / 3 / 1 |
| Circles with a short label (sampled pages) | present in 32 of 34 | present in 18 of 19 (all 18 with 20 or more); the exception has two-line callouts only |
| Dashes | exploded 32, real pattern 0, none 2 | exploded 18, none 1 |
| Repeated content | 15 files repeat an earlier file | |

Two files are byte-identical to `job-001` (one in each item); these are the two outlined-text files.

## Corrections made after the first run
Two bugs in this tool were found and fixed, and the inventory was rerun: text coordinates on rotated pages were not mapped through the page rotation (this undercounted labelled circles on rotated files), and dash chaining could link a segment backwards. The numbers above are from the corrected run.

## What the flags mean, and their limits
- **Sampling:** text characters, sizes and producer come from all pages. Path-based flags (vector-heavy, raster, circles, dashes) come from up to 6 evenly spaced pages per file, because counting paths on every page was too slow.
- **Labelled circles** = circles (fit to the path, radius 5 to 30 pt) containing a text-layer word of at most 3 characters, or (without a text layer) 1 to 8 small stroked paths. Because nothing is decoded, this **cannot tell lettered grid bubbles from detail or section callouts**; it is an upper bound for grids. Deciding that needs reading the labels, which this task excludes.
- **Dashes:** "real" = a path with a dash pattern; "exploded" = at least 4 equal short collinear single-line paths chained end to end. Checked on synthetic PDFs (tests) and on `job-001` (exploded, as found in Phase 4a). The exploded count can include other evenly spaced short lines (for example segmented underlines), so treat small counts as noise; 17 of 19 unique files have 100 or more segments on the sampled pages.
- **Type guess** is by page size and text volume only. All 34 are large-format, so no letter/A4 estimate document was in these two items.
- **Creator category** comes from the PDF producer and creator fields, reduced to a generic category.

## Decision-relevant observations
- Most drawings have a real text layer, so the Phase 4b glyph reader is needed only for the outlined-text minority (1 unique file here).
- Real dash patterns were not seen; exploded dashes are common, so a dash-aware reader must handle collinear short segments.
- Layers exist in half of the files, but only a minority are referenced by page content.
