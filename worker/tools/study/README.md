# Phase 4e study tools (research code, not production)

Analysis scripts for the label-to-member association study (`docs/PHASE4E_ASSOCIATION_STUDY.md`, registered in `docs/PHASE4E_PREREGISTRATION.md`). Run them isolated from the repo root, for example
`worker/.venv/bin/python -I worker/tools/study/select_docs.py`. All inputs and outputs (page dumps, overlays, gold files, results) live in `fixtures/private/study/`, which is git-ignored. Documents are found through `fixtures/private/inventory_map.csv`. Nothing prints file names or text; stdout is counts only. No OCR and no model is used by any script; the page images were viewed by people or by an AI reader for annotation only.

| Script | Step | What it does |
|---|---|---|
| `select_docs.py` | 1 | choose up to 8 documents and their plan, schedule, legend and elevation pages by structure only; writes `selection.json` |
| `linework.py`, `page_dump.py` | 3 | reconstruct lines (merge touching collinear segments, chain exploded dashes), collect closed small shapes, count stroke classes per page |
| `render.py` | 2, 3 | page overviews and crops, optionally coloured by stroke class |
| `text_counts.py` | 2 | generic word and pattern counts (joist series, deck, studs, TYP notes, misc steel words) |
| `labels.py`, `sample_labels.py` | 4 | profile labels on plan pages; seeded sample of 40 per document; DESIGN / VALIDATION split written to disk first |
| `candidates.py`, `make_overlays.py` | 4 | the nearest structural lines for each label (distance only) and the annotation overlay images |
| `rules.py`, `leaders.py`, `score.py` | 4 | the pre-registered rules, leader following, tune on DESIGN and score VALIDATION exactly once |
| `spot_check.py` | 4 | validates the AI gold files and writes the 10% human spot-check list |
| `columns.py`, `column_overlay.py`, `exploratory_columns.py` | 5 | column-like closed shapes and schedule rows; overlays; a post-hoc exploratory count (not scored) |
| `selfcheck.py` | 6 | dimension strings against line lengths and arrowhead spans, mark and legend completeness, quantity notes |

Gold links are AI-annotated from overlay images. The owner is asked to confirm the 10% sample in `fixtures/private/study/human_spot_check.csv` (fill `human_gold`).
