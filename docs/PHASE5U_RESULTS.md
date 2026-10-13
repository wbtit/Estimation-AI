# Phase 5u results: V1 to V4 (definitions in `docs/PHASE5U_PREREGISTRATION.md`, committed before any image or CSV value was viewed)

Counts and descriptions only. No drawing text, comment text, tag text, names or numbers from the drawings appear here. Images and derived JSON are in the git-ignored `fixtures/private/takeoffs/`. Tools: `worker/tools/takeoff/colour_study.py` and `tag_study.py`, with synthetic tests (worker tests now 465).

## Status of the four parts
| Part | Status |
|---|---|
| V1a colour counts | done, all 21 takeoff PDFs |
| V1b images | done for job-018 (6 pages). NOT done for the job the estimator CSV belongs to: **no estimator CSV file was found on this machine** (see below) |
| V2 | done from the 6 job-018 pages plus tag counts on all 200 pages with count symbols; the second job is missing for the same reason |
| V3 | **not possible**: it needs the CSV rows |
| V4 | done: `docs/V1_UI_SPEC.md` (text only, nothing built) |

**The CSV problem (superseded by the W sections below: the file is a workbook, found afterwards).** I searched the home folder (csv, xls, xlsx) for a file with the Reference Dwg No. column and found none; the only csv files outside the repository are our own inventory map (job list, not an estimator file) and a 118-byte file. I copied the wrong file once (our own inventory map), saw its contents (it holds real file names, which I did not repeat), and deleted the copy. The pricing-like workbook was NOT read for values. Please put the estimator CSV files in Downloads (or tell me the path); V3 and the second half of V1b then run with the seed already fixed (5021).

## V1a. Colour by subtype and by tag (all 21 takeoff PDFs, 24,229 markups)
- Colours are used as plain RGB; the same 6 pure colours (red, green, yellow, blue, cyan, magenta) appear in 19 or 20 of the 20 marked-up files; 8 to 16 files add a purple, orange, brown or dark blue.
- **Polygons (count symbols, 7,851):** 26 distinct stroke colours; the largest groups are magenta 3,034, blue 1,467, red 1,067, green 497, purple 476, orange 424, dark blue 182, cyan 163. Fill is none on 4,358 polygons; the rest carry a fill.
- **Squares (6,757):** 3,818 have no stroke colour (they are filled boxes); the 1,738 yellow-stroke squares with yellow fill are highlights of notes and view titles, not counts.
- **Lines (1,790):** the measured ones (with a measurement dictionary, 257 in all files) are mainly blue (158) and red (90). The green (664, median 75 pt long), cyan (321, 56 pt) and part of the red lines carry no measurement and are short strokes beside count symbols.
- **FreeText (6,506):** no stroke colour; 6,289 (96.7%) have a short tag of letters plus digits, 133 are long notes, 51 other, 24 digits only, 8 letters only. Polygons have no text of their own; their tag is the FreeText next to them.
- Tag to symbol: for 6,285 count symbols (Polygon with 3 or 8 vertices), 6,194 (98.6%) have a FreeText within 40 pt (the nearest is taken as the tag).

## V1b. Six job-018 pages (chosen by the most count symbols: 48, 48, 40, 40, 38, 36; every symbol has a tag and every tag on a page is distinct)
| Page (order of selection) | Count symbols | What the page is, as I read the image | Symbols by shape and colour |
|---|---|---|---|
| 1 | 48 | a roof framing plan, two views | 48 circles, one colour (magenta) |
| 2 | 48 | stair plan, stair sections and details | 20 circles (magenta), 20 small triangles (dark blue), 8 triangles (blue) |
| 3 | 40 | a foundation plan with columns | 29 triangles (blue), 11 triangles (maroon) at the edges |
| 4 | 40 | a long section of a framed bay | 30 circles (dark red), 10 triangles in 3 colours |
| 5 | 38 | a roof framing plan | 38 circles (magenta) |
| 6 | 36 | a roof framing plan | 36 circles (magenta) |
- **What is counted:** beams on all four framing/section pages (circles, 152 symbols); columns on the foundation plan and the stair views (blue triangles); braces and stair members on the section and stair pages (the smaller triangles and the green flag-shaped symbols); base or pile-cap-like items on the foundation plan (maroon triangles); no joists are marked even where a joist is drawn (the joist lines are not counted); footings: none counted as steel.
- **Symbol and tag:** a small circle (8 vertices) or triangle (3 vertices) about 12 to 20 pt wide, with a short tag beside it made of a letter prefix and a running number; the tags run 1, 2, 3 ... per prefix with no repeats on the page.
- **Other markings on the pages:** a short green stroke from each beam symbol toward the beam (no measurement); full-length green or blue lines along beams or dimensions (the measured ones are blue); pale coloured rectangles over areas on the foundation plan (zones); yellow boxes behind view titles and notes; a few text boxes (notes).
- **Does colour mean a member type or a status?** Member type, with the shape. Over all 200 pages with count symbols, 96.5% of symbols sit in the dominant colour-and-shape of their tag prefix, and 92.0% sit in the dominant prefix of their colour-and-shape (177 of 187 prefix groups use one colour and shape only). In the six pages the same prefix has the same colour and shape; two circle colours on one page have two different prefixes. No page shows one member kind in several colours that would suggest "done / not done". So colour is NOT a status in these files. It may also encode a size or role inside a kind; I cannot say from counts.

## V2. How a mark appears on the drawing
- **Tag once per piece or once per type?** Once per piece. On 193 of 200 pages with count symbols every tag is distinct; over all of them 6,194 tagged symbols have 5,923 distinct tags (summed per page), the difference coming from the 7 pages with repeats. The numbering is sequential. The estimators do NOT collapse a repeated member into one symbol with "TYP".
- **How the drawing shows a repeated member:** on the framing plans each beam is drawn as its own line, each with its own size label (the label is printed once per drawn beam line, not once per type); a TYP wording appears on the stair plan and section callouts (one of the six pages) and on connection details; on one section page a note tells the estimator to take double quantity per the model for a mirrored member that is drawn once (one of the six pages). No page of the six uses a schedule quantity to show repeats.
- **M2 context:** 32 of the 45 matched length markups cover 0.75 to 1.25 of one drawn line, so a measurement mostly belongs to one line, which agrees with a piece being one drawn line.
- **For the product:** a piece per line, tagged individually, is what the estimators draw, so the symbol-per-piece design of the target screen matches their habit. A TYP or double-quantity note must produce explicit extra pieces (or an extra-quantity flag), because the drawing itself draws the member once.

## V3. Source of the CSV values
Not possible: no estimator CSV found (see above). The sample draw is fixed (seed 5021, `random.Random(5021).sample(range(n), 15)` over the MAIN-steel rows in file order) and will be run when the file is provided. The open question "where does Length come from" stays open; the only evidence now is indirect: where the estimators measured a length it is a blue or red line with a measurement dictionary (257 in the files), the numbers agree with the markup's own geometry within 2% (40 of 40), and none of those carry a profile.

## V4. Target screen
`docs/V1_UI_SPEC.md`: the page view, the explanation panel (evidence list with jump links), the page and overall tables with the CSV columns, how corrections update both, and the proposal to replace blocking gates by flags ("draft, N sheets unconfirmed"). Nothing built.

## What did not work or is uncertain
- The member kinds on the six pages are my reading of the images (shape, colour, position); no tag text was used or recorded. The two non-beam symbol kinds on the foundation plan (maroon triangles, pale zones) are not identified.
- Only one of the two requested jobs could be studied.
- A per-prefix reading of colour "meaning" rests on the tag prefix letters being a kind code; that is an assumption the estimator should confirm.
- The 40 pt rule for pairing a tag to a symbol missed 91 symbols (1.4%).


---

# Addition: W1 to W3 (pre-registered in `docs/PHASE5U_PREREGISTRATION.md`, commit 738ca3c, before any workbook value was read)

Scope kept: the cost, price and rate sheets, the plate sheet and the misc sheet were not opened. Only the first 25 rows of two sheets were scanned in memory for the header words (booleans only; one of them turned out to be the main-steel sheet, the other is a 1,183-row list that has none of the registered headers and was not used). For the main-steel sheet only the cells of the ten registered columns were read. No string from the workbook is written anywhere except generic codes (shape family, grade). Tools: `target_workbook.py`, `target_tie.py`, `target_tie_posthoc.py`, `v3_trace.py`, `m7_study.py` in `worker/tools/takeoff/`; derived data in `fixtures/private/target/` and `fixtures/private/takeoffs/` (git-ignored).

## M7 first: does Quantity equal the number of size labels on a page? No.
Pages: 180 pages of the 16 matched jobs have count symbols; 177 have a text layer; 77 of those have no circle symbols and are outside the bands; **100 pages have circles**. Circles are beams only on the job-018 pages I viewed; elsewhere they are only circle symbols.

| Difference of label count to circle count | equal | up to 10% | up to 25% | up to 50% | beyond 50% |
|---|---|---|---|---|---|
| all profile labels (n_lbl), 100 pages | 9 | 7 | 11 | 12 | **61** |
| W family labels only (n_lbl_W), 100 pages | 17 | 6 | 9 | 12 | **56** |
| viewed job-018 pages, all labels (5 pages; the sixth has no circles) | 0 | 1 | 1 | 2 | 1 |
| viewed job-018 pages, W labels | 0 | 1 | 0 | 0 | 4 |

- Pooled over the 100 pages there are 2,498 circles, 3,617 labels and 1,694 W labels. Labels are more than circles overall, because plans also label columns, braces, details and legends, and fewer where one label serves several beams.
- The one clean case among the viewed pages is a roof framing plan with 36 circles and 35 W labels. Another framing plan has 38 circles and 56 labels, none of them W (labels that are not W-family beams are counted too; I did not look at what they label). The stair page has 20 circles and 34 labels.
- Per job the picture is the same (the largest groups of pages are beyond 50%); job-019 has 5 of 9 pages exactly equal, job-005 has 4 of 8 equal for W labels. Per-job lines are in the tool output; I chose nothing from them.
- **Answer:** a count of size labels on the page is not the Quantity. A label gives a size for a member; the number of pieces needs the symbols (or the drawn lines), one per piece.

## W1. The target workbook
- **What it is:** the estimator's finished takeoff (it is NOT a price list). It has 6 sheets; the main-steel sheet is the first one (header row at row 9, 128 rows below it). All ten registered header words are present.
- **Tie to a job: job-018.** By the registered rule (a reference is found when it equals a whole text line of the document) the result is "no match" for every document: the best is job-018 with 2 of 27 distinct references found, then job-005 and job-010 with 1; job-001 has 0 of 27 and none of the sheet numbers listed for job-001 in the docs. The reason is that the references are written as detail number plus sheet number, so they never equal a whole line. **Post-hoc (not registered):** 24 of 27 references end with a sheet-number-like line of job-018's drawings (89%, on 18 pages), against 15 for job-005 (short lines give chance hits), 8 for job-011 and 4 or fewer for the rest. I also saw the same project words in the workbook's file name (in a directory listing) and in the title block of job-018's pages. I conclude it is the job-018 project's finished takeoff. The job-001 text is outlined, so job-001 is NOT the target and nothing here changes the glyph-reader question.
- **There IS a marked-up PDF for this project:** the takeoff PDF that matched job-018 in Phase 5t (38 pages, 1,417 markups, 23 pages matched to our document). The owner's note said there was none; this is the one. Together they give an end-to-end gold: the workbook (what the estimator finally delivered) and the markup that produced it.
- **Folder:** 20 PDFs and 1 workbook; the PDFs are the marked-up takeoff PDFs already inventoried; no separate unmarked drawing set.
- **Rows:** 104 rows have a Quantity: 96 before the total row (the MAIN steel, 463 pieces), 1 total row (the grade cell says total tonnage), and 7 in a misc block without SHAPE (stairs and rails). 10 label rows: one at the head of each of 8 blocks, one before the misc block, 1 other. No row is labelled beams, columns, braces or joists as a section; there are no joist rows.
- **Grouping:** one row is a group: one drawing reference, one size, one name, one length, with the pieces in Quantity. Unique shares among the 104 rows: Reference 27 distinct (26.9%), Size 26 distinct (25%), Name 40 distinct (38.5%), Name+Size 54.8%. Up to 14 rows share one reference. So it is not one row per size, per name or per mark: the same size appears on several references and with several lengths.
- **SHAPE (96 main rows):** HSS 74 (77%), WF 18 (19%), C 3, PL 1 (a plate inside the main block); the 8 rows without SHAPE are the misc block and the total row.
- **Name:** all 102 non-empty names are descriptive text of 1 to 5 words (member kind and role); none looks like a mark or tag, none like a profile. By my keyword classes: beam 50 rows, column 15, brace 13, stair 4, rail 3, girt 1, none of these words 18 (of 104).
- **Quantity bands (104 rows):** 1: 17 rows; 2 to 4: 51; 5 to 9: 27; 10 to 24: 6; 25 or more: 3.
- **Length bands, ft + in/12 (96 main rows have lengths):** under 5 ft 10; 5 to under 10: 17; 10 to under 20: 38; 20 to under 40: 27; 40 or more: 4. Every main row has a length; the 8 without a length are the misc and total rows.
- **Unit W present on 96 of 104 rows (92.3%).** It is the estimator's own number and is not a catalog. **Total W = Quantity x length x Unit W within 1% on 96 of 96 checkable rows (100%)**; 8 rows are not checkable.
- **Grades (codes):** A500 on 74 rows (the HSS), A992 on 18 (the WF), A36 on 6, A53 Gr.B on 4, 1 empty (plus the total-tonnage cell).
- **Post-hoc, not registered, and a coincidence is possible:** the workbook has 195 pieces on rows whose name says beam, and the job-018 takeoff PDF has 194 circle symbols; the PDF has 194 triangles, 166 six-vertex polygons and 42 twenty-four-vertex polygons, against 69 column pieces and 43 brace pieces in the workbook (name keywords). I did not compare page by page.

## W2. V3: where Size and Length come from (15 rows, seed 5021 over the 96 main rows in file order; sample positions 0, 5, 14, 25, 27, 29, 37, 42, 44, 50, 65, 70, 74, 78, 88)
**Method limit:** this trace is by the text layer of the drawing (plus the takeoff markups' text). I did not view new images for it; the page images I viewed earlier are only the six takeoff pages of job-018. The reference of each row was mapped to the pages by the sheet-number-like suffix rule; the index page is among the mapped pages for every row.
| Source type | Size | Length |
|---|---|---|
| schedule (a table row / a schedule column) | 0 found in text | 0 found in text |
| plan label (size) / dimension on the referenced sheet (length) | **14** | **1** |
| same value only on another sheet | 1 | 5 (weak: a plan has 20 to 50 dimensions, chance hits are likely) |
| text of a takeoff markup only | - | 2 |
| none found | 0 | **7** |
- **Size:** 14 of 15 sampled sizes are printed as a plan label on the referenced sheet; none was found in a schedule. This agrees with the finding that beams carry their size label on the plan.
- **Length:** printed once as a dimension on its sheet (1 of 15). For the other rows, the distance to the nearest printed dimension on the referenced sheets was within 3.5 in for 7 rows, within 7 in for 9 rows and above 12 in for 6 rows (post-hoc). So most lengths are NOT printed; they are near a printed dimension (a bay, a grid distance) or measured, and the note on one page about a model suggests some come from the estimator's model. I cannot say which. **Open: how the estimator gets the length** (question 77).

## Answers to open questions 71 to 75
71. The file is the workbook above (an XLSX, not a CSV): the finished takeoff of job-018. Answered.
72. The owner states that colour and shape follow the member kind; recorded as the owner's answer (the study agrees: 96.5% of symbols). What the prefix letters stand for is still unknown, now less important because the workbook gives the Names.
73. Answered by the owner: a TYP or double-quantity note produces an amber FLAG, not generated pieces.
74. Answered: flags instead of blocking gates are approved, with red kept out of the main total on its own line and the draft label in every export header and file name.
75. The owner says joists are not counted; they are listed as "not counted" (owner to confirm). The workbook has no joist rows, which agrees.

## What did not work or is uncertain
- The registered tie rule gave "no match"; the workbook's references are detail plus sheet and need the looser post-hoc rule, which I did not register.
- V3 was traced by text only; Length stays unexplained for 7 of 15 rows (no source found).
- The meaning of the 8 blocks (areas, views or buildings) is not known; I did not read their labels.
- M7 reads circles as beams only on the six viewed pages; the 6-vertex and 24-vertex polygons are unidentified.
- Tests run at the end: lint clean (API, worker, web); API 419, worker 467, web 14, all passed.
