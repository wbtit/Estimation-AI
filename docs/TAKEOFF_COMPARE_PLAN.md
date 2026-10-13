# Plan: comparing our takeoff with an estimator's Bluebeam takeoff, and a timed review

Written in Phase 5c (docs only) and **updated in Phase 5t, after the real files were read for structure** (`docs/PHASE5T_RESULTS.md`). Sections 1 to 5 are the Phase 5c plan; section 0 is what the files actually are, and it overrides the guesses below where they differ. Nothing is imported and no production table exists for takeoff data.

## 0. What the real takeoff files are (Phase 5t)
- **Format:** 21 marked-up PDFs (the drawing set itself with PDF annotation objects drawn on it) and 1 pricing-like spreadsheet. **No CSV or XML markup list was supplied.** A PDF reader (PyMuPDF) reads the annotations directly: page, subtype, vertices, rectangle, subject, contents, colour, creation date, author, optional layer reference, an optional measurement dictionary and optional custom column data.
- **Count markup:** a small closed Polygon symbol (3 or 8 vertices) with a FreeText tag beside it (short mark-like code) and custom column data (a constant numeric quantity in the one file inspected). 4,373 on the matched pages. **There is no profile in it**: a profile has to come from the mark through a schedule or legend.
- **Length markup:** a Line (2 vertices) with a `/Measure` dictionary (its scale and unit) and the measured value as dimension text in the contents. Only 14% of Lines are measurements; the other Lines are leaders, arrows and page-wide lines and cannot be told apart by subtype. PolyLines are almost unused.
- **Profile text** appears on 1.8% of markups (Squares 3%, Highlights 36%; Highlights carry the highlighted label text and its quad position). None of the length markups has one.
- **Takeoff PDF = the full set**, our documents are subsets of it (our matched pages are 7 to 37 per job); 16 of 19 documents have one; 5 takeoff PDFs match no document of ours. Matching by a hash of the page's words with the markups removed works and needs no file names.
- **Page 29 of job-005 (the 27 shared lines) is not taken off** in the file: 2 markups on the page, none near the lines.

### What a production importer would need (not built)
1. Read annotations with a PDF library; map vertices through the page rotation into displayed points (same frame as our lines and labels).
2. Map takeoff pages to our sheets by the text-fingerprint match (word-set similarity of 0.9 or more; the markups removed first).
3. Separate the four kinds: count symbols with their tags, measured lengths (Line with a measurement dictionary), highlighted labels (Highlights with contents), and everything else (rectangles, ink, text boxes), which is ignored.
4. Read the measurement dictionary (number format constant and unit) to turn points into feet or millimetres, and compare with the scale we confirm per view.
5. A count symbol gives a **position and a mark**, not a line and not a profile; the profile has to be looked up by mark (schedule, legend: the Phase 5d parser) or taken from a highlighted label near the symbol. A matcher from symbols to our members is a design task of its own and is not designed here.
6. Keep the raw markups in a separate, read-only table or file; do not mix them with member edits.



## 1. Fields we would want from the export
| Wanted | Why | Unknown until we see a file |
|---|---|---|
| page (number or label) | to match to our sheet | whether it is a page number or the sheet label, and whether it follows our page numbering |
| subject / type of the markup | tells a length measure from a count and from a note | the names the estimators use |
| label or comment text | the profile (or mark) the estimator wrote | whether the profile is in the label, the comment or only in the subject |
| measured length, or the count | the number to compare | units (feet-inch text, decimal feet, mm), whether it is a polyline total or per segment |
| colour, layer | often the way an estimator groups steel types | whether anyone uses them consistently |
| author and date | who checked what; to see which markups are final | whether present |
| position of the markup on the page | to match a markup to a member without relying on text | whether the CSV carries coordinates, or only the marked-up PDF does (then the PDF annotations would be read by a PDF reader, in a later phase) |
| scale of the page as the estimator set it | to compare lengths in the same units | whether stored per page or per measurement |

## 2. How members would be matched (a proposal, tested on a real file before it is trusted)
1. **Sheet:** by page number first; by sheet label as the check. A mismatch is reported, never forced.
2. **Candidate pairs:** a markup and a member on the same sheet with the same canonical profile (the parser reads the estimator's text; the raw text is kept).
3. **Position:** when markup coordinates exist, the markup's centre against the member's chosen line (distance and overlap of the two extents, in page points after the scale of the page is known). When coordinates do not exist, match by profile and by order along the sheet only for the totals, and say that member-level matching is not possible.
4. **One-to-one assignment** by smallest distance; leftovers are "only in the takeoff" (our recall misses) or "only in ours" (our extras).
5. Count markups (for example pieces marked by count) are matched to our members of that profile on that sheet without a position.

## 3. Metrics
- **Member recall** = takeoff members matched to one of ours / takeoff members; **precision** = our members matched / our counted members. Per sheet and overall; our members on undecided or excluded sheets and existing steel are not counted, as in our totals.
- **Profile exact match** (canonical form) over the matched pairs; mismatches listed by profile pair.
- **Length tolerance:** share of matched pairs within 2%, 5% and 10% of the estimator's length; only members with a trusted length (not `length_shared`) enter this. Also the number of pairs whose length we do not trust, reported apart, because they are not a measurement.
- **Total length per profile** and **pieces per profile**: ours against the estimator's, absolute and in percent. A shared-line group is compared by pieces only.
- The amount of work they imply: counts of members we marked green, amber, red and unlinked among the matched and the missed ones, so the colors can be calibrated against a human takeoff and not only against the AI gold.
- Everything is reported with counts, never with page text.

## 4. What is unknown
The export format itself; whether the estimator measured each member or each run of members; whether lengths are centre-to-centre, face-to-face or cut length; whether existing steel and misc steel are marked and how; what the estimators call the types of markup; whether several estimators work on one job with different habits; whether the PDF keeps the markup coordinates in a form we can read without a licence-bound library. None of these is guessed here.

## 5. Protocol for a timed review by an estimator (to measure the real cost of the review screen)
Run once per job with one estimator who did not see our proposals before. No client information is recorded; jobs are named by number.
1. **Before:** record the job number, the number of pages, the number of framing sheets the estimator decides to include, and the estimator's own takeoff time for the same job if known (minutes).
2. **Setup (not timed separately, noted):** views drawn or whole-sheet views used; scale confirmed or typed per view; line classes confirmed per view. Record how many of each, and how many times the suggestion was accepted unchanged.
3. **Review (timed with a stopwatch by an observer, minutes per sheet):** per included sheet record: members shown, members confirmed with "looks right", members fixed (relinked, profile or mark changed), members added by hand, members marked not a member, existing, or deleted, shared-line decisions, unlinked labels resolved. The screen already stores each action with who and when (member edits, sheet decisions), so the counts and the clicks can be read back from the corrections export; the observer records only the minutes and the interruptions.
4. **Clicks:** taken from the stored actions (one action is one or more clicks; keys are counted separately), never estimated by the observer.
5. **After:** export the takeoff table and the corrections; record the estimator's judgement per sheet in three words (trust, trust with fixes, redo by hand) and the sheets the estimator would not review with this tool.
6. **Report:** minutes per sheet and per 100 members, actions per member, share of members that needed a fix, share of sheets abandoned, and the comparison of section 3 once the estimator's own takeoff is available.
The review of the first job is a trial run; its numbers are reported but not pooled with later jobs.
