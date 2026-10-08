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
    included: boolean;
    source: "default" | "person";
    override: "include" | "exclude" | null;
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
  joist_series: {
    series: "K" | "LH" | "DLH";
    canonical: string;
    depth: string;
    number: string;
  } | null;
  shared_line: SharedLine | null;
  merged_into: string | null;
  not_member: { reason: string } | null;
}

export interface SharedLine {
  group: string;
  size: number;
  best: boolean;
  resolution: "separate" | null;
  resolved: boolean;
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
  quantity: number;
  members: number;
  total_length_mm: number | null;
  total_length_ft_in: string | null;
  unmeasured: number;
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
  pieces: number;
  members: number;
  total_length_mm: number;
  total_length_ft_in: string;
  unmeasured: number;
}

export interface TakeoffSection {
  rows: TakeoffRow[];
  by_level: { level: string | null; totals: TakeoffTotals }[];
  totals: TakeoffTotals;
  excluded_red: TakeoffTotals;
  possible_duplicates: TakeoffTotals;
}

export interface TakeoffData extends TakeoffSection {
  joists: TakeoffSection;
  grades?: { family: string; grade: string; set_by: string; set_at: string }[];
  sheets?: {
    sheet_id: string;
    page_number: number;
    sheet_number: string | null;
    page_type: string | null;
    included: boolean;
    source: "default" | "person";
    members_not_counted: number;
  }[];
  unlinked_labels: {
    count: number;
    by_sheet: { sheet_id: string; page_number: number | null; count: number }[];
  };
}
