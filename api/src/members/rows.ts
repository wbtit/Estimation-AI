// Maps between database rows (db/migrations/001) and contract members (schema v0).
// The contract is nested; the table is flat. NUMERIC columns arrive from pg as strings.
import type { Insertable, Selectable } from 'kysely';
import { memberSchema, type Member } from '../contract/index.js';
import type { MemberOrigin, MembersTable } from '../db/types.js';

export type MemberRow = Selectable<MembersTable>;

const num = (v: string | null): number | null => (v === null ? null : Number(v));

function xyz(
  x: string | null,
  y: string | null,
  z: string | null,
): [number, number, number] | null {
  return x === null || y === null || z === null ? null : [Number(x), Number(y), Number(z)];
}

/**
 * Row -> contract member. The result is validated against the contract, so a stored row that
 * violates it throws a ZodError instead of flowing into the validator or BOM.
 * Review edits are not applied in Phase 1 (docs/OPEN_QUESTIONS.md item 10 and the Decision Log).
 */
export function rowToMember(row: MemberRow): Member {
  return memberSchema.parse({
    member_id: row.member_id,
    type: row.type,
    mark: row.mark,
    profile_raw: row.profile_raw,
    profile: row.profile,
    material: row.material,
    grade: row.grade,
    start: {
      grid_x: row.start_grid_x,
      grid_y: row.start_grid_y,
      offset_x_mm: num(row.start_offset_x_mm),
      offset_y_mm: num(row.start_offset_y_mm),
      elevation_mm: num(row.start_elevation_mm),
      resolved_xyz_mm: xyz(row.start_x_mm, row.start_y_mm, row.start_z_mm),
      resolution_method: row.start_resolution_method,
    },
    end: {
      grid_x: row.end_grid_x,
      grid_y: row.end_grid_y,
      offset_x_mm: num(row.end_offset_x_mm),
      offset_y_mm: num(row.end_offset_y_mm),
      elevation_mm: num(row.end_elevation_mm),
      resolved_xyz_mm: xyz(row.end_x_mm, row.end_y_mm, row.end_z_mm),
      resolution_method: row.end_resolution_method,
    },
    level: row.level,
    rotation_deg: num(row.rotation_deg),
    camber_raw: row.camber_raw,
    camber_mm: num(row.camber_mm),
    studs: row.studs,
    quantity: row.quantity,
    supported_by: row.supported_by,
    connection_hint:
      row.connection_type === null && row.connection_raw === null
        ? null
        : { type: row.connection_type, raw_text: row.connection_raw },
    coating: row.coating,
    source: {
      sheet_id: row.sheet_id,
      bbox: row.source_bbox,
      callout_ref: row.source_callout_ref,
      fields: row.field_sources,
    },
    confidence: { overall: num(row.confidence), fields: row.field_confidence },
    status: { color: row.status_color, reason: row.status_reason },
    review: { status: row.review_status, edits: [] },
  });
}

/** Contract member -> insertable row. Used by seeds and tests. */
export function memberToInsertRow(
  projectId: string,
  member: Member,
  options: { origin: MemberOrigin; sheetId?: string | null },
): Insertable<MembersTable> {
  const { start, end } = member;
  return {
    project_id: projectId,
    sheet_id: options.sheetId ?? null,
    member_id: member.member_id,
    origin: options.origin,
    type: member.type,
    mark: member.mark,
    profile_raw: member.profile_raw,
    profile: member.profile,
    material: member.material,
    grade: member.grade,
    start_grid_x: start.grid_x,
    start_grid_y: start.grid_y,
    start_offset_x_mm: start.offset_x_mm,
    start_offset_y_mm: start.offset_y_mm,
    start_elevation_mm: start.elevation_mm,
    start_x_mm: start.resolved_xyz_mm?.[0] ?? null,
    start_y_mm: start.resolved_xyz_mm?.[1] ?? null,
    start_z_mm: start.resolved_xyz_mm?.[2] ?? null,
    start_resolution_method: start.resolution_method,
    end_grid_x: end.grid_x,
    end_grid_y: end.grid_y,
    end_offset_x_mm: end.offset_x_mm,
    end_offset_y_mm: end.offset_y_mm,
    end_elevation_mm: end.elevation_mm,
    end_x_mm: end.resolved_xyz_mm?.[0] ?? null,
    end_y_mm: end.resolved_xyz_mm?.[1] ?? null,
    end_z_mm: end.resolved_xyz_mm?.[2] ?? null,
    end_resolution_method: end.resolution_method,
    level: member.level,
    rotation_deg: member.rotation_deg,
    camber_raw: member.camber_raw,
    camber_mm: member.camber_mm,
    studs: member.studs,
    quantity: member.quantity,
    supported_by: member.supported_by,
    connection_type: member.connection_hint?.type ?? null,
    connection_raw: member.connection_hint?.raw_text ?? null,
    coating: member.coating,
    source_bbox: member.source.bbox === null ? null : JSON.stringify(member.source.bbox),
    source_callout_ref: member.source.callout_ref,
    field_sources: JSON.stringify(member.source.fields),
    field_confidence: JSON.stringify(member.confidence.fields),
    confidence: member.confidence.overall,
    status_color: member.status.color,
    status_reason: member.status.reason,
    review_status: member.review.status,
  };
}
