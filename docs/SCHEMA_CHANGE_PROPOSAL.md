# Schema change proposal: members without a grid

**Status: proposal only. Nothing in `api/src/contract/`, `schema/contract.v0.schema.json`, the validator, the BOM or any members migration was changed. Waiting for your approval before any schema or migration work.**

## 1. What the test set tells us (Phase 4a, measured)
- The framing plans have **no lettered grid and no grid lines**. Members are identified by **marks** (`B1`, `B2`, `B1 CONT`, vertical `... CANT'L`) and a **legend** that maps a mark to a designation (`B1: HSS6x4x1/4`, `B2: HSS6x4x3/8 FLAT`).
- Members are **located by plan geometry** (the drawn beam line, 1.44-wide strokes, with column squares) and by **dimension strings**, not by grid intersections.
- Callouts (a detail number over a sheet number) cross-reference detail sheets.
- Elevations are expected from notes and detail text, not from a grid/level table.

## 2. What contract v0 already allows (no change needed)
| Need | v0 today |
|---|---|
| Nullable grid references | `start/end.grid_x`, `grid_y` are already `string \| null`; `project.grids` may be `[]`; the validator never requires a grid. |
| Both-end elevations | `start/end.elevation_mm` exist and the validator already flags a missing start or end elevation (and a column without a base elevation). |
| A mark | `member.mark` (string \| null). |
| Source bounding box | `member.source.bbox` and per-field `source.fields`, shaped `{x0,y0,x1,y1}` (page coordinates; defined in this phase as displayed points, origin top-left, rotation applied). |
| 3D end points | `resolved_xyz_mm` (mm) per end, with `resolution_method`. |

## 3. What is missing
1. **A coordinate frame for positions that are not grid-based.** `resolved_xyz_mm` has no stated frame. Without a grid, positions only exist relative to a plan view on one sheet (its own origin and scale), so two sheets cannot be mixed.
2. **Provenance of a plan position:** which sheet, which bounding box, which scale ratio, which method.
3. **A legend entity and the mark-to-legend link.** Today `profile_raw`/`profile` sit on the member and nothing says the profile came from a legend row for that mark.
4. **Dimension strings as data** (raw text, parsed value in mm, where it is) and a way for a member's length or position to cite one.
5. **Elevation provenance:** where an elevation came from (note, dimension string, manual).
6. **Stable references to text.** `text_items` (this phase) is rebuilt on every read, so references need a deterministic key. Added now, in `text_items.item_key` (sha-256 of the sheet and the bounding box rounded to 0.5 pt), because it is cheap and unblocks everything below.

## 4. Proposal (additive; contract version 0 -> 1)
v0 objects are strict, so any new key needs a version bump. All additions are nullable or empty, so a v0 document converts mechanically (new fields null, `schema_version` 1).

### 4.1 Endpoint (`start` / `end`)
```jsonc
{
  "grid_x": null, "grid_y": null,           // unchanged, stays nullable; offsets are only meaningful with a grid
  "offset_x_mm": null, "offset_y_mm": null, // unchanged
  "elevation_mm": 4000,                      // unchanged: required at BOTH ends by the validator
  "elevation_source": {                      // NEW (nullable)
    "kind": "note | dimension | manual",     //   "datum": free text such as "top of steel per sheet note", never defaulted
    "datum": null, "text_item_key": "…", "bbox": { "x0": 0, "y0": 0, "x1": 0, "y1": 0 }
  },
  "plan": {                                  // NEW (nullable): the position as drawn, in the plan frame
    "sheet_id": "…",
    "xy_mm": [1250.0, 840.0],                //   mm, plan frame of that sheet; origin and axes are defined below
    "bbox": { "x0": 0, "y0": 0, "x1": 0, "y1": 0 },   // where the end point was read on the page
    "scale_ratio": 48.0,                     //   the sheet scale (effective, override first) used for pt -> mm
    "method": "pdf_geometry | dimension_chain | manual"
  },
  "resolved_xyz_mm": null,                   // unchanged; meaning clarified: PROJECT frame (grid or surveyed), null until one exists
  "resolution_method": null
}
```
- **Plan frame:** per sheet, origin at the lower-left of the crop region (or page if none), x to the right, y up, millimetres, derived from displayed page points x scale ratio. Stored once on the sheet: `sheet.plan_frame = {origin_pt: [x,y], crop_region, scale_ratio}`.
- Length from plan: when `resolved_xyz_mm` is missing at both ends but both `plan.xy_mm` are on the same sheet and both elevations exist, length = the 3D distance of (x, y, elevation). This is a change to `memberLengthMm` and is listed under "Impact" for your decision, not done.

### 4.2 Legend (sheet-level) and mark linkage (member-level)
```jsonc
// document.legends[]
{ "legend_id": "…", "sheet_id": "…", "mark": "B1", "designation_raw": "HSS6x4x1/4",
  "remarks_raw": null,                      // e.g. "FLAT" as drawn, not interpreted
  "source": { "text_item_keys": ["…"], "bbox": { } } }
// member
{ "mark": "B1",
  "mark_ref": { "legend_id": "…|null", "status": "linked | no_legend_row | ambiguous",
                "source": { "text_item_key": "…", "bbox": { } } } }
```
`profile_raw` stays "exactly as on the drawing"; when linked it is copied from `designation_raw` (and `field_sources.profile_raw` points at the legend row). A mark with no legend row, or two rows, is flagged by the validator, never guessed.

### 4.3 Dimension strings (sheet-level) and use by members
```jsonc
// document.dimensions[]
{ "dimension_id": "…", "sheet_id": "…", "raw": "12'-6\"", "value_mm": 3810.0,
  "parse": "ft_in | mm | unparsed", "orientation": "horizontal | vertical",
  "source": { "text_item_key": "…", "bbox": { } } }
// member
{ "length_source": { "kind": "plan_geometry | dimension | manual", "dimension_id": "…|null" } }
```
Parsing rules would be deterministic (feet-inches fractions to 1/16, metric integers), unparseable strings stay `unparsed` and flagged.

### 4.4 Validator additions (new issue codes, severities to confirm)
`MARK_NOT_IN_LEGEND` (red), `MARK_AMBIGUOUS_LEGEND` (red), `PLAN_POSITION_MISSING` (amber while no resolved xyz), `DIMENSION_UNPARSED` (amber), `DIMENSION_LENGTH_MISMATCH` (amber: a cited dimension differs from the plan-geometry length by more than a tolerance you set). `UNSUPPORTED_MEMBER` and the column rules are unchanged.

## 5. Database changes this would need (NOT executed)
`members`: `start_plan_sheet_id`, `start_plan_x_mm`, `start_plan_y_mm`, `start_plan_bbox jsonb`, `start_plan_scale_ratio`, `start_plan_method`, the same for `end`, `start/end_elevation_source jsonb`, `mark_legend_id`, `mark_link_status`, `length_source jsonb`. `sheets`: `plan_frame jsonb`. New tables: `legends`, `dimensions`. `member_edits` keeps working unchanged (it is keyed by field name; new field names are added to the editable vocabulary in Phase 3).

## 6. Impact
| Area | Effect |
|---|---|
| Contract + JSON Schema | `schema_version` 1; regenerated; a v0 -> v1 converter. |
| Validator | The new codes above; no existing rule changes. |
| BOM | Only if you approve the plan-based length fallback; otherwise unchanged (members without `resolved_xyz_mm` stay "length unavailable"). |
| Excel | A "source" column (legend row, dimension) can be added; not required. |
| Existing data | None affected (all new fields nullable). |

## 7. Alternatives considered
- **Reuse `resolved_xyz_mm` as the plan frame** (no new fields): smallest change, but a project frame and a sheet frame are then indistinguishable and provenance has nowhere to live. Not recommended.
- **Make grid references required again** and invent a synthetic grid from column positions: rejected; it would manufacture data the drawing does not contain.
- **Store legends as plain text on the member:** rejected; the mark-to-legend link and its failure modes (missing, ambiguous) would be invisible.

## 8. Questions for you
1. Approve version 0 -> 1 with the additive fields above, or prefer a smaller subset first (suggestion: 4.1 `plan` + 4.2 legend, then 4.3 dimensions)?
2. Plan-frame origin: lower-left of the crop region as proposed, or something else?
3. May `memberLengthMm` fall back to plan xy plus elevations when no project-frame position exists (the BOM would then count such members)?
4. Severity of the new validator codes, and the tolerance for `DIMENSION_LENGTH_MISMATCH`.
5. Is "elevation datum" a free-text label per sheet note acceptable (never defaulted), or should the project carry a list of named datums?
