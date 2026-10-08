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
