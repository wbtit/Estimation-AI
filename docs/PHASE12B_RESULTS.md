# Phase 12b results: page-level fixes and the held-out count check

Plan and pre-registration: `docs/PHASE12B_PLAN.md` (commit b2acab1, before any run). Rules: commit
0ec1041, `RULES_VERSION` phase12b-build-v1. Auto mode on fresh copies `p12b-<job>` of 16 jobs. Counts
only; job ids only. **job-015, job-018 and job-020 are seen jobs** (used in Phase 12a). "Phase 7 dev"
jobs had Phase 7 rules tuned on them (not used since). "Strict held-out" jobs never were a dev job.
No constant was changed after any run.

## 1. Headline (pre-registered measures)

Ours = every piece of the kind in the frozen system version, duplicates left out. Theirs = the
estimators' summary box. "Within 20%" = |ours − theirs| ≤ 0.2 × theirs.

| Group | Columns within 20% | Beams within 20% | Median abs. % error, columns / beams | Median signed % error, columns / beams |
|---|---|---|---|---|
| Seen (3 jobs) | 0 of 3 | 1 of 3 (job-018) | 100% / 100% | −100% / −100% |
| All others (12 jobs) | 2 of 12 | 2 of 10 | 98% / 178% | −7% / +178% |
| — Phase 7 dev (8) | 1 of 8 | 1 of 7 | 100% / 167% | +18% / +167% |
| — Strict held-out (4) | 1 of 4 | 1 of 3 | 92% / 819% | −53% / +819% |

Braces, girts and posts are never detected (0 everywhere: −100% on every job that lists them).
Joists: job-014 16 vs 20 (−20%, within); job-018 42 vs 10 (+320%).

## 2. Per job and kind (ours / theirs)

| Job | Group | Columns | Beams | Other kinds listed by them |
|---|---|---|---|---|
| job-003 | dev | 23 / 24 (−4%) | 237 / 82 (+189%) | V. braces 0/13, posts 0/7 |
| job-004 | strict | 0 / 21 (−100%) | 193 / 21 (+819%) | — |
| job-005 | dev | 21 / 10 (+110%) | 135 / 80 (+69%) | V. braces 0/8 |
| job-006 | dev | 0 / 16 (−100%) | not compared ("100~90") | posts 0/5 |
| job-008 | strict | 51 / 27 (+89%) | 943 / 63 (+1397%) | V. braces 0/16 |
| job-010 | dev | 31 / 11 (+182%) | 189 / 44 (+330%) | girts 0/6 |
| job-011 | dev | 12 / 51 (−76%) | 227 / 85 (+167%) | — |
| job-012 | dev | 0 / 76 (−100%) | 0 / 520 (−100%) | V. braces 0/14, posts 0/15 |
| job-013 | dev | 65 / 20 (+225%) | 55 / 65 (−15%) | — |
| job-014 | dev | 84 / 60 (+40%) | 91 / 7 (+1200%) | joists 16/20, V. braces 0/6, posts 0/3 |
| job-015 | seen | 0 / 162 (−100%) | 0 / 546 (−100%) | V. braces 0/36, girts 0/10, posts 0/16 |
| job-017 | strict | 2 / 48 (−96%) | 132 / 140 (−6%) | V. braces 0/18, girts 0/30 |
| job-018 | seen | 110 / 70 (+57%) | 154 / 163 (−6%) | joists 42/10; H/V braces 0/5, 0/38; girts 0/30; posts "37~20", piles "85~20" not compared |
| job-019 | strict | 17 / 19 (−11%) | not compared ("82~50") | posts 0/9 |
| job-020 | seen | 0 / 33 (−100%) | 0 / 77 (−100%) | V. braces 0/4, posts 0/16 |

Not run: job-002 (its marked-up set has no summary box under the pre-registered definition: no line
names columns or beams; the plan listed it from a looser probe: a deviation). Marked-up sets with a
box but no drawing project: takeoff-02, -08, -20. Without a box: takeoff-01, -13.

## 3. Each path of the new rules (16 auto runs)

| Rule | Count |
|---|---|
| Pages with a scale from dimensions (`scale_from_dimensions`) | 20 (job-005 11, job-014 4, job-010 2, job-013 2, job-018 1) |
| Pages marked Scale needed (not built) | 71 (job-015 16, job-010 7, job-003, -004, -013, -019 6 each, job-020 6, …) |
| Pages not a plan (Don't build) | 172 |
| Pile plans | 4 (job-003 2, job-011 1, job-018 1) |
| Duplicate columns marked (`column_duplicates`) | 30 (all on job-018) |
| Glyph columns on column plans with no crossing, job-018 (`column_glyph_shape`, the old P9) | 36 → 0 |
| job-018 page 18 grid crossings (`grid_family_by_direction`) | 0 → 12; off-grid base plates 14 → 2 |
| Columns with a size (`column_label_leader`, all 15 jobs, duplicates out) | 67 of 416 (34 by leader, 33 nearest); TYP notes gave 0 |
| Joists (`joist_label`) | job-018 42, job-014 16 |

## 4. job-018: where the difference comes from

Theirs: summary box (Columns 70, Beams 163); their count symbols by tag prefix (C = columns, B =
beams). Ours − theirs = (a) our pieces on pages with no symbol + (b) ours − their symbols on pages
with symbols + (their symbols − their summary).

**Columns: ours 110 − theirs 70 = +40**

| Bucket | Count |
|---|---|
| Over: foundation plans p5 and p6, where they placed symbols of other kinds only (no C) | +55 |
| Over: p18 (base-plate columns 20 vs their 12) | +8 |
| Over: p11 | +1 |
| Under: p15 (column plan; 26 more of ours there were merged as duplicates) | −8 |
| Under: columns they counted on framing pages p21 and p23 (we count columns on column plans only) | −16 |
| Their symbols − their summary | 0 |
| **Total** | **+40** |
| Already removed: duplicates merged (rule 5) | 30 |

**Beams: ours 154 − theirs 163 = −9**

| Bucket | Count |
|---|---|
| Over: p2, no symbol of theirs on the page | +12 |
| Over: p23 (a detail-guessed page built as a plan, scale from dimensions) 51 vs 20 | +31 |
| Over: p16 61 vs 36 | +25 |
| Over: p21 25 vs 19, p22 5 vs 3 | +8 |
| Under: p19 not built (no plan text; they counted 48 beams there) | −48 |
| Under: p12 HSS framing, 0 vs 38 (wrong pen) | −38 |
| Their symbols − their summary | +1 |
| **Total** | **−9** |

Non-steel already removed by the 12a/12b rules on this copy (not in ours): wall lines 74,
base-plate lines 23, column-shape lines 7, dash-pattern runs 3 (89 segments), grid markers 252,
joists 42 (kind Joist, outside the totals), column-plan beams 0 (no beam pen there). 138 of their
symbols carry other prefixes (7 prefixes), not compared.

## 5. What this shows (counts, not accuracy)

- **The beam total on the seen job-018 is close (−6%), but by cancellation:** +76 over-count on four
  pages against −86 under on two (p19 not built, p12 wrong pen).
- **Beams are over-counted on most other jobs (median +178%).** The gallery
  (`fixtures/private/eval/p12b_gallery/`) shows why: the 5 largest differences are detail sheets of
  job-008 (p11, p12, p14, p16) and job-004 (p17) built as plans. A detail view titled "… FRAMING" or
  "PLAN VIEW" passes the plan-text rule when the word DETAIL sits on another line. This is a leak in
  rule 2.
- **Whole jobs get nothing built:** job-015 and job-020 (no readable scale on the plan pages and no
  agreeing dimensions), job-012 (the scan guessed every page detail/elevation/notes with no plan
  title). The old rules would not have built job-012's pages either.
- **Columns:** 2 of 12 other jobs within 20%. Most column counts come from pages with no or wrong
  grids and from foundation plans that repeat the column plan in another frame.
- **Not detected at all:** braces, girts, posts.

## 6. Deviations

- job-002 has no summary box under the registered definition: listed, not compared (15 jobs, not 16).
- The copy guard first refused job-017 because its source holds 4 person rows. The copy tool never
  copies those rows, so the copy was made the same way as the others.
