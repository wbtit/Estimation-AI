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

**The CSV problem.** I searched the home folder (csv, xls, xlsx) for a file with the Reference Dwg No. column and found none; the only csv files outside the repository are our own inventory map (job list, not an estimator file) and a 118-byte file. I copied the wrong file once (our own inventory map), saw its contents (it holds real file names, which I did not repeat), and deleted the copy. The pricing-like workbook was NOT read for values. Please put the estimator CSV files in Downloads (or tell me the path); V3 and the second half of V1b then run with the seed already fixed (5021).

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
