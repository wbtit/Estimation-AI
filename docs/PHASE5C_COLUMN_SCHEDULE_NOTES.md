# Phase 5c notes: the column schedule (proposal only, nothing here is built)

Written during Phase 5b item 9 after viewing the pages of **job-010** (the owner approved viewing the test set). Structure only: no text and no names from the drawings. **No schedule table parser is built in Phase 5b.**

## What job-010 has (counts from the production legend builder)
- 140 mark-shaped words on the 12 framing-plan pages, 23 distinct marks.
- 1 legend row in the whole document. Of the 23 plan marks, 1 has a legend row (linked), 0 are ambiguous, **22 have no legend row**.
- Page type guess `schedule/legend`: 3 pages. They match the words COLUMN and SCHEDULE, but none of them holds the column schedule (two are general-notes sheets, one a lintel schedule sheet). The words COLUMN and SCHEDULE are on 9 pages of the document in all (notes and cross-references). So "page type + keywords" finds **0 of the 1** real column schedule.
- The only column schedule is on **one page** (the foundation plan sheet, guessed `foundation_plan`). On it the builder made 0 legend rows. Text rows on the three guessed schedule pages: 3 rows with a mark and a profile on one text row, 32 rows with a mark and no profile (mark-only).
- 6 members made from marks in the reviewed views, all `linked` (they all come from the one legend row).

## What the schedule looks like (structure)
- A small boxed table on the left side of a plan sheet, below the general-notes block, in a stack of other small schedules on the same sheet (a footing schedule with several numeric columns, a wall-stud schedule, a header schedule with several columns). It is the first of those tables.
- A caption above the grid in bold, underlined type; the caption contains the words column and schedule.
- A **two-column ruled grid**: a narrow MARK column and a wider SIZE column, one header row (bold) and 4 data rows. Cell text is **centred** in its cell. Row pitch is about the text height plus a small margin; text height is about 9.5 pt.
- The mark (a short letter-digit code) sits in the left cell and the profile in the right cell. **The gap between them is 133 to 141 pt, 14 to 15 times the text height.**
- The plan itself refers to a column by a composite tag: several marks (footing, column, base plate) in one text string separated by slashes, so a plan mark label is not always a single token.

## Why the row-based method failed
`worker/src/review/legend.py` builds a row from words on one text line that are **close together**: a horizontal gap larger than 10 times the text height ends the segment (`SEGMENT_GAP`), and a legend row needs a mark and a profile in one segment. In this table the mark and the size are in separate cells 14 to 15 times the text height apart, so every row is cut in two: a mark-only segment and a profile-only segment. 0 rows. Raising the limit is not a fix: it would join unrelated words everywhere else (notes, dimension strings), and the same builder would then also read the wall, footing and header schedules on the page as legend rows.

## Proposed column-aware parser (design, not built)
1. **Find the table.** A caption line whose words include both "column" and "schedule" (case-insensitive; the keyword list lives in one config). Then read the vector paths below it: axis-aligned thin segments and rectangles within the caption's width +/- a margin. Cluster the x of vertical rules and the y of horizontal rules (tolerance about 1 pt) into a **cell grid**. If there is no ruled grid, fall back to text alignment: x-clusters of word centres that repeat over at least 3 consecutive rows.
2. **Name the columns from the header row.** Header words are matched against a short config list (MARK, TAG, ID -> mark; SIZE, SHAPE, SECTION, MEMBER -> profile; anything else -> extra column kept as raw text). A table with no mark column or no profile column is not a column schedule and is skipped. No steel data is invented: the list holds header words only.
3. **Read the rows by cell**, not by line. A word belongs to the cell that contains its centre; several lines in one cell are joined top to bottom. A row is valid when the mark cell matches the mark pattern and the size cell is exactly one profile (the existing profile parser). The raw cell texts are kept.
4. **Report, do not guess.** A row with a mark and an empty or unparsable size cell is a **mark-only row**: stored as such and counted, never filled in. Rows are stored as `legend_rows` with `source.kind = 'column_schedule'` and the cell boxes, so the link job and the review screen use them like any legend row (a suggestion the person confirms).
5. **Plan tags.** Splitting composite tags (marks separated by slashes) is a separate, later step with its own test; the schedule parser only needs the plan tag to contain the column mark as one of its parts.

## Acceptance test (to write with the parser)
- **Synthetic, generated in the test:** a ruled two-column table, centred cells, mark and size 15 times the text height apart, a header row and 4 data rows, plus a caption. Expect exactly 4 rows with the right marks and canonical profiles.
- **Negative synthetic:** a ruled table of 5 columns with numeric cells and a caption without the words column and schedule yields 0 rows; a column-named table with no size column yields 0 rows; a data row with an empty size cell is returned as mark-only and is not given a profile.
- **Regression:** the existing row-based legend builder gives the same rows as before on all existing fixtures; the two methods together never create the same mark twice with different profiles without flagging it as ambiguous.
- **Real page (private, not committed):** on the one job-010 page the parser returns exactly the 4 rows of a hand-typed expected list kept in `fixtures/private`, and 0 rows from the other four small schedules on that sheet. Report the same counts on the other vector study documents (rows found, mark-only rows) without reading any text into docs.
- The parser is deterministic; no LLM and no network call.

## Open points for the owner
- Do you want composite plan tags (marks separated by slashes) split in the same phase?
- Are column schedules on the foundation plan sheet the usual place on your jobs, or do they also appear on separate schedule sheets (the page type guess would then be right)?
