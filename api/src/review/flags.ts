// Flags instead of gates (Phase 6a, owner decision). Nothing blocks the pipeline; every guess a
// person has not confirmed is a flag derived from the stored state:
//   sheet in or out of the takeoff by the page type guess      (no person decision)
//   scale guessed / scale needed                               (view scale not confirmed)
//   line classes suggested, not confirmed                      (view classes not confirmed)
// "These guesses are right" is one click that sets the same confirmations a person could make one by
// one (and records a takeoff decision), so a flag disappears only because a person confirmed it.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadSheetInclusions, type SheetInclusion } from './takeoff-sheets.js';
import { pieceQuantity } from './shared-line.js';
import { loadMemberViews } from '../routes/members.js';

export type FlagCode =
  | 'SHEET_INCLUDED_BY_DEFAULT'
  | 'SHEET_EXCLUDED_BY_DEFAULT'
  | 'LIKELY_NOT_FRAMING'
  | 'SHEET_NOT_VECTOR'
  | 'NO_VIEW'
  | 'SCALE_GUESSED'
  | 'SCALE_NEEDED'
  | 'CLASSES_SUGGESTED';

export interface SheetFlag {
  code: FlagCode;
  text: string;
  view_id?: string;
}

export interface SheetFlags {
  sheet_id: string;
  page_number: number;
  included: boolean;
  by_default: boolean;
  /**
   * Pieces of the sheet on the display basis (one piece per linked line), so an outlier sheet is
   * easy to see. Live, linked members that are not existing steel; labels without a line are not
   * pieces.
   */
  piece_count: number;
  /** A vector sheet whose page type guess is not a framing plan (flag only). */
  likely_not_framing: boolean;
  flags: SheetFlag[];
  confirmed_by: string | null;
  confirmed_at: string | null;
}

const TEXT: Record<FlagCode, string> = {
  SHEET_INCLUDED_BY_DEFAULT: 'sheet included by default (every vector sheet is in)',
  SHEET_EXCLUDED_BY_DEFAULT: 'sheet excluded by default',
  LIKELY_NOT_FRAMING: 'likely not a framing sheet (page type guess); exclude it if it is not',
  SHEET_NOT_VECTOR: 'raster or unknown page: it cannot be read as vectors, so it is excluded',
  NO_VIEW: 'no view yet: the pipeline has not run on this sheet',
  SCALE_GUESSED: 'scale guessed from the printed scales, not confirmed',
  SCALE_NEEDED: 'scale needed: none was found on this sheet',
  CLASSES_SUGGESTED: 'line classes suggested, not confirmed',
};

export async function loadSheetFlags(
  db: Kysely<Database>,
  projectId: string,
  inclusions?: SheetInclusion[],
): Promise<SheetFlags[]> {
  const incl = inclusions ?? (await loadSheetInclusions(db, projectId));
  const sheets = await db
    .selectFrom('sheets')
    .select(['id', 'page_kind', 'guesses_confirmed_by', 'guesses_confirmed_at'])
    .where('project_id', '=', projectId)
    .execute();
  const views = sheets.length
    ? await db
        .selectFrom('sheet_views')
        .select(['id', 'sheet_id', 'scale_ratio', 'scale_confirmed', 'classes_confirmed'])
        .select(['structural_classes'])
        .where(
          'sheet_id',
          'in',
          sheets.map((s) => s.id),
        )
        .orderBy('created_at')
        .execute()
    : [];
  const viewsOf = new Map<string, typeof views>();
  for (const v of views) viewsOf.set(v.sheet_id, [...(viewsOf.get(v.sheet_id) ?? []), v]);
  const meta = new Map(sheets.map((s) => [s.id, s] as const));
  const pieces = new Map<string, number>();
  if (sheets.length) {
    for (const m of await loadMemberViews(db, projectId)) {
      if (m.sheet_id === null || m.deleted || m.merged_into !== null || m.not_member !== null) {
        continue;
      }
      if (m.existing || m.status.color === 'unlinked') continue;
      pieces.set(m.sheet_id, (pieces.get(m.sheet_id) ?? 0) + pieceQuantity(m));
    }
  }
  return incl.map((i) => {
    const flags: SheetFlag[] = [];
    const push = (code: FlagCode, view_id?: string) =>
      flags.push({ code, text: TEXT[code], ...(view_id ? { view_id } : {}) });
    const m = meta.get(i.sheet_id);
    if (i.by_default) {
      if (i.not_vector) push('SHEET_NOT_VECTOR');
      else push(i.included ? 'SHEET_INCLUDED_BY_DEFAULT' : 'SHEET_EXCLUDED_BY_DEFAULT');
    }
    if (i.included && i.likely_not_framing && i.by_default) push('LIKELY_NOT_FRAMING');
    if (i.included && m?.page_kind === 'vector') {
      const vs = viewsOf.get(i.sheet_id) ?? [];
      if (vs.length === 0) push('NO_VIEW');
      for (const v of vs) {
        if (!v.scale_confirmed)
          push(v.scale_ratio === null ? 'SCALE_NEEDED' : 'SCALE_GUESSED', v.id);
        if (!v.classes_confirmed) push('CLASSES_SUGGESTED', v.id);
      }
    }
    return {
      sheet_id: i.sheet_id,
      page_number: i.page_number,
      included: i.included,
      by_default: i.by_default,
      piece_count: pieces.get(i.sheet_id) ?? 0,
      likely_not_framing: i.likely_not_framing,
      flags,
      confirmed_by: m?.guesses_confirmed_by ?? null,
      confirmed_at: m?.guesses_confirmed_at
        ? new Date(m.guesses_confirmed_at as unknown as string).toISOString()
        : null,
    };
  });
}

export interface DraftStatus {
  unconfirmed_sheets: number;
  unconfirmed_included: number;
  unconfirmed_excluded_by_default: number;
  reviewed: boolean;
  label: string;
}

/** "draft, N sheets unconfirmed" while any sheet has a flag; "reviewed" when none has. */
export function draftStatus(sheets: readonly SheetFlags[]): DraftStatus {
  const open = sheets.filter((s) => s.flags.length > 0);
  const n = open.length;
  return {
    unconfirmed_sheets: n,
    unconfirmed_included: open.filter((s) => s.included).length,
    unconfirmed_excluded_by_default: open.filter((s) => !s.included).length,
    reviewed: n === 0,
    label: n === 0 ? 'reviewed' : `draft, ${n} sheet${n === 1 ? '' : 's'} unconfirmed`,
  };
}
