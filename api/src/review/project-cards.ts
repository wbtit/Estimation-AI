// The projects screen cards (migration 025). Pure: the route loads the rows, these pick the card
// picture, the page counts and the order.
//   picture   the first PLAN page with a thumbnail (a page whose first view has a column-plan or
//             framing role, else whose page type guess is a plan), so the cover sheet is not
//             shown; else the first page with a thumbnail
//   counts    plans = pages whose first view has a plan role; built = pages with a finished
//             build; reviewed = pages a person saved as reviewed
//   order     last opened (never opened: created), newest first
export interface CardSheet {
  id: string;
  page_index: number;
  thumbnail_path: string | null;
  page_type_guess: string | null;
  /** The build behaviour of the page's first view role (null: no role yet). */
  behaviour: string | null;
  built: boolean;
  reviewed: boolean;
}

const PLAN_BEHAVIOURS = new Set(['column_plan', 'framing']);

export const isPlanRole = (s: Pick<CardSheet, 'behaviour'>): boolean =>
  s.behaviour !== null && PLAN_BEHAVIOURS.has(s.behaviour);

export const isPlanGuess = (s: Pick<CardSheet, 'page_type_guess'>): boolean =>
  /_plan$/.test(s.page_type_guess ?? '');

/** The sheet whose thumbnail is the card picture, or null when no page has one. */
export function thumbnailSheet(sheets: CardSheet[]): CardSheet | null {
  const withThumb = [...sheets]
    .filter((s) => s.thumbnail_path !== null)
    .sort((a, b) => a.page_index - b.page_index);
  return withThumb.find(isPlanRole) ?? withThumb.find(isPlanGuess) ?? withThumb[0] ?? null;
}

export interface CardCounts {
  plans: number;
  built: number;
  reviewed: number;
}

export function cardCounts(sheets: CardSheet[]): CardCounts {
  return {
    plans: sheets.filter(isPlanRole).length,
    built: sheets.filter((s) => s.built).length,
    reviewed: sheets.filter((s) => s.reviewed).length,
  };
}

const time = (d: Date | string | null | undefined): number =>
  d === null || d === undefined ? -Infinity : new Date(d).getTime();

/** Last opened (else created), newest first; ties by name. */
export function sortByLastOpened<
  T extends { name: string; created_at: Date | string; last_opened_at: Date | string | null },
>(projects: T[]): T[] {
  const key = (p: T) => Math.max(time(p.last_opened_at), time(p.created_at));
  return [...projects].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}
