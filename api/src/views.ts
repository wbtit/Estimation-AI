// JSON shapes returned by the project and sheet endpoints. NUMERIC columns arrive from pg as
// strings and are converted to numbers here.
import type { Selectable } from 'kysely';
import type { ProjectFilesTable, ProjectsTable } from './db/types.js';

export function projectView(
  project: Selectable<ProjectsTable>,
  file: Selectable<ProjectFilesTable> | null,
) {
  return {
    id: project.id,
    name: project.name,
    number: project.number,
    status: project.status,
    stage: project.stage,
    archived: project.archived,
    purpose: project.purpose,
    last_opened_at: project.last_opened_at,
    design_standard: project.design_standard,
    unit_system: project.unit_system,
    location: project.location,
    client: project.client,
    building_type: project.building_type,
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
