// Which sheets take part in the takeoff. Every sheet needs ONE EXPLICIT DECISION, include or exclude
// (Phase 5c). Until a person decides, a sheet is `undecided`: it is not in the totals, the link job
// refuses to run on it, and the takeoff lists it. The page type guess is only a suggestion shown
// pre-selected in the control (it was wrong on 6 of 24 pages, and hiding real steel is the costly
// silent error). A decision is a sheet_edits row with who and when; the latest one wins and an undo
// appends the previous value (nothing is deleted).
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadSheetOverrides } from './overrides.js';

export type Decision = 'include' | 'exclude' | 'undecided';

/** What the page type guess would suggest. Never a decision. */
export const SUGGESTED_INCLUDE_PAGE_TYPE = 'framing_plan';

export interface SheetInclusion {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  page_type: string | null;
  decision: Decision;
  /** True only after a person said include. */
  included: boolean;
  /** The suggestion from the page type guess (shown as a guess). */
  suggestion: 'include' | 'exclude';
  decided_by: string | null;
  decided_at: string | null;
}

export function decisionOf(value: string | null | undefined): Decision {
  return value === 'include' || value === 'exclude' ? value : 'undecided';
}

export function suggestionOf(pageType: string | null): 'include' | 'exclude' {
  return pageType === SUGGESTED_INCLUDE_PAGE_TYPE ? 'include' : 'exclude';
}

export function inclusionOf(
  pageType: string | null,
  override: string | null | undefined,
  by: string | null = null,
  at: string | null = null,
) {
  const decision = decisionOf(override);
  return {
    decision,
    included: decision === 'include',
    suggestion: suggestionOf(pageType),
    decided_by: decision === 'undecided' ? null : by,
    decided_at: decision === 'undecided' ? null : at,
  };
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
      ...inclusionOf(pageType, o?.takeoff, o?.takeoff_by ?? null, o?.takeoff_at ?? null),
    };
  });
}
