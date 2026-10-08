// Human overrides of guessed sheet fields. Guesses live in sheets.page_type_guess / level_guess and
// are never overwritten; an override is an append-only sheet_edits row and the latest one wins
// (a null corrected value clears the override).
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { SheetOverrides } from '../views.js';

export const OVERRIDE_FIELDS = ['page_type', 'level', 'takeoff'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export async function loadSheetOverrides(
  db: Kysely<Database>,
  sheetIds: string[],
): Promise<Map<string, SheetOverrides>> {
  const out = new Map<string, SheetOverrides>();
  if (sheetIds.length === 0) return out;
  const rows = await db
    .selectFrom('sheet_edits')
    .select(['sheet_id', 'field_name', 'corrected_value', 'created_at', 'editor'])
    .where('sheet_id', 'in', sheetIds)
    .where('field_name', 'in', [...OVERRIDE_FIELDS])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const r of rows) {
    const cur = out.get(r.sheet_id) ?? {};
    const value = typeof r.corrected_value === 'string' ? r.corrected_value : null;
    cur[r.field_name as OverrideField] = value;
    if (r.field_name === 'takeoff') {
      cur.takeoff_by = r.editor;
      cur.takeoff_at = new Date(r.created_at as unknown as string).toISOString();
    }
    out.set(r.sheet_id, cur);
  }
  return out;
}
