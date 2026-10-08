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
  /** Sum of quantity x unit length over the members with a TRUSTED length; null when none has one. */
  total_length_mm: number | null;
  total_length_ft_in: string | null;
  /** Number of pieces that have no length. */
  unmeasured: number;
  /** Pieces on a shared line: counted, but their length is not in total_length_mm. */
  length_shared_pieces: number;
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
  /** Length of the pieces whose length is trusted (a line shared with other members is not). */
  total_length_mm: number;
  total_length_ft_in: string;
  /** Pieces with no length at all. */
  unmeasured: number;
  /** Pieces on a line shared with other members: counted as pieces, their length is NOT in the length. */
  length_shared_pieces: number;
}

/** One section of the takeoff: its rows and its totals. */
export interface TakeoffSection {
  rows: TakeoffRow[];
  by_level: { level: string | null; totals: TakeoffTotals }[];
  totals: TakeoffTotals;
  excluded_red: TakeoffTotals;
  /** True duplicate candidates (same line, same profile, labels at one spot): out of the main total until a person decides. */
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
    existing: number;
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

/** Existing steel: listed, not counted. Its length is the trusted length only. */
export interface ExistingBlock {
  rows: TakeoffRow[];
  totals: TakeoffTotals;
  by_sheet: { sheet_id: string | null; page_number: number | null; totals: TakeoffTotals }[];
}

/** How many labels were marked "not a member", per reason (labels only, no lengths). */
export interface NotMemberReasons {
  existing: number;
  misc_steel: number;
  detail: number;
  other: number;
  total: number;
}

export interface Takeoff extends TakeoffSection {
  /** Existing steel (a member state, not a reason): by sheet, outside every total above. */
  existing: ExistingBlock;
  not_member_reasons: NotMemberReasons;
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
    length_shared_pieces: 0,
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
  t.length_shared_pieces += row.length_shared_pieces;
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
  // existing steel is listed in its own block and is not counted anywhere else
  const existing = live.filter((m) => m.existing);
  const counted = live.filter((m) => !m.existing);
  const unlinked = new Map<string, number>();
  for (const m of counted) {
    if (m.status.color !== 'unlinked') continue;
    const sid = m.sheet_id ?? '';
    unlinked.set(sid, (unlinked.get(sid) ?? 0) + 1);
  }
  const linked = counted.filter((m) => m.status.color !== 'unlinked');
  return {
    review: reviewSummary(members),
    existing: existingBlock(existing, pageOf, grades),
    not_member_reasons: notMemberReasons(members),
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

function existingBlock(
  members: MemberView[],
  pageOf: Map<string, number>,
  grades: Map<string, string>,
): ExistingBlock {
  const sec = section(
    members.filter((m) => m.status.color !== 'unlinked' || m.profile !== null),
    pageOf,
    grades,
    true,
  );
  const totals = emptyTotals();
  const sheets = new Map<string | null, TakeoffTotals>();
  for (const row of sec.rows) {
    add(totals, row);
    const sid = row.source.sheet_id;
    const t = sheets.get(sid) ?? emptyTotals();
    add(t, row);
    sheets.set(sid, t);
  }
  const rows = [...sec.rows].sort(
    (x, y) =>
      (x.source.page_number ?? 0) - (y.source.page_number ?? 0) ||
      compare(x.profile ?? x.profile_raw, y.profile ?? y.profile_raw),
  );
  return {
    rows,
    totals: finish(totals),
    by_sheet: [...sheets.entries()]
      .map(([sheet_id, t]) => ({
        sheet_id,
        page_number: sheet_id ? (pageOf.get(sheet_id) ?? null) : null,
        totals: finish(t),
      }))
      .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0)),
  };
}

function notMemberReasons(members: MemberView[]): NotMemberReasons {
  const out = { existing: 0, misc_steel: 0, detail: 0, other: 0, total: 0 };
  for (const m of members) {
    if (m.deleted || m.not_member === null) continue;
    const r = m.not_member.reason as keyof typeof out;
    if (r in out && r !== 'total') out[r] += 1;
    out.total += 1;
  }
  return out;
}

function reviewSummary(members: MemberView[]): ReviewSummary {
  const system = { green: 0, amber: 0, red: 0, unlinked: 0, added_by_person: 0 };
  const human = { unreviewed: 0, confirmed: 0, edited: 0, existing: 0, not_member: 0, deleted: 0 };
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
      !m.existing &&
      m.status.color !== 'unlinked' &&
      kindOf(m) === 'main',
  );
  const sum = (list: MemberView[], f: (m: MemberView) => number) =>
    list.reduce((n, m) => n + f(m), 0);
  const length = (m: MemberView) => (m.length_shared ? 0 : (m.length_mm ?? 0)) * m.quantity;
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
  /** Existing steel: one row per sheet, and no red or duplicate split (it is not counted at all). */
  bySheet = false,
): TakeoffSection {
  const kindIn = (m: MemberView): TakeoffKind => (bySheet ? 'main' : kindOf(m));
  const groups = new Map<string, MemberView[]>();
  for (const m of members) {
    const key = JSON.stringify([
      bySheet ? m.sheet_id : null,
      m.level,
      m.mark,
      m.type === 'joist'
        ? (m.joist_series?.canonical ?? m.profile_raw)
        : (m.profile ?? m.profile_raw),
      kindIn(m),
    ]);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const rows: TakeoffRow[] = [];
  for (const [key, list] of groups) {
    const first = list[0];
    // a length on a line shared with other members is the whole line: not trusted, not added up
    const measured = list.filter((m) => m.length_mm !== null && !m.length_shared);
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
      unmeasured: list
        .filter((m) => m.length_mm === null && !m.length_shared)
        .reduce((n, m) => n + m.quantity, 0),
      length_shared_pieces: list.filter((m) => m.length_shared).reduce((n, m) => n + m.quantity, 0),
      unit_lengths_mm: [
        ...new Set(measured.map((m) => Math.round((m.length_mm as number) * 10) / 10)),
      ].sort((a, b) => a - b),
      sheets: pages,
      color,
      confirmed: list.every((m) => m.status.confirmed),
      kind: kindIn(first),
      excluded: kindIn(first) !== 'main',
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
