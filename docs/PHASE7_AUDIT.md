# Phase 7 audit: what to keep for a line-first, Steel Genie-style build

Read-only audit on branch `phase-7-audit` (from `pilot-prep`). No source code, database row or migration was changed. The only outputs are this file and overlay pictures under the git-ignored `fixtures/private/shots/phase7_audit/`.

Naming note: the repository already has a "Phase 7" (`docs/PHASE7_RESULTS.md`, branch `phase-7`, the structural grammar prototype). This audit is a different piece of work; it is called "Phase 7 audit" because the request named it so.

## 0. Pre-registration of Part C (written and committed before any measurement)

Nothing in this section is changed after the measurement. Deviations, if any, are reported in Part C as deviations.

### Files used
Only PDFs under `fixtures/private/`: `job-001.pdf` and the estimators' marked-up copies in `fixtures/private/takeoffs/` (one per matched job; a marked-up copy is the drawing set plus the estimators' annotations). The job of each copy comes from the existing private `inventory.json` (Phase 5t text-fingerprint match). Jobs whose drawing is not under `fixtures/private/` are listed as "not checked"; no other folder is searched. No file, project, client or layer name is printed or written; only job ids, counts and normalised patterns.

### C1. PDF layers (every job with a file under fixtures/private)
- Per PDF: `doc.get_ocgs()` (optional content groups) and `doc.layer_ui_configs()` (the layer list shown to a user); `has_layers` = at least one OCG.
- Layer names are upper-cased and reported only as patterns: contains `BEAM`; `COL`; `GRID`; starts with `S-`; contains `FRAM`; `BRAC`; `STL` or `STEEL`; `DIM`; `TEXT` or `ANNO`; `HATCH`; contains a Bluebeam or markup word (`MARKUP`, `BLUEBEAM`, `ANNOT`).
- beam-like = `BEAM` or `FRAM`; column-like = `COL`; grid-like = `GRID`.
- Also counted, per document: the share of stroked drawing paths on sampled pages that carry a layer (`get_drawings()` field `layer` not empty), on at most the 3 pages with the most estimator symbols (job-001 has no symbols: its first 3 pages).
- Caveat stated in advance: the marked-up copies passed through Bluebeam; their layer list may differ from the original drawing file (layers added or removed). This is not checked against the originals (they are not under fixtures/private).

### C2. Line weight under the estimators' symbols (3 pages, 3 jobs)
- **Which symbols stand for beams.** The meaning of the estimators' symbol groups is not known (OPEN_QUESTIONS 98 and 124; no prefix file exists). Assumption, stated in advance: the 8-vertex polygon annotations (the "circle" group, 52% of their symbols) are the beam-like symbols; the 3-vertex ones (triangles) are left out. This is an assumption, not a fact; results are read with it.
- **Page selection (fixed before looking).** Eligible: pages of the Phase 6b set (estimator symbols present) whose stored page type guess is `framing_plan` and that carry at least 20 eight-vertex symbols. Per job, the eligible page with the most eight-vertex symbols. Three jobs are drawn from the eligible jobs, sorted by id, with `random.Random(7701).sample(jobs, 3)`.
- **Segments.** From `page.get_drawings()` on the marked-up copy (the drawing content; annotations are not part of it): every `l` item of a stroked path, and every thin filled rectangle (long side at least 8 pt, long/thin at least 8, thin side at most 6 pt; the production rule in `worker/src/linking/lines.py`) as a segment of width = thin side. All coordinates through `page.rotation_matrix`, like the symbols. Recorded per segment: width, stroke colour (RGB rounded to 0.01), dash pattern (as given by the PDF), layer name (pattern only), length.
- **Clusters.** Width cluster = width rounded to 0.01 pt. Full cluster = (width cluster, colour, dash pattern).
- **Near a symbol.** A segment is beam-near when its point-to-segment distance to an eight-vertex symbol centre is at most 12 pt (24 pt as sensitivity).
- **Baselines.** (a) all segments of the page; (b) all segments inside the box around the page's eight-vertex symbols expanded by 72 pt; (c) a chance control: the same symbols displaced 60 to 200 pt in a random direction (20 replicates, seed 7702), segments near those points.
- **Top cluster.** T1 = the heaviest-width SOLID full cluster with at least 20 segments on the page (the "heavier pen" idea). T2 = the full cluster that holds the largest share of beam-near length (chosen from the near data, so descriptive only).
- **Verdict per page (T1 only), fixed in advance.** "Distinct" when T1 holds at least 50% of the beam-near length AND its near share is at least 2 times its share of all segment length (baseline a) AND at least 1.5 times its share in the displaced control (c). Otherwise "not distinct". The same numbers are reported by segment count.
- **Fragmentation.** Anchor per symbol: the nearest T1 segment within 12 pt (if none: the symbol has no T1 anchor, counted). From the anchor, collinear T1 segments (direction within 1 degree, perpendicular offset at most 1 pt) are projected on the anchor's axis, overlapping parts merged, and chained outward while the gap to the next piece is at most G = 24 pt (6 and 72 pt as sensitivity). Reported: source segments per chain (median, 90th percentile), gaps per chain, gap size (median, 90th percentile of gaps above 0.5 pt), chain length. The same is repeated with the anchor taken from any cluster (nearest segment of any cluster within 12 pt, chained within its own full cluster), descriptive.
- **Overlays.** One PNG per page in `fixtures/private/shots/phase7_audit/`: the page rendered faint, segments drawn in a colour per width cluster (the 8 most frequent width clusters by length; others grey), eight-vertex symbols as rings, a legend with widths only. I do not view the pictures (no approval to view page images in this task); they are for the owner.

### What would change the plan (read in advance)
- If T1 is "distinct" on all 3 pages: a pen-weight filter is a usable first step for beam lines on these drawings.
- If "not distinct" on 2 or more pages: pen weight alone does not isolate beam lines; a person's crop and class choice, or the labels, must do the selection (as Phases 5 to 7 found).
- If layers with beam, column or grid names exist on most jobs: layers are a cheaper signal than pen weight and should be read first.
