# Phase 6a step 6 pre-registration: how close are the system's counts to the estimators' (written and committed BEFORE the pipeline was run on any real drawing in this phase)

Disclosure. Steps 1 to 5 were built and tested on synthetic data only; the real drawings were not run through the new pipeline before this file was committed. The earlier studies (Phase 5t, 5u) told us that the number of size labels on a page equals the number of circle symbols on only 9 of 100 pages (M7), so a poor result is expected for the label-based count; this measurement is run once and reported whatever it shows. Nothing is tuned afterwards (the frozen linking rule is untouched).

This is the FIRST accuracy figure that is not made against AI-made gold: the reference is the estimators' own count symbols in their marked-up PDFs.

## Population and method
- Jobs: every estimator takeoff PDF in `fixtures/private/takeoffs` that the Phase 5t inventory matched to a drawing set (16 takeoffs, 330 mapped pages; the mapped page pairs of Phase 5t `inventory.json` are used unchanged).
- For each job: create a project, upload the CLEAN drawing PDF through the API, let the worker scan it and run the automatic pipeline (`auto_run`), with NO human action (no include, no confirmation, no kind, no correction). Then read the pieces of every sheet from the members API and the tables API.
- Their number per page: the count symbols of the marked-up page: Polygon annotations with 3 or 8 vertices (the Phase 5t/5u symbol rule; the tag pairing of 5u is used only for the colour/shape groups below).
- Our number per page: the pieces with a count symbol on the page = counted kinds and pieces without a kind yet, primary = symbols DRAWN (every colour including red; not unlinked labels, not existing, not misc, not excluded kinds). Secondary = pieces in the total (red left out). A sheet the pipeline left out by its page type default has no pieces: our number is 0 there, and it is counted as 0 in the all-pages figures and listed separately.

## Bars (fixed now)
For the pages where they have at least one count symbol ("their pages"), and separately for every mapped page:
- B1 share of pages where our number equals theirs.
- B2 share where it is within plus or minus 1.
- B3 share where it is within 20 percent of theirs (|ours - theirs| <= 0.2 x theirs; theirs >= 1).
- B4 totals over all their pages: sum of ours, sum of theirs, ratio ours/theirs.
- B5 pages we left out (their pages >= 1 where the sheet was excluded by default) and pages where we drew symbols and they had none.
- B6 by colour of the page: a page is a "green page" when at least 90% of its drawn pieces are green, a "red page" when at least 10% are red, otherwise an "amber page"; B1 to B3 for each class (do green pages agree more?).
- B7 shape groups: per page, our linear-group pieces against their circles (8 vertices) and our column-group pieces against their triangles (3 vertices): share of pages where each is equal / within 1.
- B8 kinds: the meaning of their tag prefixes is not known (the owner's `meaning` column is empty), so "our kind against the kind implied by their symbol" cannot be measured; only B7 (shape groups) is. This is stated, not worked around.
- B9 time: wall-clock from the start of the upload to the moment the tables endpoint answers for the finished run, per job and for the largest job by page count, in minutes (single machine, no GPU, worker and API on the same host).

## What this cannot show
It compares COUNTS PER PAGE. Equal counts do not prove that each piece sits on the right member, or has the right size or kind; a page can agree by luck (two errors cancelling). Their symbols include pieces our label-based method cannot see (a repeated member marked once in the drawing, TYP notes, quantities written in notes) and ours can include labels the estimators did not count. The estimators' marked pages are the ones they chose to mark; pages without their symbols say nothing about correctness. Lengths, weights and Excel values are not compared in this phase.

## Reporting
Results go to `docs/PHASE6A_RESULTS.md` as they are. Derived per-page numbers stay in `fixtures/private/takeoffs/stage1_measure.json` (git-ignored). No job names, drawing text, tag text or tag prefixes appear in docs, code, logs or chat.
