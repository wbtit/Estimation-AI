# Phase 5t results: takeoff intake study (read-only)

Branch `phase-5t` (from `phase-5c`), local only. Baseline before any change: lint clean; API 419, worker 458, web 14 tests. After: lint clean; API 419, worker 463 (5 new synthetic tests of the study tools), web 14. The measures and tolerances were fixed in `docs/PHASE5T_PREREGISTRATION.md` BEFORE any takeoff file was opened, and were not changed. Tools: `worker/tools/takeoff/` (read-only, deterministic, no network except the local API for a few confirmed scales). No page image of a takeoff file was viewed. No product behavior, the frozen rule or any threshold was changed. Counts and tables only: no comment text, subject strings, author names, layer names or file names appear here.

## 1. Intake
- **22 items** copied (never moved or changed) to the git-ignored `fixtures/private/takeoffs/` and made read-only: **21 PDFs and 1 spreadsheet**, 560 MB; the zip in Downloads holds the same 21 files and was not copied again. The two original input folders, the duplicates folder and the csv were left out, as was an unrelated personal PDF.
- **PDFs:** 750 pages in all (6 to 67 pages each). 20 of the 21 carry markups; 1 (6 pages, no text layer) carries none.
- **Spreadsheet (structure only, no value read):** 1 workbook, 6 sheets of 8 to 1,183 rows and 6 to 26 columns; header words are generic (bill of material, steel estimator, cost estimate and total, plate list, misc steel, material, size, description, lbs/ft). It was called a pricing-like estimate workbook here; that was wrong: it is the **estimator's finished takeoff** (corrected in Phase 5u, see `docs/PHASE5U_RESULTS.md`). Its values were not read in Phase 5t. It cannot be tied to a job by a content fingerprint.
- **Match to our drawing documents** (content fingerprints: per-page hash of the sorted words of the text layer with the markups removed, then a 0.9 word-set similarity; no file names): **16 of our 19 unique documents have a takeoff PDF**: job-002, 003, 004, 005, 006, 008, 010, 011, 012, 013, 014, 015, 017, 018, 019, 020. **No takeoff:** job-001, job-009, job-016. **5 takeoff PDFs match no job** (1 has no text layer; 4 have text but match fewer than 3 pages of any document). A takeoff is the full drawing set with the markups drawn on it: it holds 25 to 67 pages and **our document is a subset of it** (the matched pages are 7 to 37 per job; job-004's 18 pages and job-012's 27 of 30 are complete). The file-to-job map exists only in the private folder.

## 2. Structure of the markups (21 PDFs, 750 pages)
**24,229 markups.** Median 1,191 per file; at most 2,264 in a file and 1,282 on one page.

| subtype | markups | share |
|---|---|---|
| Polygon | 7,851 | 32.4% |
| Square | 6,757 | 27.9% |
| FreeText | 6,506 | 26.9% |
| Line | 1,790 | 7.4% |
| Ink | 598 | 2.5% |
| Highlight | 597 | 2.5% |
| Circle | 119 | 0.5% |
| Stamp / PolyLine | 7 / 4 | 0.0% |

Fields (share of the subtype): subject, colour and creation date are filled on 100% of Polygon, FreeText, Line, Ink, Highlight and Circle markups; on Squares 42% (58% are bare rectangles with no subject, colour, date or appearance). Contents is filled on 99% of FreeText, 92% of Highlight, 56% of Squares, 16% of Polygons, 14% of Lines. A layer reference exists on 1% of Polygon and FreeText markups, in 9 of 21 files. **Measurement dictionary** (the PDF `/Measure` entry): 257 markups, all Lines or PolyLines (14% of Lines), in 10 of 21 files; its scale text and number format give the scale and unit. A **stored measured value** is the dimension text in the contents of those markups. **Custom columns** (Bluebeam column data) exist on 55% of Polygons and 64% of FreeText markups, in 20 of 21 files; in the one file whose columns I inspected the 15 slots were all empty except two numeric slots with one constant value, so they look like a quantity of 1 per symbol (not verified on the other files).

**How a count differs from a length in the data.**
- A **count** is a small closed **Polygon symbol (3 or 8 vertices)** with a **FreeText tag** next to it (95% of the tags are short mark-like codes) and custom column data; no measurement dictionary. 4,373 such symbols lie on the matched pages.
- A **length** is a **Line (2 vertices)** with a measurement dictionary and a dimension text in its contents. PolyLines (4) are almost never used. Of 1,790 Lines only 14% are measurements.
- **Profile text** (a W, HSS or similar designation parsed from subject or contents) is on **0% of Lines, Polygons, FreeText tags (0.1%), Ink and Circles; 3.0% of Squares (201) and 36% of Highlights (217)**: 425 of 24,229 markups (1.8%). A Highlight carries the highlighted text and its quad position, so it marks a LABEL on the drawing; no markup that has a length carries a profile.
- **Units and scale:** the 138 measured length markups on the matched pages have a scale; the ratios take 9 distinct values from about 1:9 to 1:192 (the most common are 1:32, 1:64, 1:48 and 1:96). For the 98 of them on a page where we read a single scale, 97 agree with it within 2%.

## 3. Geometry study (pre-registered M1 to M6; primary tolerance 6 pt, sensitivity 3 and 12 pt)
Population (as fixed in advance): every Line or PolyLine markup of at least 3 pt on a page we can map: **1,218 length markups in 16 jobs**. Structural classes: the study's confirmed classes on 4 pages, the rule's suggestion on 12 pages (the others did not exist in the study). **Only 138 of the 1,218 have a measurement dictionary** (the rest are leaders, arrows and page-wide lines: median length 80 pt, 59 are at least 1,000 pt); the tables show the pre-registered population and, next to it, that subset as a split (not a replacement).

| | 3 pt | **6 pt** | 12 pt |
|---|---|---|---|
| **M1** coverage, all 1,218 | 20 (1.6%) | **45 (3.7%)** | 73 (6.0%) |
| M1, the 138 with a measurement | 20 (14%) | **40 (29%)** | 49 (36%) |
| M1, the 1,080 without | 0 | 5 | 24 |

The 45 matches are in 3 jobs (job-012: 4, job-018: 25, job-019: 16); no match in the other 13 jobs.

**M3 (markups per drawn line), the direct human answer to the shared-line question:** at 6 pt the 39 lines that have a matched markup have **1 markup: 35 lines; 2: 2; 3: 2**; at 12 pt: 54, 8 and 1. So where an estimator measured a drawn line, it was almost always one measurement per line. This does not settle the shared-line question: only 45 markups are on a line at all.
**M2 (part of line), 6 pt:** below 0.25: 7; 0.25 to 0.75: 6; 0.75 to 1.25 (the whole line): **32**; above 1.25: 0 (the 138-subset: 3 / 5 / 32 / 0). At 3 pt all 20 are whole lines; at 12 pt: 15 / 16 / 40 / 2.
**M4 and M6: not possible as specified.** 0 of the 1,218 length markups carry a profile in subject or contents, so there is no markup-with-profile to pair with a label and no human-gold label-to-line score for the frozen rule can be computed from length markups. Nothing is claimed about the rule against a human gold (AI-gold figures are in `docs/PHASE5B_RESULTS.md`, unchanged).
**M5 (length agreement):** (a) stored value against the geometry of the markup's own scale: 40 markups, **all 40 within 2%** (the stored value is the markup's own measurement, so this is a consistency check). (b) markup length against the length our system gives for the matched line at the page scale: 31 pairs, **8 within 2%, 8 more within 5% (16 in all), 6 more within 10% (22 in all), 9 beyond**. Whether our length is trusted could not be split: the 3 matched jobs have no members in our system (the production shared-line flag exists only for the study documents), so the trusted/untrusted comparison is **not possible** here.
**Unmatched markups (1,173 at 6 pt):** not on any structural line **1,169**; off-sheet 3; scale mismatch 1; raster underlay 0; other 0. Of the 138 measured markups, 98 are unmatched (97 not on a structural line, 1 scale mismatch); **70 of the 98 (and 111 of all 1,173) lie on a line of another stroke class**. Exploratory (not pre-registered): of the 138 measured markups, 87 lie on a line of a class other than the suggested one, 23 on the suggested class, 28 on no line of any class at 6 pt; the lines they lie on are mostly thin or medium (0.25 to 1 pt: 88, 0.1 to 0.25 pt: 13) and only 9 are 1 pt or heavier. Most measurements are not on the heavy lines our suggestion picks.

## 4. Exploratory (post-hoc, NOT pre-registered): the count symbols
The files are mostly count takeoffs, so I also looked at where the 4,373 count symbols (polygons with 3 or 8 vertices) sit against our structural lines (the same page classes): within 6 pt of a line **837 (19%)**, within 12 pt **1,431 (33%)**, within 25 pt 2,168 (50%), farther than 60 pt 1,466 (34%), no structural line on the page 163. On the 1,280 lines that have a symbol within 12 pt: **1 symbol on 1,172 lines (92%), 2 on 92, 3 on 9, 4 or more on 7**. This is weak evidence against "several counted members on one drawn line" (in these documents the estimators put one symbol per line almost everywhere), but a third of the symbols are not near any structural line, so the symbols are not a reliable position of the member line.

## 5. The 28 shared lines of job-005
27 of the 28 are on **page 29** and 1 on page 14 (both framing plans by the page type guess; the guess has no stair, isometric or section class, so the hypothesis "they cluster on stair, isometric or section sheets" cannot be tested by page type; by count, one page holds 27 of 28). **The takeoff has no evidence for them: page 29 carries 2 markups in all (one tag, one line), none within 12 pt of a shared line, and page 14 is not in the takeoff file.** M3 for these lines is therefore not possible.

## 6. What did not work or could not be read
- M4 and M6 could not be computed (no profile on any length markup); the human-gold score of the frozen rule is not available from this data.
- M5(b) could not be split by trust.
- 5 takeoff PDFs match no document of ours; the spreadsheet cannot be tied to a job and was not read beyond its structure.
- The structural class is the rule's suggestion on 12 of 16 mapped pages, and 70 of 98 unmeasured-by-structure measured markups lie on another class: the low M1 is partly a class problem, not only a "markups are elsewhere" problem. I did not re-run with other classes (that would be choosing after seeing results).
- I could not view page images (not approved), so I do not know what the long page-wide Lines or the squares are; the interpretations above (leaders, tags, count symbols) come from counts of geometry and field presence only.
