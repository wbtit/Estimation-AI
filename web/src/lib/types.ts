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
  where: "inside" | "near";
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

export type Color = "green" | "amber" | "red";

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
}

export interface ClassStat {
  key: string;
  lines: number;
  length_pt: number;
}
