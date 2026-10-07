# Phase 4a findings: what the outlined-text drawing set actually contains

Inspection and feasibility only. **No extraction pipeline was built.** Everything below was measured on the private 6-page fixture (`job-001`), whose text is outlined into vector paths. Names, titles and addresses that appear in the drawings are not reproduced anywhere in this document. Layer names are summarised, not listed. Raw dumps, crops and the throw-away scripts are in the git-ignored `fixtures/private/` (see the end).

Legend used throughout: **Measured** = a number or observation produced by a run; **Inferred** = my reading of measured data, not verified; **Unknown** = not measured.

## 0. Summary

| Question | Answer (measured unless marked) |
|---|---|
| Can layers be used? | **No.** 95 layers are defined but no path or form references any of them. Switching all layers off or on changes no pixel on any page. |
| Is the text outlined filled glyphs? | **No.** The drawing text is a **monoline CAD font drawn as stroked polylines**. One character is 1 to 3 separate stroked paths. (The ~14,000 filled paths per page are a different thing, see 3.1.) |
| Is the glyph set small and clean? | **Clean, with a moderate number of variants.** Exact point matching looks noisy (3,606 "shapes") but that is rounding noise. With a geometric tolerance fixed in advance: **279 upright groups cover 99.9%** of characters; 30 cover 90%, 50 cover 95%, 133 cover 99%. Several letters appear as 2 or more variants. |
| How much text? | About **4,800 upright text lines, ~5,900 words, ~37,700 characters** over the 6 pages (page 1, the notes sheet, has about half). Only ~3.8% of lines are vertical. |
| Grid bubbles? | **None found.** The framing plans have no lettered grid and no grid lines. The bubbles present are detail-callout bubbles (detail number over sheet number): 20, 22 and 24 on pages 3, 4, 5. |
| Can OCR read it? | **Yes, for upright text on clean crops:** 90% exact on 40 random words, 94% exact on 18 key engineering strings, 81 of 81 table cells correct. Systematic weaknesses: `0` read as `O`, vertical text, `=` and trailing `.` dropped. |
| Can glyph clustering read it? | **Yes, in-sample:** every letter and digit right (58 of 58 strings, ignoring case, spacing and punctuation rules my crude decoder gets wrong) after a one-time labeling of 55 groups. Not yet shown on text whose groups were not labeled (101 of 500 words on page 3 still contain an unlabeled shape). |
| Recommendation to weigh | See section 9. In short: (a) per-layer is dead, (b) is feasible with a measurable but real labeling cost, (c) works well for the horizontal text but conflicts with the current "no OCR / no ML dependency" rule and has known failure modes. A hybrid (vector clusters give the text crops, OCR reads them, glyph labels verify or flag) is plausible but was only measured in pieces. |

## 1. Layers

**Measured.**
- 95 optional-content groups (layers), all on by default, all names distinct and ASCII.
- Name structure (redacted): 55 start with an `XR` prefix (the pattern of flattened external-reference layers), 30 start with a single letter `A`, 2 with `C`, 1 with `S`, 1 `SH`, 1 `0`, and 5 start with something that looks like a firm or project name (`<redacted>`). 56 contain a `|` or `$` separator. Only 9 consist solely of generic structural words (the words seen in them: `ANNO` (3 times), `DIM`, `DIMS`, `TEXT`, `HIDDEN`, `TRELLIS`, `BEAM`, `NEW`, `WALL`, `HATCH`, `PROP`, `GRID`, `VIEWPORT`); the other 86 are `<redacted>` or code-like.
- **No content is linked to any layer.** Zero marked-content layer markers in the page content streams (6 pages, 1.4 to 3.2 MB each) and zero in the 6 form XObjects per page; no form carries an optional-content entry. PyMuPDF reports an empty layer for every path (page 1: 42,851 paths, 0 with a layer). The only other object that mentions optional content is the layer-definition table itself.
- Rendering test: all 95 layers **off** and all 95 **on** both give pixel-identical renders to the default on all 6 pages (24 dpi comparison).

Consequences: which layers hold drawings? **None on any page.** Per-layer path extraction or rendering is impossible on this file. No layer isolates text, grids, beams or columns. The layer names show the original CAD organisation (it had a `GRID`, `BEAM`, `TEXT`, `DIM` style layer vocabulary) but the information did not survive the export.

## 2. Stroke styles

**Measured**, per page, over all vector paths (full table in `fixtures/private/dumps/styles.json`).

| Page | Paths | Stroke styles (width, colour, dash) | Fill colours |
|---|---|---|---|
| 1 | 42,851 | 9 | 2 |
| 2 | 46,736 | 17 | 5 |
| 3 | 22,301 | 15 | 2 |
| 4 | 28,109 | 16 | 4 |
| 5 | 28,892 | 15 | 4 |
| 6 | 24,605 | 11 | 2 |

- **No dash pattern anywhere:** every path is solid. Dashed or dotted lines exist only as many separate short segments (for example 155 to 236 single-segment strokes of 2.2 to 2.3 pt and 0.3 wide on pages 3 and 4, and 234 of 2.8 pt and 0.24 wide on page 5). What those short strokes belong to was **not** identified (Unknown).
- Widths in use: 0.12, 0.24, 0.3, 0.42, 0.54, 0.72, 0.84, 1.14, 1.44, 1.86. Colours: black on every page; light greys (0.60, 0.73, 0.86) on pages 2 to 5 (background lattice/deck-like hatching); a handful of blue paths on pages 1 and 6.
- Style roles. **Verified by looking at the render:** the structural beam line through the member marks is a solid black **1.44-wide** stroke, broken into segments around labels and arrowheads. **Inferred, not verified:** 0.72-wide black long lines are plan edges; 0.3-wide black diagonals (about 15 per plan page) are leader lines; two 409-pt 1.86-wide lines identical on pages 3, 4, 5 belong to the sheet frame or title block; 0.24-wide grey lines are hatching. Each plan page has only 50 to 100 long (60 pt or more) straight segments outside the title block, so line geometry is small compared with text.
- **Grid lines:** no style qualifies. No dashed centre-line style exists and no lettered grid is drawn on the framing plans.
- **Dimension lines:** one example was seen in a crop (a vertical double-headed arrow with solid filled arrowheads). A dimension-line style was **not** isolated statistically (Unknown).

## 3. Outlined glyphs

### 3.1 What the text is made of (measured)
- On page 1, 28,525 of 28,764 dark stroked paths are 14 pt or smaller. They are character strokes: monoline, 0.84 wide for body text, 3 to 8 pt tall (body text cluster height: median 6.7 pt, p10 to p90 6.0 to 7.0 pt).
- The ~14,100 **filled** paths per page are almost entirely tiny (median 1.4 pt; 11,000 have exactly 2 line items, i.e. triangles) and their count is nearly identical on pages 1 and 3 (14,087 vs 14,133), which means they are repeated, page-independent content (title-block graphics). They are not the text. Their exact origin was not dissected (Unknown).
- The brief's "small closed filled paths that look like letters" therefore does not apply to the body text; the same analysis was done on stroked paths instead.

### 3.2 Character clusters (measured)
Touching stroked paths (bounding boxes within 0.2 pt) were merged into character clusters: **37,753 clusters** (p1 18,467; p2 2,750; p3 3,604; p4 3,650; p5 3,097; p6 6,185). Paths per cluster: 1 path about 60%, 2 about 25%, 3 about 13%, 4 or more under 1%.

### 3.3 Distinct shapes: three measurements that disagree on purpose
| Method | Result | Reading |
|---|---|---|
| Exact signature (translation, scale and 90-degree rotation normalised, coordinates rounded to 1/50) | 3,606 shapes; top 100 cover 67%; 1,954 shapes occur once | **Not a valid measure of cleanliness.** Rounding noise splits one glyph into many. |
| 32x32 raster, leader grouping at fixed thresholds 0.7 / 0.8 / 0.9 | 123 / 249 / 392 groups | **Impure:** at 0.8, groups visibly mix different letters (N with R, D with B, P with R and F, C with G, G with O). Group counts from this method understate the labeling effort. |
| Direct stroke-geometry distance (symmetric mean Chamfer <= 3% and Hausdorff <= 10% of glyph size, upright text only, tolerances fixed before running) | **279 groups** over 27,235 clusters in text lines; 30 / 50 / 133 / 252 groups cover 90 / 95 / 99 / 99.9%; 87 groups occur once | Groups looked pure on inspection (8 members each for 55 groups). This is the number to use. |

The most common upright groups have 2,912, 2,081, 2,011, 1,810, 1,776 instances. Letters appear as variants: for example two `S`, two `G`, two `C` and two `1` groups exist because the same letter is polygonised differently (arc approximation), and a narrow-oval `0` is a different group from the octagon-like `O`. Tiny clusters (under 1.5 pt: dots, ticks) fall into several unrelated groups and must be handled by size, not by shape.

Verdict: the glyph set is **small and clean in the sense that matters** (a CAD font with repeating geometry), but it comes with roughly 280 groups once variants are counted, not 40.

### 3.4 Text lines per page (measured; an estimate from clustering rules, not a ground truth)
| Page | Clusters | Upright lines | Vertical lines | Words (approx.) |
|---|---|---|---|---|
| 1 | 18,467 | 2,429 | 44 | 2,928 |
| 2 | 2,750 | 175 | 8 | 217 |
| 3 | 3,604 | 426 | 31 | 568 |
| 4 | 3,650 | 409 | 18 | 533 |
| 5 | 3,097 | 432 | 14 | 547 |
| 6 | 6,185 | 751 | 66 | 1,095 |
| All | 37,753 | 4,622 | 181 | ~5,888 |

(Median line length: 4 to 6 characters, because wide word spacing splits sentences into short groups.) About 3.8% of lines are vertical (for example member labels running along a beam).

## 4. Grid bubbles (measured)

Circles were found by fitting a circle to the sampled outlines (curves are two Bezier arcs plus tiny line pieces; fit error under 2% of the radius, at least 330 degrees of arc).

| Page | Circles | With glyph clusters inside | With a straight segment of 40 pt or more ending on the circle |
|---|---|---|---|
| 1 | 0 | 0 | 0 |
| 2 | 18 (radius 4 to 7 pt, plus one at 27) | 4 | 0 |
| 3 | 20 (18 at radius 12 pt) | 20 | 10 |
| 4 | 22 (20 at 12 pt) | 22 | 11 |
| 5 | 24 (23 at 12 pt) | 24 | 15 |
| 6 | 0 | 0 | 0 |

The radius-12 circles are **detail-callout bubbles** (a detail number above a horizontal bar and a sheet reference below, e.g. `19` over `S4.1`), each with a leader line. **No lettered grid bubbles and no grid lines exist on these framing plans** (checked on the renders of pages 3 and 4). A grid-based member location scheme (SPEC section 5) therefore cannot rely on a grid here; members are identified by marks (`B1`, `B2`, `B1 CONT`, vertical `... CANT'L`) and a beam legend (`B1: HSS6x4x1/4`, `B2: HSS6x4x3/8 FLAT`).

## 5. Crops (private, for you to view)
In `fixtures/private/crops/`: `overview_p1.png` to `overview_p6.png` (30 dpi), `crop1_callout_bubble.png`, `crop2_beam_legend.png`, `crop2b_beam_labels_plan.png`, `crop3_title_block.png`, `crop4_schedule_table.png`, `crop5_notes_text.png`. The grid-bubble crop shows a callout bubble because no grid bubble exists. Also `glyph_groups_top96.png` (the 96 largest raster groups), `geo_members_1.png` / `geo_members_2.png` (members of each geometric group used in the experiment), and `contact_A1/A2/B.png` (the 58 test strings).

## 6. OCR experiment (private only; not in the pipeline)

**Tool:** Tesseract is not installed and I did not install system packages (no sudo). I used `rapidocr-onnxruntime` 1.4.4 (PaddleOCR models as ONNX, CPU) installed with pip into a scratch virtual environment outside the repository. **This is a different engine from Tesseract, so these numbers say nothing about Tesseract.**

**Method.** Two test sets on page 3, same crops (400 dpi, 1 pt padding, white margin) given to both routes:
- Set A: 40 randomly chosen upright words/lines (seeded, fixed before looking) from the notes and plan text.
- Set B: the 19 key engineering strings (beam legend, member marks, callout, plan title and scale), 18 scored (one fragment excluded).
Ground truth is **my own reading of the crops** (contact sheets), so it is small and could contain my errors.

**Results (measured).**
| Route | Set A exact | Set B exact | Ignoring case, spaces, quotes and dots |
|---|---|---|---|
| OCR | 36 / 40 (90%) | 17 / 18 (94%) | 39 / 40 and 17 / 18 |
| Glyph decode (section 7) | 35 / 40 (88%) | 14 / 18 (78%) | 40 / 40 and 18 / 18 |

- OCR errors: a trailing `.` dropped 3 times and the `=` of `= 1'-0` dropped twice. (The crops clip trailing dots, so part of this is my crop rule.)
- **Dense table:** all 81 cells of a numeric table (size labels and values) read correctly and in order, plus all 9 headers.
- **Systematic confusion `0` vs `O`:** in the notes, `S001` came out as `SOO1`, grade `40` / `60` as `4O` / `6O`, and `0.7` as `O.7` (4 instances in the text I could check).
- **Vertical text:** `LATTICE` was read as `ZATTICE`; other vertical labels were fragmented. Not tested with rotation to upright first.
- Revision clouds touching text: `B1:` became `B1:I`.
- **Whole sheet (page 3, 300 dpi, tiled into 42 tiles of 1,800 px):** 30 s on this CPU, 312 boxes, 670 words. Without tiling the engine downscales the page and cannot read the text. No ground truth exists for the full sheet, so accuracy there is **Unknown**.

## 7. Glyph-cluster decoding experiment (private only)

**One-time manual labeling.** I labeled the geometric groups used by the 58 strings, by eye, from pictures: **55 groups** (letters, digits, `/`, `\`, `%`, `_`/`-`; 3 shapes I could not name, left `?`). Fixed decoding rules written before scoring: dots are clusters under 1.5 pt; lowercase when a letter is under 80% of the line's tallest character; two stacked bars are `=`; a long bar is an underline; spaces by gap size.

**Results (measured).** Exact: 88% (A) and 78% (B), see the table above. The exact-match misses are rule artifacts of my crude decoder, not shape confusions: lowercasing keyed on the tallest character (`HSS6x4x1/4` printed as `hss6x4x1/4`, `BUILDING` as `buIldInG`), a spurious space in `19`, a missing apostrophe in `1'-0`, and the same clipped trailing dots as OCR. Letter and digit identity: 58 of 58 strings right.

**Important caveats.**
- The experiment is **in-sample for labeling**: I labeled exactly the groups these strings use. It shows the groups are separable and readable, not how much text is covered by the labels I made.
- On the whole of page 3, using the same 55 labels, 101 of 500 decoded words still contain an unlabeled shape (`?`). For example both zeros of `S001` and the `O` of `NOTES` on another page fell into groups I had not labeled. This is a safer failure than OCR's silent `O` for `0` (the decoder says "unknown shape"), but it means each variant needs its own label.
- Whole-page cross-check with OCR on key tokens is **not adjudicated**: `B1` 3 (glyph) vs 6 (OCR), `B2` 5 vs 7, `TYP` 17 vs 13, `S4.1` 19 vs 16, `CONT` 2 vs 2, `HSS6x4x1/4`, `HSS6x4x3/8`, `FLAT`, `BEAM` 1 vs 1 each. A plausible explanation (**unverified**) is that OCR also reads some vertical labels that my upright-only decoder skips.
- Vertical text decoding was **not tested** (it needs the 90-degree rotation handled).
- **A bug of mine, found and fixed during the work:** my first decode run collected clusters from all six pages that fall in the same coordinates (pages 3, 5, 6 repeat text at the same positions), which made it look like 65% / 61%. After restricting to the page the crops came from, the numbers above resulted. Rules and labels were not changed between the two runs.

## 8. What the experiments depend on (be aware)
Ground truth is mine and small; the crops come from the vector line grouping, so segmentation was free for both routes; the page-3 whole-sheet numbers have no truth; only one drawing set was examined, so whether other drawings use the same font and polygonisation is Unknown.

## 9. Feasibility assessment

### (a) Per-layer extraction: not feasible (measured)
The layers are empty definitions. Nothing can be isolated by layer on this file or, given how the export lost the association, on other exports of the same kind.

### (b) Glyph clustering with a one-time labeling step: feasible, with a real and measurable cost
Measured in favour: a clean monoline font; 279 groups cover 99.9% of upright characters and 133 cover 99%; groups are pure at the stated tolerance; every letter and digit in the 58 test strings decoded correctly; unknown shapes are reported as `?` instead of guessed; it is deterministic, fast (all 426 upright lines of a page in 0.6 s) and has no ML dependency.
Costs and risks: about 280 groups to label for full coverage (more for another drawing set or another CAD font, which was not examined); variants of the same glyph multiply the labels; dots, quotes, parentheses, `#` and similar need rules or labels; vertical text needs rotation handling that was not tested; the line, word and `=` rules need real design (the simple rules above got case, spacing and apostrophes wrong). Unknown: accuracy on text whose groups are unlabeled, rotated text, other drawing sets, behaviour when text touches graphics (a revision cloud or leader through text merged clusters in places; not quantified).

### (c) Rendering plus OCR: works well for upright text, with known failure modes and a policy conflict
Measured in favour: 90 to 94% exact and about 98% on letters and digits for clean crops; a 81-of-81 numeric table; no labeling work.
Measured against: `0`/`O` confusion in context; dropped `=` and trailing dots; vertical text misread; neighbouring graphics hurt (`B1:I`); whole sheets need tiling (30 s per sheet here). Unknown: accuracy on whole sheets without vector-derived crops; effect of different engines; GPU/CPU cost at scale. **Policy:** SPEC section 4 says "No OCR in v0" and the Phase 0 rules exclude ML dependencies. The engine tested is an ML model; using it, even for a private tool, needs an explicit decision.

### Combination worth considering (not built, only pieces measured)
Vector clustering supplies the text crops and line structure (this made OCR perform well), glyph labels give an independent, deterministic read, and disagreement or `?` flags a string for review. The pieces were measured separately; the combination was not.

## 10. Decisions needed from you
1. Is OCR (an ML model) acceptable at all, even only as a private helper, given SPEC section 4? If not, (b) is the only route.
2. If (b): is a one-time labeling of roughly 280 groups per CAD font acceptable, and are you willing to label (or review) them? A way to cut the effort (proposing labels by running OCR on a group's members and asking you to confirm) is plausible but untested.
3. The beam legend, member marks and callouts are few and short on these sheets. Do you want the first extraction target to be exactly those strings (marks, legend, scale text, sheet number) rather than all text?
4. Do other drawing sets from this firm, or other firms, exist for us to measure how stable the font and group set are?

## 11. Reproducing the measurements locally
Private only. Scripts are in `fixtures/private/inspect/` (`02_styles.py`, `03a` to `03e`, `04_bubbles.py`, `05a` to `05e`, `06_ocr.py`, `07_page_ocr.py`) with a scratch virtual environment holding PyMuPDF, numpy, Pillow and the OCR package. Dumps are in `fixtures/private/dumps/`, crops in `fixtures/private/crops/`. None of it is committed.
