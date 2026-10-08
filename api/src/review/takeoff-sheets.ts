// Which sheets take part in the takeoff (Phase 5b item 4). Only framing plans are included by
// default, because the page type is a guess and the other types (foundation plans, elevations,
// details, schedules, notes, other) hold repeated or non-framing labels. A person can switch any
// sheet to "include" (or a framing plan to "exclude"); that is a sheet_edits row, latest wins.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadSheetOverrides } from './overrides.js';

export type TakeoffOverride = 'include' | 'exclude' | null;

export const DEFAULT_INCLUDED_PAGE_TYPE = 'framing_plan';

export interface SheetInclusion {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  page_type: string | null;
  included: boolean;
  /** `default` = the page type decides, `person` = a person switched it. */
  source: 'default' | 'person';
}

export function inclusionOf(
  pageType: string | null,
  override: string | null | undefined,
): { included: boolean; source: 'default' | 'person' } {
  if (override === 'include') return { included: true, source: 'person' };
  if (override === 'exclude') return { included: false, source: 'person' };
  return { included: pageType === DEFAULT_INCLUDED_PAGE_TYPE, source: 'default' };
}

export async function loadSheetInclusions(
  db: Kysely<Database>,
  projectId: string,
): Promise<SheetInclusion[]> {
  const sheets = await db
    .selectFrom('sheets')
    .select(['id', 'page_index', 'sheet_number', 'page_type_guess'])
    .where('project_id', '=', projectId)
    .orderBy('page_index')
    .execute();
  const overrides = await loadSheetOverrides(
    db,
    sheets.map((s) => s.id),
  );
  return sheets.map((s) => {
    const o = overrides.get(s.id);
    const pageType = o?.page_type ?? s.page_type_guess;
    return {
      sheet_id: s.id,
      page_number: s.page_index + 1,
      sheet_number: s.sheet_number,
      page_type: pageType,
      ...inclusionOf(pageType, o?.takeoff),
    };
  });
}
