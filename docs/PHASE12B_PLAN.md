# Phase 12b: page-level fixes, then a held-out count check

Local branch `phase-12b` (from `phase-12a-engine`). Owner decisions from EVALUATION_PACK section 8.
Every change is a named rule with named constants, with synthetic tests; `RULES_VERSION` becomes
`phase12b-build-v1`. Frozen snapshots are never touched. One migration (023: the kind "Piles" and
the count action names it needs), with a backup and `_test` first. The UI round stays paused; the
only web change is what the new data needs (the "Scale needed" badge, Piles and Joists in the
Summary).

## 1. Rules

| # | Rule | Where | What it does (constants) |
|---|---|---|---|
| 1 | `scale_from_dimensions` | `worker/src/build/dimension_scale.py`, auto mode | For a page with no stored scale: every text line inside the crop that is one whole feet-inch dimension of at least DIM_MIN_FT = 1 ft is paired with the nearest segment parallel to it (within DIM_PARALLEL_DEG = 3°) whose span holds the text's projection and whose axis is within DIM_TEXT_REACH_PT = 12 pt of the text centre. Each pair gives a ratio (real inches / paper inches). The ratios are grouped (a group = within DIM_AGREE = 2% of its first member); the largest group must have at least DIM_MIN_AGREE = 3 members and more than any other group; its median is snapped to the nearest standard ratio (12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 120, 240, 360, 480, 600, 720, 1200) within DIM_SNAP = 2%, else no scale. Found: the scale is a system value with text "from dimensions" (evidence `scale_rule: dimensions`), flagged for review like every system value. Not found: the page is not built; its card says **Scale needed** until a person sets a scale. |
| 2 | `plan_only_roles` | `worker/src/build/page_roles.py`, auto mode | A page is built only when it is a plan. Texts: the sheet title and the view titles (large all-caps lines, rebuilt from the stored text lines with the scan's own constants). A text is a **plan text** when it has PLAN(S) not followed by DETAIL/SECTION, or FRAMING / FOUNDATION / FOOTING / PILE / PILING with none of DETAIL, SECTION, ELEVATION, SCHEDULE, NOTES, CONNECTION, LEGEND, DIAGRAM. When the sheet title has one of those non-plan words and is not a plan text, the page is "Don't build". Otherwise the page is built when any text is a plan text; else "Don't build". The role of a built page stays the page type guess (foundation -> column plan, framing -> framing). A person can switch any page on. |
| 3 | `pile_plan` | `page_roles.py`, the build | A column-plan page whose title or a plan view title has PILE / PILES / PILING is a pile plan: its column glyphs are stored as kind **Piles** (type column), listed in the BOM and Members by size under Piles. |
| 4 | `joist_label` | `worker/src/build/labels.py`, the build | Joist designations (the existing SJI parser: K, KCS, LH, DLH, and joist girders G, e.g. 24G8N8K) are labels of their own kind. A piece whose attached label (parallel on the piece, or nearest) is a joist designation becomes kind **Joist** with no size; a joist never gets a W / HSS size. Joist is an excluded kind: out of the main steel totals, shown apart. |
| 5 | `column_duplicates` | `worker/src/build/duplicates.py`, after each column-plan build | A column on a column-plan page that is the same column as one on a page built earlier (the same grid crossing labels; or, when the two pages' grids register, a projected position within DUP_TOL_IN = 24 in) is kept but marked `duplicate_of` (the earlier member) and left out of the totals. |
| 6 | `grid_family_by_direction` | `worker/src/build/grids.py` | When one label family holds grid lines in two directions at least 90° - FAMILY_DIRECTION_TOL_DEG (20°) apart (E.12 and E.14 both "letters"), that family is split by direction: the more vertical lines are numbers ("N"), the others letters ("A"). |
| 7 | `column_glyph_shape` | `worker/src/build/columns.py` | A glyph is a column only when it is at a grid crossing, or inside a base plate, or (the repeated-glyph rule) its outline is column-like: straight-sided and closed (4 to 12 corners, no curve, not a triangle), long side COLUMN_GLYPH_MIN_IN = 4 in to COLUMN_GLYPH_MAX_IN = 36 in at the view's scale. Rebar dots, elevation targets and markers are dropped. |
| 8 | `column_label_leader`, `typical_column_size` | `labels.py` | On column plans a column takes a column size (W, HSS, HP, PIPE, S, M) within COLUMN_LABEL_MAX_PT as before, or through a leader: a thin line with one end within LEADER_LABEL_PT = 6 pt of the label's box and the other within LEADER_COLUMN_PT = 8 pt of the column glyph's box. A label with TYP / TYPICAL that is not attached to any column gives its size to every unsized column of the same glyph signature on the view (state needs review, evidence `typical_note`). Column schedule tables stay for later. |

Pages with no scale and pages that are not plans are counted per path in the auto run's totals:
`scale_from_dimensions`, `scale_needed`, `not_a_plan`.

## 2. Held-out count check (pre-registered; this section is committed before any run)

**Theirs.** The estimators' summary box: on each marked-up set, the FreeText annotation with the
most lines of the form `<kind> - <number>` that also names columns or beams. Every line is parsed into
(kind as written, number as written); a number that is not a plain integer (for example `37~20`) is
kept raw and NOT compared. Kinds map by fixed words: Columns -> Column; Beams -> Beams; Vertical
Brace(s) -> Vertical braces; Horizontal Brace(s) -> Horizontal braces; Girts -> Girts; Posts ->
Posts; Piles / HP piles -> Piles; Joists -> Joists. Other kinds are listed, not compared.

Jobs: every job whose marked-up set has a summary box AND a drawing project: job-002, 003, 004, 005,
006, 008, 010, 011, 012, 013, 014, 015, 017, 018, 019, 020 (16). Marked-up sets with a box but no
drawing project (takeoff-02, -08, -20) and without a box (takeoff-01, -13) are listed, not run.

**Ours.** A fresh copy `p12b-<job>` of each job (`tools.copy_project`, preview first), auto mode
with `phase12b-build-v1`. Per job and kind, the pieces of the frozen system version: Column = kind
Column on column-plan pages; Beams = kind Beams; Piles = kind Piles; Joists = kind Joist; braces,
girts, posts = pieces of those kinds (the build makes none: 0). **Primary:** every piece of the
kind, duplicates left out. **Secondary:** the main total only (found and needs review, duplicates
left out).

**Measures.** Per job and kind: ours, theirs, ours - theirs, (ours - theirs) / theirs.
"Within 20%" = |ours - theirs| <= 0.2 x theirs. Headline: the number of jobs with columns within
20% and with beams within 20%; the median of |% error| and of the signed % error per kind.
Reported in three groups: **seen** (job-015, job-018, job-020: used in Phase 12a), **Phase 7 dev**
(job-002, 003, 005, 006, 010, 011, 012, 013, 014: rules of Phase 7 were tuned on them, not used
since), **strict held-out** (job-004, 008, 017, 019: never a dev job). "All others" = the last two
groups together.

**job-018 buckets (old section 6b).** The estimators' count symbols per page (Polygon with 3 or 8
corners) by tag prefix (the nearest FreeText within the tag study's radius, leading letters, as in
`tools/takeoff/prefix_inventory.py`; B -> Beams, C -> Column; other prefixes listed by prefix). The
difference ours - theirs per kind is split into: (a) our pieces on pages where they placed no
symbol; (b) per-kind differences on pages both counted; (c) duplicates merged (rule 5); (d)
non-steel removed by the 12a and 12b rules (rule counts of the build runs: walls, plates, dash
patterns, grid markers, column-plan beams, joists); (e) the rest, unexplained. Over-count and
under-count tables each add up to the total difference.

**Gallery.** The 5 built pages of the non-seen jobs with the largest |our pieces - their symbols| on
the page: drawing / ours / their markup, both counts in the caption.

**Rules of the run.** No constant is changed after any of these runs. A crash fix that does not use
the results is allowed and reported as a deviation with its commit. The verdict words are counts
only; no "accuracy" is claimed for the seen group.
