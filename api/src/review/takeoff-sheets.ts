// Which sheets take part in the takeoff. Phase 6b (owner decision, replaces the Phase 6a page type
// default): a sheet with no person decision is `undecided` and is INCLUDED BY DEFAULT when it is a
// vector page, whatever its page type guess says (the guess left out 66 of the 136 pages the
// estimators marked). A raster or unknown page stays excluded by default, with a flag. The page type
// guess only raises the flag "likely not a framing sheet" so outliers are one click away. The flag
// stays until a person decides or clicks "these guesses are right". A decision is a
// sheet_edits row with who and when; the latest one wins and an undo appends the previous value
// (nothing is deleted).
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
  /** True after a person said include, or when nobody decided and the guess says include. */
  included: boolean;
  /** True while no person has decided (the sheet is in or out by the page type guess). */
  by_default: boolean;
  /** The suggestion from the page type guess (shown as a guess). */
  suggestion: 'include' | 'exclude';
  /** The page is a raster or unknown page: it cannot be read as vectors and is excluded by default. */
  not_vector: boolean;
  /** A vector sheet whose page type guess is not a framing plan (flag only, the sheet is still in). */
  likely_not_framing: boolean;
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
  pageKind: string | null = 'vector',
) {
  const decision = decisionOf(override);
  const vector = pageKind === 'vector';
  return {
    decision,
    included: decision === 'include' || (decision === 'undecided' && vector),
    not_vector: !vector,
    likely_not_framing: vector && suggestionOf(pageType) !== 'include',
    by_default: decision === 'undecided',
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
    .select(['id', 'page_index', 'sheet_number', 'page_type_guess', 'page_kind'])
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
      ...inclusionOf(
        pageType,
        o?.takeoff,
        o?.takeoff_by ?? null,
        o?.takeoff_at ?? null,
        s.page_kind,
      ),
    };
  });
}
