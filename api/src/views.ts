// JSON shapes returned by the project and sheet endpoints. NUMERIC columns arrive from pg as
// strings and are converted to numbers here.
import type { Selectable } from 'kysely';
import { inclusionOf } from './review/takeoff-sheets.js';
import { singleSheetScale, wholeSheetBox } from './review/geometry.js';
import type { ProjectFilesTable, ProjectsTable, SheetsTable } from './db/types.js';

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export function projectView(
  project: Selectable<ProjectsTable>,
  file: Selectable<ProjectFilesTable> | null,
) {
  return {
    id: project.id,
    name: project.name,
    number: project.number,
    status: project.status,
    design_standard: project.design_standard,
    unit_system: project.unit_system,
    location: project.location,
    created_at: project.created_at,
    updated_at: project.updated_at,
    document: file && {
      id: file.id,
      original_filename: file.original_filename,
      size_bytes: Number(file.size_bytes),
      sha256: file.sha256,
      page_count: file.page_count,
      pages_scanned: file.pages_scanned,
      scan_status: file.scan_status,
      scan_error: file.scan_error,
      scanned_at: file.scanned_at,
    },
  };
}

export interface EffectiveScale {
  raw: string;
  ratio: number | null;
  source: 'manual' | 'pdf_text';
}

/** The manual override if set, otherwise the single scale found in the PDF, otherwise null. */
export function effectiveScale(sheet: Selectable<SheetsTable>): EffectiveScale | null {
  if (sheet.scale_override !== null) {
    return { raw: sheet.scale_override, ratio: num(sheet.scale_override_ratio), source: 'manual' };
  }
  if (sheet.scale_parsed !== null) {
    return { raw: sheet.scale_parsed, ratio: num(sheet.scale_parsed_ratio), source: 'pdf_text' };
  }
  return null;
}

/** Human overrides of guessed sheet fields (latest sheet_edits row; null = override cleared). */
export interface SheetOverrides {
  page_type?: string | null;
  level?: string | null;
  /** "include" or "exclude" a sheet from the takeoff (null = back to the page type default). */
  takeoff?: string | null;
  /** Who made the latest takeoff decision, and when. */
  takeoff_by?: string;
  takeoff_at?: string;
}

/** One click "whole sheet" view: offered only when the sheet has exactly one distinct scale. */
export function wholeSheetOffer(sheet: Selectable<SheetsTable>) {
  const scale = singleSheetScale(sheet.scales);
  const w = num(sheet.width_pt);
  const h = num(sheet.height_pt);
  if (!scale || w === null || h === null) return { available: false, scale: null, box: null };
  return { available: true, scale, box: wholeSheetBox(w, h) };
}

/** The explicit decision of the sheet (include, exclude, or undecided) and what the guess suggests. */
export function takeoffOf(sheet: Selectable<SheetsTable>, overrides: SheetOverrides) {
  const pageType = overrides.page_type ?? sheet.page_type_guess;
  return inclusionOf(pageType, overrides.takeoff, overrides.takeoff_by, overrides.takeoff_at);
}

export function sheetView(sheet: Selectable<SheetsTable>, overrides: SheetOverrides = {}) {
  const effective = effectiveScale(sheet);
  const typeOverridden = overrides.page_type !== undefined && overrides.page_type !== null;
  const levelOverridden = overrides.level !== undefined && overrides.level !== null;
  return {
    id: sheet.id,
    project_id: sheet.project_id,
    page_index: sheet.page_index,
    page_number: sheet.page_index + 1,
    sheet_number: sheet.sheet_number,
    sheet_number_source: sheet.sheet_number_source,
    title: sheet.title,
    kind: sheet.kind,
    kind_confidence: num(sheet.kind_confidence),
    kind_reason: sheet.kind_reason,
    page: {
      kind: sheet.page_kind,
      width_pt: num(sheet.width_pt),
      height_pt: num(sheet.height_pt),
      rotation: sheet.rotation,
      has_text_layer: sheet.has_text_layer,
      has_vector_paths: sheet.has_vector_paths,
      text_char_count: sheet.text_char_count,
      vector_path_count: sheet.vector_path_count,
      image_count: sheet.image_count,
      image_coverage: num(sheet.image_coverage),
    },
    scales_found: sheet.scales,
    whole_sheet: wholeSheetOffer(sheet),
    scale: {
      parsed: sheet.scale_parsed,
      parsed_ratio: num(sheet.scale_parsed_ratio),
      override: sheet.scale_override,
      override_ratio: num(sheet.scale_override_ratio),
      effective: effective && { raw: effective.raw, ratio: effective.ratio },
      source: effective?.source ?? null,
    },
    page_type: {
      effective: typeOverridden ? overrides.page_type : sheet.page_type_guess,
      guess: sheet.page_type_guess,
      reason: sheet.page_type_reason,
      overridden: typeOverridden,
    },
    level: {
      effective: levelOverridden ? overrides.level : sheet.level_guess,
      guess: sheet.level_guess,
      overridden: levelOverridden,
    },
    takeoff: takeoffOf(sheet, overrides),
    needs_review: sheet.needs_review,
    review_reasons: sheet.review_reasons,
    thumbnail_url: sheet.thumbnail_path
      ? `/api/projects/${sheet.project_id}/sheets/${sheet.id}/thumbnail`
      : null,
    scanned_at: sheet.scanned_at,
  };
}
