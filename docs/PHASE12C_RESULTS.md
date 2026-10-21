# Phase 12c-A results: detection with a person's page setup

**Verdict (pre-registered bar, dev + strict held-out): "detection needs work".** Beams are within
20% on **5 of 33** built framing pages and columns on **1 of 10** built column-plan pages (the bar
needs half of each). Top 3 causes by count from the failure table (36 pt): **extra pieces on
non-steel lines (551)**, **beam lines they marked with no piece of ours (434)**, **wrong pen
(411 B symbols on pages where another pen is "the right pen")**.

Without the 3 "scale suspect" pages (section 4): beams 4 of 30, columns 1 of 10: still not met.
For information: strict held-out alone 3 of 11 / 1 of 4 (not met); seen 0 of 7 / 1 of 3 (not met).

Plan and pre-registration: `docs/PHASE12C_PLAN.md` (commit a7a7c1e, before any run). Rules:
`phase12b-build-v1`, unchanged; no constant changed after any result. Tools: `worker/tools/p12c_lib.py`,
`p12c_setup.py`, `p12c_eval.py`, `p12c_scale_check.py`, `bbmeasure.py`. Private outputs:
`fixtures/private/eval/p12c/` (`eval.json`, `scale_check.json`, 27 images). Counts only; job ids only.

## 1. Headline (pre-registered)

| Set | Framing pages: beams within 20% | Column-plan pages: columns within 20% | Median abs / signed % error, beams | Median abs / signed % error, columns | Bar |
|---|---|---|---|---|---|
| **dev + strict held-out (verdict)** | **5 of 33** | **1 of 10** | 55% / +29% | 89% / −76% | **not met** |
| dev + strict, scale suspect out | 4 of 30 | 1 of 10 | 65% / +29% | 89% / −76% | not met |
| strict held-out | 3 of 11 | 1 of 4 | 92% / +48% | 66% / −45% | not met |
| strict held-out, scale suspect out | 3 of 11 | 1 of 4 | 92% / +48% | 66% / −45% | not met |
| Phase 7 dev | 2 of 22 | 0 of 6 | 52% / +29% | 91% / −76% | not met |
| seen (015, 018, 020) | 0 of 7 | 1 of 3 | 69% / +67% | 62% / +62% | not met |

Setup: 89 marked pages (pages with their B or C symbols). **53 built**, **36 not built (no scale
from any source)**: job-012 15, job-015 14, job-020 5, job-004 2. Scale source of the built pages:
our parsed scale 26, their markup calibration 17, the dimension rule 10.

## 2. Per job

"Ours / box" is the sum over the built pages (columns on column-plan pages, duplicates out) against
the estimators' summary box; a job with unbuilt pages is short by construction.

| Job | Group | Built / marked pages | Framing pages within 20% | Column pages within 20% | Columns ours / box | Beams ours / box | Their C symbols on framing pages |
|---|---|---|---|---|---|---|---|
| job-003 | dev | 2 / 2 | 1 of 1 | 0 of 1 | 7 / 24 (−71%) | 84 / 82 (+2%) | 0 |
| job-004 | strict | 2 / 4 | 1 of 1 | 0 of 1 | 0 / 21 (−100%) | 6 / 21 (−71%) | 0 |
| job-005 | dev | 6 / 6 | 0 of 5 | 0 of 1 | 19 / 10 (+90%) | 60 / 80 (−25%) | 2 |
| job-006 | dev | 5 / 5 | 0 of 4 | 0 of 1 | 0 / 16 (−100%) | 233 / — | 7 |
| job-008 | strict | 3 / 3 | 1 of 2 | 0 of 1 | 37 / 27 (+37%) | 82 / 63 (+30%) | 0 |
| job-010 | dev | 3 / 3 | 0 of 2 | 0 of 1 | 25 / 11 (+127%) | 67 / 44 (+52%) | 1 |
| job-011 | dev | 2 / 2 | 1 of 2 | — | 0 / 51 (−100%) | 146 / 85 (+72%) | 51 |
| job-012 | dev | 3 / 18 | 0 of 3 | — | 0 / 76 (−100%) | 466 / 520 (−10%) | 7 |
| job-013 | dev | 3 / 3 | 0 of 3 | — | 0 / 20 (−100%) | 27 / 65 (−58%) | 0 |
| job-014 | dev | 4 / 4 | 0 of 2 | 0 of 2 | 11 / 60 (−82%) | 42 / 7 (+500%) | 0 |
| job-015 | seen | 0 / 14 | — | — | 0 / 162 (−100%) | 0 / 546 (−100%) | 0 |
| job-017 | strict | 3 / 3 | 1 of 2 | 0 of 1 | 2 / 48 (−96%) | 132 / 140 (−6%) | 0 |
| job-018 | seen | 9 / 9 | 0 of 6 | 1 of 3 | 81 / 70 (+16%) | 173 / 163 (+6%) | 16 |
| job-019 | strict | 7 / 7 | 0 of 6 | 1 of 1 | 20 / 19 (+5%) | 208 / — | 0 |
| job-020 | seen | 1 / 6 | 0 of 1 | — | 0 / 33 (−100%) | 36 / 77 (−53%) | 0 |

Columns on framing pages are not compared (open question 140): 84 of their C symbols sit on framing
pages (job-011 has all 51 of its column symbols there, so it has no column-plan page).

## 3. Per page (built pages; beams on framing pages, columns on column-plan pages)

"Pen right" = our pen is the pen nearest to most of their B symbols (36 pt); "—" = no line of at
least 24 real inches within 36 pt of any B symbol.

| Job | Group | Page | Compared | Scale source | Pen right | Ours | Theirs | % error | Within 20% | Scale suspect |
|---|---|---|---|---|---|---|---|---|---|---|
| job-003 | dev | 7 | columns | parsed | — | 7 | 24 | −71% | no |  |
| job-003 | dev | 12 | beams | parsed | no | 84 | 81 | +4% | yes |  |
| job-004 | strict | 4 | columns | parsed | — | 0 | 7 | −100% | no |  |
| job-004 | strict | 7 | beams | parsed | — | 6 | 5 | +20% | yes |  |
| job-005 | dev | 9 | beams | dimensions | yes | 9 | 7 | +29% | no |  |
| job-005 | dev | 10 | beams | dimensions | yes | 9 | 7 | +29% | no |  |
| job-005 | dev | 11 | beams | dimensions | yes | 9 | 16 | −44% | no |  |
| job-005 | dev | 13 | columns | dimensions | — | 19 | 8 | +138% | no |  |
| job-005 | dev | 14 | beams | dimensions | yes | 18 | 24 | −25% | no |  |
| job-005 | dev | 15 | beams | dimensions | yes | 15 | 26 | −42% | no |  |
| job-006 | dev | 3 | columns | parsed | — | 0 | 9 | −100% | no |  |
| job-006 | dev | 6 | beams | markup | no | 103 | 79 | +30% | no |  |
| job-006 | dev | 7 | beams | parsed | no | 58 | 5 | +1060% | no |  |
| job-006 | dev | 9 | beams | parsed | — | 66 | 9 | +633% | no |  |
| job-006 | dev | 11 | beams | markup | no | 6 | 9 | −33% | no |  |
| job-008 | strict | 4 | columns | parsed | — | 37 | 27 | +37% | no |  |
| job-008 | strict | 5 | beams | parsed | yes | 37 | 25 | +48% | no |  |
| job-008 | strict | 6 | beams | parsed | no | 45 | 38 | +18% | yes |  |
| job-010 | dev | 6 | columns | parsed | — | 25 | 10 | +150% | no |  |
| job-010 | dev | 7 | beams | markup | yes | 39 | 32 | +22% | no |  |
| job-010 | dev | 8 | beams | markup | yes | 28 | 13 | +115% | no |  |
| job-011 | dev | 12 | beams | parsed | yes | 122 | 57 | +114% | no | yes |
| job-011 | dev | 13 | beams | parsed | no | 24 | 27 | −11% | yes | yes |
| job-012 | dev | 5 | beams | dimensions | yes | 198 | 33 | +500% | no |  |
| job-012 | dev | 12 | beams | dimensions | yes | 188 | 23 | +717% | no |  |
| job-012 | dev | 21 | beams | dimensions | no | 80 | 21 | +281% | no |  |
| job-013 | dev | 9 | beams | parsed | no | 24 | 53 | −55% | no | yes |
| job-013 | dev | 17 | beams | parsed | no | 1 | 2 | −50% | no |  |
| job-013 | dev | 22 | beams | markup | no | 2 | 11 | −82% | no |  |
| job-014 | dev | 7 | columns | parsed | — | 6 | 32 | −81% | no |  |
| job-014 | dev | 8 | columns | parsed | — | 5 | 28 | −82% | no |  |
| job-014 | dev | 11 | beams | parsed | no | 9 | 5 | +80% | no |  |
| job-014 | dev | 15 | beams | dimensions | yes | 33 | 2 | +1550% | no |  |
| job-017 | strict | 9 | columns | parsed | — | 2 | 48 | −96% | no |  |
| job-017 | strict | 10 | beams | parsed | yes | 25 | 33 | −24% | no |  |
| job-017 | strict | 11 | beams | markup | yes | 107 | 107 | +0% | yes |  |
| job-018 | seen | 11 | columns | parsed | — | 14 | 13 | +8% | yes |  |
| job-018 | seen | 12 | beams | parsed | no | 0 | 38 | −100% | no |  |
| job-018 | seen | 15 | columns | parsed | — | 47 | 29 | +62% | no |  |
| job-018 | seen | 16 | beams | markup | yes | 61 | 36 | +69% | no |  |
| job-018 | seen | 18 | columns | parsed | — | 20 | 12 | +67% | no |  |
| job-018 | seen | 19 | beams | markup | no | 24 | 48 | −50% | no |  |
| job-018 | seen | 21 | beams | markup | no | 26 | 19 | +37% | no |  |
| job-018 | seen | 22 | beams | markup | no | 5 | 3 | +67% | no |  |
| job-018 | seen | 23 | beams | markup | yes | 57 | 20 | +185% | no |  |
| job-019 | strict | 3 | columns | parsed | — | 20 | 19 | +5% | yes |  |
| job-019 | strict | 4 | beams | markup | — | 26 | 1 | +2500% | no |  |
| job-019 | strict | 5 | beams | markup | — | 25 | 1 | +2400% | no |  |
| job-019 | strict | 6 | beams | markup | — | 25 | 2 | +1150% | no |  |
| job-019 | strict | 8 | beams | markup | no | 42 | 1 | +4100% | no |  |
| job-019 | strict | 9 | beams | markup | no | 6 | 72 | −92% | no |  |
| job-019 | strict | 19 | beams | markup | no | 84 | 7 | +1100% | no |  |
| job-020 | seen | 8 | beams | parsed | — | 36 | 2 | +1700% | no |  |

## 4. Scale check against their /BBMeasure calibration

Their Bluebeam calibration also exists as `/BBMeasure` on area and perimeter markups (not read by the
Phase 5v reader; read now by `worker/tools/bbmeasure.py` for this check only, nothing built from it).
13 marked pages carry it; 7 of them were built in this run: **4 agree within 1%, 3 differ**. No page
carries two different calibrations of theirs.

| Job | Page | Theirs | Ours | Our source | Result |
|---|---|---|---|---|---|
| job-003 | 12 | 96 | 96 | parsed | agree |
| job-011 | 12 | 48 | 96 | parsed | **scale suspect** |
| job-011 | 13 | 48 | 96 | parsed | **scale suspect** |
| job-013 | 9 | 48 | 96 | parsed | **scale suspect** |
| job-013 | 22 | 96 | 96 | markup | agree |
| job-018 | 11 | 48 | 48 | parsed | agree |
| job-019 | 3 | 96 | 96 | parsed | agree |

Not in this run (no B or C symbol on the page): job-003 p8, job-017 p16, job-018 p5, p6, p14,
job-020 p3. Ratios are real inches per drawn inch (48 = 1/4" = 1'-0").

## 5. Failure table (built pages; rows overlap; member units)

| Row | dev + strict, 36 pt (primary) | 24 pt | 12 pt | seen, 36 pt |
|---|---|---|---|---|
| Wrong pen (B symbols on pages where another pen is right) | 411 | 424 | 489 | 108 |
| Beam lines they marked with no piece of ours (B symbols unmatched) | 434 | 510 | 623 | 145 |
| Joist taken as a beam (unmatched pieces in a joist-like run) | 19 | 24 | 44 | 0 |
| Over-split (B symbols touching collinear end-to-end pieces) | 56 | 41 | 14 | 3 |
| Under-split (pieces nearest to 2+ B symbols) | 78 | 57 | 25 | 2 |
| Extra pieces on non-steel lines (unmatched, pen right) | 551 | 588 | 601 | 97 |
| Columns missed (C symbols unmatched) | 192 | 209 | 211 | 41 |
| Columns extra (our columns unmatched) | 101 | 118 | 120 | 68 |
| Unsized (matched pieces with no size) | 41 | 30 | 23 | 13 |

Gallery (three panels: drawing / ours / their markup; the case circled): `fixtures/private/eval/p12c/<row>-1..3.png`, 27 images.

**Pen check (36 pt), dev + strict:** of their B symbols, 256 are nearest to a line of our pen, 496
to a line of another pen, 82 have no line of at least 24 real inches within 36 pt. Our pen is "the
right pen" on 14 of 33 framing pages (seen: 2 of 7). At 24 pt: 228 / 471 / 135; at 12 pt: 156 / 393 / 285.

**Length check (secondary):** 79 of their two-point measurement lines lie on built pages (dev +
strict 46, seen 33). Only **10** match a piece of ours (5 deg, 50% overlap, 12 pt): dev + strict 2
(both +11.2 in), seen 8 (median |error| 10.6 in, 90th percentile 156.7 in, median signed −10.6 in).
69 have no matching piece. Too few matches to say anything about length.

## 6. What this shows (counts, not accuracy)

- **Even with the right pages, role and (mostly) the right scale, beam counts per page are rarely
  close.** Most over-counts are on pages where their B symbols are few (job-019 pages 4 to 8: 1 or 2
  symbols against 25 to 42 pieces; job-014 p15, job-020 p8): likely typical floors counted once or
  members counted elsewhere (open question 138); a per-page count against such pages says little.
- **The pen is the largest single lever:** our pen is the right one on 14 of 33 framing pages,
  another pen on 14, and 5 pages have no long line near their symbols; twice as many of their B
  symbols are nearest to another pen as to ours. This is the
  owner decision "stricter beam pen from one clicked beam".
- **Extra pieces on non-steel lines (551)** remain on pages where the pen is right: the non-steel
  filters of decision 2 (dimension, leader, wall, slab edge, section cut, break, hatch).
- **Part of "extra" and "no piece" is matching distance, not detection:** the gallery shows real
  beams whose ring sits a little beyond 36 pt (for example job-005 p9). At 12 pt the matched share
  drops further, so the rings are not on the members. No constant was changed.
- **Columns are mostly missed (192)**: small HSS squares and posts on foundation plans (job-004 p4,
  job-017 p9, job-014 p7 and p8) are not found as columns.
- **Scale:** 36 of 89 marked pages have no scale from any source (section 7); 3 of 7 checked pages
  had our parsed scale at twice theirs.

## 7. The 36 pages with no scale (finding for the setup screen; open question 143)

21 show several scales or one scale plus an NTS note (job-004 2, job-015 14, job-020 5): the setup
screen must show the scales found, pre-select the plan's own and the person confirms. 15 show no
readable value (all job-012): setup asks for it with a two-click calibration on a known dimension.
Candidate rule for later: one numeric scale + NTS on a sheet -> the numeric scale for the plan view,
flagged for review.

## 8. Deviations

- **Measurement entries the Phase 5v reader cannot read** (the `/BBMeasure` dictionaries; the reader
  crashed on them) count as "no markup scale" in the setup (a crash fix before any build, commit
  5fb2a4e). The scale-recovered set was skipped (owner): none of the 36 no-scale pages has one.
- **job-018 ran on a second fresh copy `p12c-job-018-b`.** A person opened the first copy
  `p12c-job-018` in the review UI between its copy and its build (7 page views and 2 setup actions,
  07:40 to 07:41 UTC on 2026-10-21, the owner's name), so auto mode refused it, as designed. That
  copy and its actions were left as they are; the run uses `p12c-job-018-b` (commit 4fe7770).
- **Gallery rendering fix:** on rotated pages the first gallery crops were taken from the wrong part
  of the page (the crop box was rotated twice). Only the images were wrong; every count uses
  displayed coordinates throughout. Fixed and the 27 images remade.
- The length check matched far fewer lines than expected (10 of 79); reported as is.
