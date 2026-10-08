// Takeoff table of the review screen: members grouped by level, mark and profile, with totals.
// A pure function of the effective member views (see members.ts). No weights and no prices.
// Red members never enter the main totals; they get their own rows and their own "excluded (red)" line.
import { mmToFeetInches } from '../units/index.js';
import type { MemberView } from './members.js';
import type { ViewBox } from '../db/types.js';
import { familyOf, GRADE_NOT_SET } from './grades.js';
import { isPossibleDuplicate } from './shared-line.js';

export type TakeoffColor = 'green' | 'amber' | 'red';

/** Profile labels with no line and no typed length. They are not members and are in no total. */
export interface UnlinkedSummary {
  count: number;
  by_sheet: { sheet_id: string; page_number: number | null; count: number }[];
}
/** main = in the totals; red = held out because red; duplicate = held out as a possible duplicate (shared line). */
export type TakeoffKind = 'main' | 'red' | 'duplicate';

export interface TakeoffRow {
  /** Stable key of the row (level, mark, profile and whether it is excluded). */
  key: string;
  mark: string | null;
  profile_raw: string | null;
  /** Canonical profile (null when the text could not be parsed). */
  profile: string | null;
  level: string | null;
  /** Shape family (W, HSS, ..., joist), or null when the profile is not parsed. */
  family: string | null;
  /** The grade a person set for the family, or "not set". Never inferred. */
  grade: string;
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
  kind: TakeoffKind;
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

/** One section of the takeoff: its rows and its totals. */
export interface TakeoffSection {
  rows: TakeoffRow[];
  by_level: { level: string | null; totals: TakeoffTotals }[];
  totals: TakeoffTotals;
  excluded_red: TakeoffTotals;
  /** Members that share a line with a better-scoring member and nobody has decided yet. */
  possible_duplicates: TakeoffTotals;
}

/**
 * Two small tables that keep the system's own result apart from what a person did, and how much of
 * the main total is still unreviewed system output. Counted over every member of the sheets in the
 * takeoff (deleted and "not a member" included, so nothing a person did is hidden).
 */
export interface ReviewSummary {
  /** The rule's own color before any human action; members a person added by hand have none. */
  system: { green: number; amber: number; red: number; unlinked: number; added_by_person: number };
  human: {
    unreviewed: number;
    confirmed: number;
    edited: number;
    not_member: number;
    deleted: number;
  };
  /** Pieces and length in the MAIN totals (steel and joists) whose member nobody has reviewed. */
  main_total_unreviewed: {
    pieces: number;
    of_pieces: number;
    total_length_mm: number;
    of_length_mm: number;
    total_length_ft_in: string;
    of_length_ft_in: string;
  };
}

export interface Takeoff extends TakeoffSection {
  review: ReviewSummary;
  /** Joists (K, LH, DLH series) are never matched to AISC and have their own section. */
  joists: TakeoffSection;
  unlinked_labels: UnlinkedSummary;
}

const KIND_ORDER: Record<TakeoffKind, number> = { main: 0, red: 1, duplicate: 2 };
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

function kindOf(m: MemberView): TakeoffKind {
  if (m.status.color === 'red') return 'red';
  return isPossibleDuplicate(m) ? 'duplicate' : 'main';
}

/** Group members into takeoff rows and add up the totals. `pageOf` maps a sheet id to its page number. */
export function buildTakeoff(
  members: MemberView[],
  pageOf: Map<string, number>,
  grades: Map<string, string> = new Map(),
): Takeoff {
  const live = members.filter((m) => !m.deleted && m.merged_into === null && m.not_member === null);
  const unlinked = new Map<string, number>();
  for (const m of live) {
    if (m.status.color !== 'unlinked') continue;
    const sid = m.sheet_id ?? '';
    unlinked.set(sid, (unlinked.get(sid) ?? 0) + 1);
  }
  const linked = live.filter((m) => m.status.color !== 'unlinked');
  return {
    review: reviewSummary(members),
    ...section(
      linked.filter((m) => m.type !== 'joist'),
      pageOf,
      grades,
    ),
    joists: section(
      linked.filter((m) => m.type === 'joist'),
      pageOf,
      grades,
    ),
    unlinked_labels: {
      count: [...unlinked.values()].reduce((a, b) => a + b, 0),
      by_sheet: [...unlinked.entries()]
        .map(([sheet_id, count]) => ({
          sheet_id,
          page_number: pageOf.get(sheet_id) ?? null,
          count,
        }))
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0)),
    },
  };
}

function reviewSummary(members: MemberView[]): ReviewSummary {
  const system = { green: 0, amber: 0, red: 0, unlinked: 0, added_by_person: 0 };
  const human = { unreviewed: 0, confirmed: 0, edited: 0, not_member: 0, deleted: 0 };
  for (const m of members) {
    human[m.human] += 1;
    if (m.system === null) system.added_by_person += 1;
    else system[m.system.color] += 1;
  }
  // main totals = linked, live, not red, not a held-out duplicate (the same rule as the sections)
  const inMain = members.filter(
    (m) =>
      !m.deleted &&
      m.merged_into === null &&
      m.not_member === null &&
      m.status.color !== 'unlinked' &&
      kindOf(m) === 'main',
  );
  const sum = (list: MemberView[], f: (m: MemberView) => number) =>
    list.reduce((n, m) => n + f(m), 0);
  const length = (m: MemberView) => (m.length_mm ?? 0) * m.quantity;
  const open = inMain.filter((m) => m.human === 'unreviewed');
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    system,
    human,
    main_total_unreviewed: {
      pieces: sum(open, (m) => m.quantity),
      of_pieces: sum(inMain, (m) => m.quantity),
      total_length_mm: r1(sum(open, length)),
      of_length_mm: r1(sum(inMain, length)),
      total_length_ft_in: mmToFeetInches(sum(open, length)),
      of_length_ft_in: mmToFeetInches(sum(inMain, length)),
    },
  };
}

function section(
  members: MemberView[],
  pageOf: Map<string, number>,
  grades: Map<string, string>,
): TakeoffSection {
  const groups = new Map<string, MemberView[]>();
  for (const m of members) {
    const key = JSON.stringify([
      m.level,
      m.mark,
      m.type === 'joist'
        ? (m.joist_series?.canonical ?? m.profile_raw)
        : (m.profile ?? m.profile_raw),
      kindOf(m),
    ]);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const rows: TakeoffRow[] = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const measured = list.filter((m) => m.length_mm !== null);
    const total = measured.reduce((sum, m) => sum + (m.length_mm as number) * m.quantity, 0);
    const color = list.reduce<TakeoffColor>((worst, m) => {
      const c = m.status.color as TakeoffColor;
      return RANK[c] > RANK[worst] ? c : worst;
    }, 'green');
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
      profile: first.type === 'joist' ? (first.joist_series?.canonical ?? null) : first.profile,
      level: first.level,
      family: familyOf(first),
      grade: grades.get(familyOf(first) ?? '') ?? GRADE_NOT_SET,
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
      kind: kindOf(first),
      excluded: kindOf(first) !== 'main',
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
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      compare(a.level, b.level) ||
      compare(a.mark, b.mark) ||
      compare(a.profile ?? a.profile_raw, b.profile ?? b.profile_raw),
  );

  const totals = emptyTotals();
  const excluded = emptyTotals();
  const duplicates = emptyTotals();
  const levels = new Map<string | null, TakeoffTotals>();
  for (const row of rows) {
    if (row.kind !== 'main') {
      add(row.kind === 'red' ? excluded : duplicates, row);
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

  return {
    rows,
    by_level,
    totals: finish(totals),
    excluded_red: finish(excluded),
    possible_duplicates: finish(duplicates),
  };
}
