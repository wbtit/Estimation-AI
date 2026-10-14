// Kysely table types for db/migrations/001 to 005. Keep in sync with migrations.
// NUMERIC columns come back from pg as strings, so they are typed as string here.
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Numeric = ColumnType<string, number | string, number | string>;
type Json<T = unknown> = ColumnType<T, string, string>;

export interface ProjectsTable {
  id: Generated<string>;
  schema_version: Generated<number>;
  name: string;
  number: string | null;
  status: string;
  design_standard: Generated<string>;
  unit_system: Generated<string>;
  location: string | null;
  grids: Json;
  levels: Json;
  drawing_issue: string | null;
  // Phase 8 (migration 013)
  count_mode: Generated<boolean>;
  tag_scope: Generated<'job' | 'sheet'>;
  snap_radius_pt: Generated<Numeric>;
  label_radius_pt: Generated<Numeric>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type SheetKind = 'plan' | 'schedule' | 'detail' | 'notes' | 'other';
export type BuildStatus = 'not_built' | 'building' | 'built' | 'failed';

export interface SheetsTable {
  id: Generated<string>;
  project_id: string;
  sheet_number: string | null;
  title: string | null;
  kind: ColumnType<SheetKind, SheetKind | undefined, SheetKind>;
  page_index: number;
  scale_parsed: string | null;
  scale_override: string | null;
  scale_source: string | null;
  tos_notes: string | null;
  crop_region: Json | null;
  build_status: ColumnType<BuildStatus, BuildStatus | undefined, BuildStatus>;
  built_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  // Phase 2 scan results (written by the scan_pdf job; see db/migrations/002_phase2_scan.sql)
  width_pt: Numeric | null;
  height_pt: Numeric | null;
  rotation: number | null;
  page_kind: PageKind | null;
  has_text_layer: boolean | null;
  has_vector_paths: boolean | null;
  text_char_count: number | null;
  vector_path_count: number | null;
  image_count: number | null;
  image_coverage: Numeric | null;
  sheet_number_source: string | null;
  sheet_number_old: string | null;
  sheet_number_old_source: string | null;
  sheet_number_flag: 'title_block' | 'fallback_old' | null;
  kind_confidence: Numeric | null;
  kind_reason: string | null;
  scales: Json<ScaleEntry[]>;
  scale_parsed_ratio: Numeric | null;
  scale_override_ratio: Numeric | null;
  needs_review: Generated<boolean>;
  review_reasons: Generated<string[]>;
  thumbnail_path: string | null;
  text_source: 'pdf_text' | 'glyph' | 'none' | null;
  text_quality: Numeric | null;
  scan_evidence: Json | null;
  // Phase 5 (migration 005)
  page_type_guess: PageType | null;
  page_type_reason: string | null;
  level_guess: string | null;
  plan_frame: Json | null;
  guesses_confirmed_by: string | null;
  guesses_confirmed_at: Timestamp | null;
  scanned_at: Timestamp | null;
}

export type PageType =
  | 'framing_plan'
  | 'foundation_plan'
  | 'elevation'
  | 'detail'
  | 'schedule_legend'
  | 'general_notes'
  | 'other';

export interface ViewBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SheetViewsTable {
  id: Generated<string>;
  sheet_id: string;
  name: string | null;
  box: Json<ViewBox>;
  scale_ratio: Numeric | null;
  scale_source: 'detected_text' | 'user_confirmed' | null;
  scale_text: string | null;
  scale_confirmed: Generated<boolean>;
  structural_classes: Generated<string[]>;
  plan_frame: Json | null;
  class_table: Json<{ key: string; lines: number; length_pt: number }[]> | null;
  classes_confirmed: Generated<boolean>;
  structural_lines: Json<number[][]> | null;
  auto_created: Generated<boolean>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface LegendRowsTable {
  id: Generated<string>;
  project_id: string;
  sheet_id: string;
  mark: string;
  designation_raw: string;
  profile: string | null;
  remarks_raw: string | null;
  source: ColumnType<unknown, string | undefined, string>;
  created_at: Timestamp;
}

export type PageKind = 'vector' | 'scanned' | 'unknown';

/** One scale expression found on a page. ratio = real length / drawn length (null for NTS). */
export interface ScaleEntry {
  raw: string;
  kind: 'ratio' | 'nts';
  ratio: number | null;
  count: number;
}

export type ScanStatus = 'pending' | 'scanning' | 'done' | 'failed';

export interface ProjectFilesTable {
  id: Generated<string>;
  project_id: string;
  original_filename: string;
  stored_path: string;
  sha256: string;
  size_bytes: Numeric | number;
  page_count: number | null;
  pages_scanned: Generated<number>;
  scan_status: ColumnType<ScanStatus, ScanStatus | undefined, ScanStatus>;
  scan_error: string | null;
  scanned_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const SHAPE_FAMILIES = [
  'W',
  'M',
  'S',
  'HP',
  'C',
  'MC',
  'L',
  'WT',
  'MT',
  'ST',
  'HSS',
  'PIPE',
  'PL',
  'ROD',
  'joist',
] as const;
export type ShapeFamily = (typeof SHAPE_FAMILIES)[number];

/** Material/grade by shape family, set by a person (append-only, latest wins, null clears). */
export interface ProjectGradeRulesTable {
  id: Generated<string>;
  project_id: string;
  shape_family: ShapeFamily;
  grade: string | null;
  set_by: string;
  set_at: Generated<Timestamp>;
}

export interface SheetEditsTable {
  id: Generated<string>;
  sheet_id: string;
  field_name: string;
  original_value: Json | null;
  corrected_value: Json | null;
  editor: string;
  reason: string | null;
  created_at: Timestamp;
}

export interface TextItemsTable {
  id: Generated<string>;
  sheet_id: string;
  item_key: string;
  x0: Numeric;
  y0: Numeric;
  x1: Numeric;
  y1: Numeric;
  orientation: 'horizontal' | 'vertical';
  text: string | null;
  ocr_text: string | null;
  methods: Generated<string[]>;
  confidence: Numeric | null;
  agree: boolean | null;
  needs_review: Generated<boolean>;
  review_reasons: Generated<string[]>;
  char_count: Generated<number>;
  unknown_count: Generated<number>;
  font_id: string;
  angle_deg: Numeric | null;
  level: 'word' | 'line' | null;
  parsed: Json | null;
  created_at: Timestamp;
}

export type MemberType = 'beam' | 'column' | 'brace' | 'joist' | 'other';
export type MemberOrigin = 'extracted' | 'manual' | 'seed';
export type StatusColor = 'green' | 'amber' | 'red';
export type ReviewStatus = 'unreviewed' | 'approved' | 'edited' | 'rejected';

export interface MembersTable {
  id: Generated<string>;
  project_id: string;
  sheet_id: string | null;
  member_id: string;
  origin: MemberOrigin;
  type: MemberType;
  mark: string | null;
  profile_raw: string | null;
  profile: string | null;
  material: string | null;
  grade: string | null;
  start_grid_x: string | null;
  start_grid_y: string | null;
  start_offset_x_mm: Numeric | null;
  start_offset_y_mm: Numeric | null;
  start_elevation_mm: Numeric | null;
  start_elevation_raw: string | null;
  start_x_mm: Numeric | null;
  start_y_mm: Numeric | null;
  start_z_mm: Numeric | null;
  start_resolution_method: string | null;
  end_grid_x: string | null;
  end_grid_y: string | null;
  end_offset_x_mm: Numeric | null;
  end_offset_y_mm: Numeric | null;
  end_elevation_mm: Numeric | null;
  end_elevation_raw: string | null;
  end_x_mm: Numeric | null;
  end_y_mm: Numeric | null;
  end_z_mm: Numeric | null;
  end_resolution_method: string | null;
  level: string | null;
  rotation_deg: Numeric | null;
  camber_raw: string | null;
  camber_mm: Numeric | null;
  studs: number | null;
  quantity: Generated<number>;
  supported_by: Generated<string[]>;
  connection_type: string | null;
  connection_raw: string | null;
  coating: string | null;
  source_bbox: Json | null;
  source_callout_ref: string | null;
  field_sources: Json<Record<string, unknown>>;
  field_confidence: Json<Record<string, number>>;
  confidence: Numeric | null;
  status_color: StatusColor | null;
  status_reason: string | null;
  review_status: ColumnType<ReviewStatus, ReviewStatus | undefined, ReviewStatus>;
  // Phase 5 (migration 005)
  view_id: string | null;
  label_key: string | null;
  mark_ref_status: 'linked' | 'no_legend_row' | 'ambiguous' | null;
  legend_row_id: string | null;
  length_source: 'plan_geometry' | 'manual' | null;
  plan_sheet_id: string | null;
  plan_start_x_mm: Numeric | null;
  plan_start_y_mm: Numeric | null;
  plan_end_x_mm: Numeric | null;
  plan_end_y_mm: Numeric | null;
  plan_bbox: Json | null;
  plan_scale_ratio: Numeric | null;
  plan_method: 'pdf_geometry' | 'manual' | null;
  link_candidates: Json | null;
  link_confidence: 'high' | 'medium' | 'low' | null;
  link_margin: Numeric | null;
  link_rule: string | null;
  // Phase 6a (migration 010)
  kind: string | null;
  kind_source: 'keyword' | 'legend' | 'sheet_context' | 'person' | null;
  kind_confirmed: Generated<boolean>;
  kind_evidence: Json | null;
  tag_prefix: string | null;
  tag_number: number | null;
  // Phase 8 (migration 013): count state and click evidence
  count_state: ColumnType<CountState, CountState | undefined, CountState>;
  count_source: CountSource | null;
  click_x: Numeric | null;
  click_y: Numeric | null;
  click_at: Timestamp | null;
  snapped: boolean | null;
  snapped_line: Json | null;
  snapped_distance_pt: Numeric | null;
  size_source: SizeSource | null;
  size_evidence: Json | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type CountState = 'suggested' | 'confirmed' | 'rejected';
export type CountSource = 'human_click' | 'suggestion_accepted';
export type SizeSource = 'linked_label' | 'nearest_label' | 'manual' | 'none';
export type CountActionName =
  | 'create'
  | 'accept'
  | 'reject'
  | 'edit'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'measure'
  | 'attach_length'
  | 'mode';

export interface SheetLinesTable {
  sheet_id: string;
  classes: Json<string[]>;
  lines: Json<number[][]>;
  n_lines: number;
  version: string;
  created_at: Timestamp | undefined;
}

export interface CountActionsTable {
  id: Generated<string>;
  project_id: string;
  sheet_id: string | null;
  member_id: string | null;
  action: CountActionName;
  who: string;
  edit_action_id: string | null;
  detail: ColumnType<unknown, string | undefined, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface MeasurementsTable {
  id: Generated<string>;
  project_id: string;
  sheet_id: string;
  a: Json;
  b: Json;
  a_snap: Json | null;
  b_snap: Json | null;
  scale_ratio: Numeric;
  length_mm: Numeric;
  created_by: string;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  member_id: string | null;
}

export interface MemberEditsTable {
  id: Generated<string>;
  member_id: string;
  field_name: string;
  original_value: Json | null;
  corrected_value: Json | null;
  review_status: Exclude<ReviewStatus, 'unreviewed'>;
  reviewer: string;
  reason: string | null;
  action_id: string | null;
  undo_of_action_id: string | null;
  created_at: Timestamp;
}

export interface RateTableTable {
  id: Generated<string>;
  key: string;
  category: string;
  value: Numeric;
  unit: string;
  is_placeholder: Generated<boolean>;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CatalogShapesTable {
  id: Generated<string>;
  edition: string;
  shape_name: string;
  family: string;
  weight_kg_per_m: Numeric;
  weight_lb_per_ft: Numeric | null;
  properties: Json<Record<string, unknown>>;
  created_at: Timestamp;
}

export type KindScope = 'main' | 'misc' | 'excluded';
export type SymbolGroup = 'linear' | 'column' | 'plate' | 'other' | 'none';

export interface MemberKindsTable {
  kind: string;
  scope: KindScope;
  abbreviation: string | null;
  symbol_group: SymbolGroup;
  sort: number;
  provisional_prefix: string;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobsTable {
  id: Generated<string>;
  type: string;
  status: ColumnType<JobStatus, JobStatus | undefined, JobStatus>;
  payload: Json<Record<string, unknown>>;
  result: Json | null;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Database {
  projects: ProjectsTable;
  sheets: SheetsTable;
  members: MembersTable;
  member_edits: MemberEditsTable;
  rate_table: RateTableTable;
  catalog_shapes: CatalogShapesTable;
  member_kinds: MemberKindsTable;
  jobs: JobsTable;
  project_files: ProjectFilesTable;
  sheet_edits: SheetEditsTable;
  text_items: TextItemsTable;
  sheet_views: SheetViewsTable;
  legend_rows: LegendRowsTable;
  project_grade_rules: ProjectGradeRulesTable;
  sheet_lines: SheetLinesTable;
  count_actions: CountActionsTable;
  measurements: MeasurementsTable;
}
