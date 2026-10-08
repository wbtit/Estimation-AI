// Takeoff table of the review screen: members grouped by level, mark and profile, with totals.
// A pure function of the effective member views (see members.ts). No weights and no prices.
// Red members never enter the main totals; they get their own rows and their own "excluded (red)" line.
import { mmToFeetInches } from '../units/index.js';
import type { MemberView } from './members.js';
import type { ViewBox } from '../db/types.js';

export type TakeoffColor = 'green' | 'amber' | 'red';

export interface TakeoffRow {
  /** Stable key of the row (level, mark, profile and whether it is excluded). */
  key: string;
  mark: string | null;
  profile_raw: string | null;
  /** Canonical profile (null when the text could not be parsed). */
  profile: string | null;
  level: string | null;
  quantity: number;
  members: number;
  /** Sum of quantity x unit length over the members that have a length; null when none has one. */
  total_length_mm: number | null;
  total_length_ft_in: string | null;
  /** Number of pieces that have no length. */
  unmeasured: number;
  unit_lengths_mm: number[];
  sheets: number[];
  /** The worst color of the members in the row (red rows hold red members only). */
  color: TakeoffColor;
  confirmed: boolean;
  excluded: boolean;
  reasons: string[];
  /** First member of the row: where "click a row to jump" goes. */
  source: {
    member_id: string;
    sheet_id: string | null;
    page_number: number | null;
    bbox: ViewBox | null;
  };
  member_ids: string[];
}

export interface TakeoffTotals {
  pieces: number;
  members: number;
  total_length_mm: number;
  total_length_ft_in: string;
  unmeasured: number;
}

export interface Takeoff {
  rows: TakeoffRow[];
  by_level: { level: string | null; totals: TakeoffTotals }[];
  totals: TakeoffTotals;
  excluded_red: TakeoffTotals;
}

const RANK: Record<TakeoffColor, number> = { green: 0, amber: 1, red: 2 };

function emptyTotals(): TakeoffTotals {
  return {
    pieces: 0,
    members: 0,
    total_length_mm: 0,
    total_length_ft_in: mmToFeetInches(0),
    unmeasured: 0,
  };
}

function finish(t: TakeoffTotals): TakeoffTotals {
  const mm = Math.round(t.total_length_mm * 10) / 10;
  return { ...t, total_length_mm: mm, total_length_ft_in: mmToFeetInches(mm) };
}

function add(t: TakeoffTotals, row: TakeoffRow): void {
  t.pieces += row.quantity;
  t.members += row.members;
  t.total_length_mm += row.total_length_mm ?? 0;
  t.unmeasured += row.unmeasured;
}

/** Natural order, rows without a value last. */
const compare = (a: string | null, b: string | null): number => {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a.localeCompare(b, 'en', { numeric: true });
};

/** Group members into takeoff rows and add up the totals. `pageOf` maps a sheet id to its page number. */
export function buildTakeoff(members: MemberView[], pageOf: Map<string, number>): Takeoff {
  const groups = new Map<string, MemberView[]>();
  for (const m of members) {
    if (m.deleted) continue;
    const excluded = m.status.color === 'red';
    const key = JSON.stringify([m.level, m.mark, m.profile ?? m.profile_raw, excluded]);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const rows: TakeoffRow[] = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const measured = list.filter((m) => m.length_mm !== null);
    const total = measured.reduce((sum, m) => sum + (m.length_mm as number) * m.quantity, 0);
    const color = list.reduce<TakeoffColor>(
      (worst, m) => (RANK[m.status.color] > RANK[worst] ? m.status.color : worst),
      'green',
    );
    const pages = [
      ...new Set(
        list.flatMap((m) => {
          const p = m.sheet_id ? pageOf.get(m.sheet_id) : undefined;
          return p === undefined ? [] : [p];
        }),
      ),
    ].sort((a, b) => a - b);
    rows.push({
      key,
      mark: first.mark,
      profile_raw: first.profile_raw,
      profile: first.profile,
      level: first.level,
      quantity: list.reduce((n, m) => n + m.quantity, 0),
      members: list.length,
      total_length_mm: measured.length ? Math.round(total * 10) / 10 : null,
      total_length_ft_in: measured.length ? mmToFeetInches(total) : null,
      unmeasured: list.filter((m) => m.length_mm === null).reduce((n, m) => n + m.quantity, 0),
      unit_lengths_mm: [
        ...new Set(measured.map((m) => Math.round((m.length_mm as number) * 10) / 10)),
      ].sort((a, b) => a - b),
      sheets: pages,
      color,
      confirmed: list.every((m) => m.status.confirmed),
      excluded: color === 'red',
      reasons: [...new Set(list.flatMap((m) => m.status.reasons))],
      source: {
        member_id: first.id,
        sheet_id: first.sheet_id,
        page_number: first.sheet_id ? (pageOf.get(first.sheet_id) ?? null) : null,
        bbox: first.bbox,
      },
      member_ids: list.map((m) => m.id),
    });
  }

  rows.sort(
    (a, b) =>
      Number(a.excluded) - Number(b.excluded) ||
      compare(a.level, b.level) ||
      compare(a.mark, b.mark) ||
      compare(a.profile ?? a.profile_raw, b.profile ?? b.profile_raw),
  );

  const totals = emptyTotals();
  const excluded = emptyTotals();
  const levels = new Map<string | null, TakeoffTotals>();
  for (const row of rows) {
    if (row.excluded) {
      add(excluded, row);
      continue;
    }
    add(totals, row);
    const t = levels.get(row.level) ?? emptyTotals();
    add(t, row);
    levels.set(row.level, t);
  }
  const by_level = [...levels.entries()]
    .map(([level, t]) => ({ level, totals: finish(t) }))
    .sort((a, b) => compare(a.level, b.level));

  return { rows, by_level, totals: finish(totals), excluded_red: finish(excluded) };
}
