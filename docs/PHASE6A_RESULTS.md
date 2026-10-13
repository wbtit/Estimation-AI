# Phase 6a results: v1 Stage 1 (counts, sizes, kinds, review screen, tables, Excel)

Pre-registration of the measurement: `docs/PHASE6A_PREREGISTRATION.md` (committed before the pipeline was run on any real drawing). Spec status: `docs/V1_UI_SPEC.md` section 8. Everything is deterministic code; no LLM, no third-party API, nothing pushed.

## What was built, per step
1. **Catalog (weights).** The AISC Shapes Database v16.0 file was read in place (read-only). Sheets: `Readme` and `Database v16.0` (2,302 rows). Proven by reading the file: the data sheet's header row has `Type` (family: W, HSS, L, 2L, C, MC, WT, PIPE ...), `EDI_Std_Nomenclature` and `AISC_Manual_Label` (shape names), `W` (weight; first block, e.g. a W44X408 has 408, and the W-weight of the metric block is 607) and the metric block repeats the same headers from column CG. The importer refused repeated headers, so it gained an optional occurrence suffix (`Header#1`). Used: name `AISC_Manual_Label#1` (fractions, as the drawings write them; the EDI name writes HSS thicknesses as decimals), weight `W#1` in lb/ft, family `Type`. Guess, not proven by a document: that column `W` is pounds per foot (it is the AISC convention and matches the examples). 2,299 shapes were loaded into the database (edition `aisc-v16.0`); nothing from the file is in git. Spelling rules (case, spaces, x or the times sign, `WF` for `W`, fraction against decimal by exact numeric equality) are in `api/src/catalog/lookup.ts`, with synthetic tests; the worker parser gained `WF` too (shared fixture). SHAPE comes from the catalog type, Unit W only from the catalog; a profile that is not in it leaves Unit W empty and the row amber "not in catalog". Grade: the person-set grade of the shape family; the estimators' family default (HSS A500, W A992) is only a suggestion flag.
2. **Flags instead of gates.** The Phase 5c gates are gone: the pipeline (`auto_run`) starts after the scan, reads the text, makes a whole-sheet view for every sheet in the takeoff, guesses the scale (the sheet's most frequent printed scale; none = "scale needed"), suggests the line class and runs the frozen linking rule (untouched). A sheet with no person decision is in the takeoff when its page type guess is a framing plan, out otherwise, as a flag. Nothing a person did is overwritten; every safeguard and the append-only edits stay. "These guesses are right" per sheet, "confirm all excluded sheets" for the rest, label "draft, N sheets unconfirmed" / "reviewed".
3. **Kinds.** Migrations 010 to 012: `member_kinds` (36 kinds), member kind, source, evidence, tag columns, provisional prefixes computed in SQL (no letters typed anywhere). Contract version 1 (optional fields only, converter from v0). Detection by the registered keyword table: own text line, then lines within 150 pt (nearest first), then the legend row of the mark, then the sheet title; first source wins and is stored; nothing found = empty kind; bare brace, rail, ladder = ambiguous; excluded kinds only from the own line or legend. Validator codes `KIND_MISSING`, `KIND_GUESSED`, `KIND_AMBIGUOUS`, `PREFIX_PROVISIONAL`. Abbreviation CSV loader.
4. **Review screen.** Count symbols per piece (circle, triangle, square, diamond by kind group), colour by confidence (grey = no kind), blue ring for reviewed, tag beside the symbol, unlinked labels as small red squares, filters, explanation panel with jump links and history, kind dropdown (36), apply to all pieces with this tag (count shown first), upload control, pipeline bar.
5. **Tables and Excel.** Page and job tables in the estimator's columns with Kind first, summary by kind, red / existing / not counted / misc lines, editable Kind and Name per row, row click selects the symbols, Excel with a job sheet, one sheet per page, a corrections sheet, DRAFT in the header and file name while any sheet is unconfirmed. Length ft, Length In and Total W are empty on purpose.
6. **Measurement** (below).

Design choices that change what the owner sees (questions 90 to 96 in `OPEN_QUESTIONS.md`): colour is the confidence of the identification, not of length or scale; a kind found only in nearby text, the legend or the sheet title makes the piece amber until confirmed; excluded kinds in nearby text are ignored.

## Tests
Lint clean (ruff, eslint, prettier, tsc). API, worker and web test counts are in the final report of the phase (see the end of this file for the last run).

## Step 6: page-level counts against the estimators' symbols (first accuracy figure that is not made against AI gold)
Run once, as pre-registered, no tuning: 16 jobs, 330 mapped pages, 136 pages where the estimators have at least one count symbol ("their pages", 4,373 symbols). The pipeline ran with no human action.

| Bar | Their pages (136) | Of those, sheets the pipeline included (70) | All 330 mapped pages |
|---|---|---|---|
| B1 our number equals theirs | 4 (2.9%) | 4 (5.7%) | 52.4% (mostly 0 against 0) |
| B2 within plus or minus 1 | 12 (8.8%) | 12 (17.1%) | 55.8% |
| B3 within 20 percent | 15 (11.0%) | 15 (21.4%) | 4.5% |
| B4 total, symbols drawn | ours 2,718 against theirs 4,373 (ratio 0.62) | ours 2,718 against theirs 2,403 (ratio 1.13) | |
| B4 total, in the main total (red left out) | 1,909 (ratio 0.44) | | |

- **B5 pages left out.** On 66 of the 136 their-pages (1,970 of their 4,373 symbols) the page type guess excluded the sheet, so our number is 0 there. One job had all 30 of its sheets guessed as details or elevations and got no pieces at all. On 25 pages we drew symbols where the estimators had none (386 symbols).
- **Over and under.** On the 70 included their-pages we drew too many on 28, too few on 38, the same on 4 (median ratio 0.90). One 37-page job gave 1,341 symbols against 804.
- **B6 by page colour (included their-pages).** green pages: 3, none equal; amber pages: 25, 4 equal and 8 within one; red pages: 37, none equal, 3 within one. Green pages did not agree more (only 3 of them); only 3 of 4,681 pieces were green on a page basis: the whole run has 116 green, 2,356 amber, 1,027 red and 1,182 unlinked pieces (4,681 members).
- **B7 shape groups.** Our linear-group pieces against their circles: equal on 21%, within one on 27% of 70 pages; our column-group pieces against their triangles: equal on 20%, within one on 36%.
- **B8 kinds.** Not measurable: the meaning of their tag prefixes is not known (the owner's list is empty).
- **B9 time.** Upload to tables: median 0.4 minutes per job, largest job (37 pages) 1.9 minutes, slowest 1.9 minutes (single machine, no GPU). Minutes, not hours.

Kinds found in the whole run (4,681 members): guessed 1,336, ambiguous 111, missing 3,234 (69%). Of the guessed kinds only 119 came from the label's own line, 949 from nearby lines, 212 from a joist designation and 56 from the sheet title; the most frequent are Beams 310, Joist 223, Column 131, Landing Frame 115 (a misc kind), Posts/Pipe 79. 3,583 profiles were found in the catalog, 400 were not.

### What this does and does not show
It compares counts per page. A page can agree by luck and a wrong page can hide right pieces; the estimators' marked pages are the pages they chose; equal counts do not prove each piece sits on the right member, size or kind. It is the first accuracy figure measured against the estimators' own symbols.

### What did not work
- **The label-based count is far from the estimators' count**: equal on 4 of 136 pages. This is what the Phase 5u label study (M7) predicted: the number of size labels is not the number of pieces (typed repeats, quantity notes, one symbol per piece against one label per type).
- **The page type default leaves out half of the estimators' pages** (66 of 136), and one job entirely. The guess is a weak decision to rest an automatic run on.
- **Kind detection is mostly empty or noisy**: 69% of pieces have no kind; almost all found kinds come from words within 150 pt, not from the label's own line, and some (a misc kind with 115 pieces) look like noise from neighbouring notes. The registered 150 pt window is too wide to trust; this was not tuned (no change after the result).
- **Few pieces are green** (116 of 4,681): shared lines, nearby-text kinds and medium link confidence make most amber. The colour does not yet separate good pages from bad ones.
- **1,182 labels (25%) have no line within reach** and are only small red squares.

### Risks
A draft total that looks complete may be used without review (the DRAFT label and file name are the only guard). Overcounting on busy framing plans (one job 1.7 times the estimators) and undercounting elsewhere can both pass as plausible numbers. The tag prefixes are provisional.
