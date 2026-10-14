import type { Box } from "./geometry";

export interface Project {
  id: string;
  name: string;
  number: string | null;
  status: string;
  document: {
    id: string;
    page_count: number | null;
    pages_scanned: number;
    scan_status: string;
  } | null;
}

export interface Sheet {
  id: string;
  project_id: string;
  page_index: number;
  page_number: number;
  sheet_number: string | null;
  title: string | null;
  kind: string;
  page: {
    kind: string | null;
    width_pt: number | null;
    height_pt: number | null;
    rotation: number | null;
    has_text_layer: boolean | null;
  };
  scale: { effective: { raw: string; ratio: number | null } | null };
  takeoff?: {
    decision: "include" | "exclude" | "undecided";
    included: boolean;
    /** True while no person has decided: the sheet is in or out by the page type guess. */
    by_default?: boolean;
    /** What the page type guess suggests; never a decision. */
    suggestion: "include" | "exclude";
    decided_by: string | null;
    decided_at: string | null;
  };
  whole_sheet?: {
    available: boolean;
    scale: { raw: string; ratio: number } | null;
    box: Box | null;
  };
  needs_review: boolean;
  review_reasons: string[];
  thumbnail_url: string | null;
  // Phase 5 slice 2 (filled by the API once page types exist)
  page_type?: PageTypeInfo;
  level?: LevelInfo;
}

export interface PageTypeInfo {
  effective: string | null;
  guess: string | null;
  reason: string | null;
  overridden: boolean;
}

export interface LevelInfo {
  effective: string | null;
  guess: string | null;
  overridden: boolean;
}

export interface ScaleSuggestion {
  ratio: number;
  raw: string;
  where: "inside" | "near" | "sheet";
  distance_pt: number;
  alternatives: { raw: string; ratio: number; distance_pt: number }[];
  ambiguous: boolean;
}

export interface SheetView {
  id: string;
  sheet_id: string;
  name: string | null;
  box: Box;
  scale: {
    ratio: number | null;
    text: string | null;
    source: "detected_text" | "user_confirmed" | null;
    confirmed: boolean;
  };
  structural_classes: string[];
  classes_confirmed: boolean;
  class_table: ClassStat[] | null;
  suggestion: ScaleSuggestion | null;
}

export interface ParsedEntry {
  kind: string;
  raw?: string;
  canonical?: string;
  mm?: number;
  value_mm?: number | null;
  ratio?: number | null;
  [key: string]: unknown;
}

export interface TextItem {
  id: string;
  item_key: string;
  bbox: Box;
  text: string | null;
  level: "word" | "line" | null;
  angle_deg: number | null;
  orientation: string;
  methods: string[];
  parsed: ParsedEntry[] | null;
}

export interface NotesSheet {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  lines: { text: string; bbox: Box }[];
}

export type Color = "green" | "amber" | "red" | "unlinked";
/** The symbol colour: the confidence colour, or grey for a piece with no kind yet. */
export type SymbolColor = Color | "grey";
export type SymbolGroup = "linear" | "column" | "plate" | "other" | "none";

export interface KindState {
  name: string | null;
  scope: "main" | "misc" | "excluded" | null;
  state: "missing" | "ambiguous" | "guessed" | "confirmed";
  source: "keyword" | "legend" | "sheet_context" | "person" | null;
  evidence: {
    keyword: string | null;
    where: string | null;
    candidates: string[];
  } | null;
  /** A kind word seen only nearby or in the sheet title: a grey hint, the kind stays empty. */
  hint: { kind: string; keyword: string; where: string } | null;
}

export interface Tag {
  prefix: string | null;
  number: number | null;
  text: string;
  provisional: boolean;
}

export interface CatalogView {
  found: boolean;
  shape_name: string | null;
  shape: string | null;
  unit_w_lb_ft: number | null;
  via: "exact" | "numeric" | null;
  reason: string | null;
}

export interface MemberFlag {
  code: string;
  severity: "grey" | "amber" | "info";
  text: string;
}

export interface KindInfo {
  kind: string;
  scope: "main" | "misc" | "excluded";
  symbol_group: SymbolGroup;
  prefix: string;
  provisional: boolean;
  sort: number;
}

export interface SheetFlag {
  code: string;
  text: string;
  view_id?: string;
}

export interface SheetFlags {
  sheet_id: string;
  page_number: number;
  included: boolean;
  by_default: boolean;
  piece_count: number;
  likely_not_framing: boolean;
  flags: SheetFlag[];
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface DraftStatus {
  unconfirmed_sheets: number;
  unconfirmed_included: number;
  unconfirmed_excluded_by_default: number;
  reviewed: boolean;
  label: string;
}

export interface FlagsResponse {
  draft: DraftStatus;
  sheets: SheetFlags[];
  last_run: {
    status: string;
    result: Record<string, number> | null;
    error: string | null;
    started_at: string;
    finished_at: string | null;
  } | null;
}

export interface HistoryEdit {
  field: string;
  before: unknown;
  after: unknown;
  who: string;
  at: string;
  is_undo: boolean;
}

export interface Candidate {
  rank: number;
  p: [number, number];
  q: [number, number];
  score: number;
  dist: number;
  rel_angle: number;
  length_mm: number | null;
}

export interface MemberView {
  id: string;
  member_id: string;
  sheet_id: string | null;
  view_id: string | null;
  origin: string;
  type: string;
  mark: string | null;
  profile_raw: string | null;
  profile: string | null;
  quantity: number;
  level: string | null;
  deleted: boolean;
  review_status: string;
  bbox: Box | null;
  mark_ref: { status: string | null; legend_row_id: string | null };
  link: {
    source: "rule" | "person" | "none";
    confidence: "high" | "medium" | "low" | null;
    margin: number | null;
    line: { p: [number, number]; q: [number, number] } | null;
    chosen_rank: number | null;
    candidates: Candidate[];
  };
  length_mm: number | null;
  length_ft_in: string | null;
  length_source: string | null;
  status: { color: Color; confirmed: boolean; reasons: string[] };
  plan_point: { x_mm: number | null; y_mm: number | null } | null;
  system: { color: Color; confirmed: boolean; reasons: string[] } | null;
  human:
    | "unreviewed"
    | "confirmed"
    | "edited"
    | "existing"
    | "not_member"
    | "deleted";
  existing: boolean;
  joist_series: {
    series: "K" | "LH" | "DLH";
    canonical: string;
    depth: string;
    number: string;
  } | null;
  shared_line: SharedLine | null;
  length_shared: boolean;
  merged_into: string | null;
  not_member: { reason: string } | null;
  // Phase 6a
  kind: KindState;
  tag: Tag;
  symbol_group: SymbolGroup;
  symbol_color: SymbolColor;
  counting: "counted" | "misc_reserved" | "not_counted";
  catalog: CatalogView | null;
  flags: MemberFlag[];
  changed_at: string;
}

export interface SharedLine {
  group: string;
  size: number;
  best: boolean;
  resolution: "separate" | null;
  resolved: boolean;
  duplicate_of: string | null;
}

export interface ClassStat {
  key: string;
  lines: number;
  length_pt: number;
}

export interface TakeoffRow {
  key: string;
  mark: string | null;
  profile_raw: string | null;
  profile: string | null;
  level: string | null;
  family: string | null;
  grade: string;
  /** Pieces on the display basis: one piece per linked line (a label on a shared line adds 0). */
  quantity: number;
  /** Labels in the row (older basis: one piece per label). */
  labels: number;
  members: number;
  total_length_mm: number | null;
  total_length_ft_in: string | null;
  unmeasured: number;
  length_shared_pieces: number;
  unit_lengths_mm: number[];
  sheets: number[];
  color: Color;
  confirmed: boolean;
  kind: "main" | "red" | "duplicate";
  excluded: boolean;
  reasons: string[];
  source: {
    member_id: string;
    sheet_id: string | null;
    page_number: number | null;
    bbox: Box | null;
  };
  member_ids: string[];
}

export interface TakeoffTotals {
  /** One piece per linked line. */
  pieces: number;
  /** One piece per label (the older basis), for comparison. */
  labels: number;
  members: number;
  total_length_mm: number;
  total_length_ft_in: string;
  unmeasured: number;
  length_shared_pieces: number;
}

export interface TakeoffSection {
  rows: TakeoffRow[];
  by_level: { level: string | null; totals: TakeoffTotals }[];
  totals: TakeoffTotals;
  excluded_red: TakeoffTotals;
  possible_duplicates: TakeoffTotals;
}

export interface ReviewSummary {
  system: {
    green: number;
    amber: number;
    red: number;
    unlinked: number;
    added_by_person: number;
  };
  human: {
    unreviewed: number;
    confirmed: number;
    edited: number;
    existing: number;
    not_member: number;
    deleted: number;
  };
  main_total_unreviewed: {
    pieces: number;
    of_pieces: number;
    total_length_ft_in: string;
    of_length_ft_in: string;
  };
}

export interface ExistingBlock {
  rows: TakeoffRow[];
  totals: TakeoffTotals;
  by_sheet: {
    sheet_id: string | null;
    page_number: number | null;
    totals: TakeoffTotals;
  }[];
}

export interface TakeoffData extends TakeoffSection {
  existing: ExistingBlock;
  not_member_reasons: {
    existing: number;
    misc_steel: number;
    detail: number;
    other: number;
    total: number;
  };
  review: ReviewSummary;
  undecided_sheets?: { count: number; pages: number[] };
  joists: TakeoffSection;
  grades?: { family: string; grade: string; set_by: string; set_at: string }[];
  sheets?: {
    sheet_id: string;
    page_number: number;
    sheet_number: string | null;
    page_type: string | null;
    decision: "include" | "exclude" | "undecided";
    included: boolean;
    suggestion: "include" | "exclude";
    decided_by: string | null;
    decided_at: string | null;
    members_not_counted: number;
  }[];
  unlinked_labels: {
    count: number;
    by_sheet: { sheet_id: string; page_number: number | null; count: number }[];
  };
}

export interface TableRowS1 {
  key: string;
  kind: string | null;
  quantity: number;
  reference: string;
  sheets: number[];
  shape: string | null;
  size: string | null;
  name: string;
  name_is_system: boolean;
  length_ft: null;
  length_in: null;
  unit_w: number | null;
  total_w: null;
  grade: string | null;
  grade_suggestion: string | null;
  colour: "green" | "amber" | "grey";
  flags: string[];
  tags: string[];
  member_ids: string[];
}

export interface Apart {
  pieces: number;
  by_kind: { kind: string | null; pieces: number }[];
  member_ids: string[];
}

export interface PageTableS1 {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  rows: TableRowS1[];
  quantity: number;
  red: Apart;
  existing: Apart;
  not_counted: Apart;
  misc: Apart;
  unlinked: number;
}

export interface KindSummaryLine {
  kind: string | null;
  scope: "main" | "misc" | "excluded" | null;
  quantity: number;
  groups: number;
  note: string | null;
}

export interface TablesResponse {
  project: { id: string; name: string; number: string | null };
  draft: DraftStatus;
  stage_note: string;
  job: {
    rows: TableRowS1[];
    quantity: number;
    summary: KindSummaryLine[];
    red: Apart;
    existing: Apart;
    not_counted: Apart;
    misc: Apart;
    unlinked: number;
    sheets_excluded: number[];
  };
  pages: PageTableS1[];
}
