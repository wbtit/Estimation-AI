# Plan: comparing our takeoff with an estimator's Bluebeam takeoff, and a timed review

Docs only (Phase 5c item 6). **No takeoff file has been read, opened or imported, and none is invented.** The estimators use Bluebeam takeoff and have been asked for exports (the markup list as CSV and a marked-up PDF of one job). Their format has NOT been seen. Everything below says what we would LIKE to have; each field is "wanted" until a real file shows what exists. If files appear under `fixtures/private/takeoffs/` (the folder does not exist now), they are left alone until a phase says to read them.

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
