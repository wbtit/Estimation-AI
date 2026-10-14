// The Stage 1 tables (V1_UI_SPEC section 3): per page and for the job, in the estimator's columns,
// with a Kind column first and a summary by kind. EVERYTHING is computed from the members (their
// effective values after every correction); nothing here is stored or edited by hand.
//
// Stage 1 rules: Length ft, Length In and Total W are EMPTY (lengths come in Stage 2); SHAPE and
// Unit W come only from the catalog (a profile that is not in it leaves Unit W empty and makes the
// row amber); Grade is the person-set grade of the shape family, never filled in by the system
// (the family default of the estimators' finished takeoff is only SHOWN as a suggestion); red
// pieces are not in any total and are summed on their own line; excluded kinds are listed as
// "not counted"; misc kinds are reserved and listed, not computed.
import type { KindIndex } from './kinds.js';
import type { GradeRule } from './grades.js';
import { familyOf } from './grades.js';
import type { MemberView } from './members.js';
import type { ShapeFamily } from '../db/types.js';

/** Shown as a flag only, never applied (the estimators' finished takeoff used these by family). */
export const GRADE_SUGGESTION: Partial<Record<string, string>> = { HSS: 'A500', W: 'A992' };

export type RowColour = 'green' | 'amber' | 'grey';

export interface SheetInfo {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  included: boolean;
}

export interface TableRow {
  key: string;
  kind: string | null;
  quantity: number;
  /** First sheet's number plus how many other sheets contribute (job table). */
  reference: string;
  sheets: number[];
  shape: string | null;
  size: string | null;
  name: string;
  /** True while the Name is the system's wording (the kind), not something a person typed. */
  name_is_system: boolean;
  /** Phase 8 Part C: filled only from a two-click measurement (decimal feet, and inches); else null. */
  length_ft: number | null;
  length_in: number | null;
  unit_w: number | null;
  /** Quantity x length (ft) x Unit W (lb/ft), only when the row has a measured length and a Unit W. */
  total_w: number | null;
  grade: string | null;
  grade_suggestion: string | null;
  colour: RowColour;
  flags: string[];
  tags: string[];
  member_ids: string[];
}

export interface Apart {
  pieces: number;
  by_kind: { kind: string | null; pieces: number }[];
  member_ids: string[];
}

/** Phase 8: pieces the system found that nobody has decided yet (count mode only; never in a total). */
export type Suggested = Apart;

export interface PageTable {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  rows: TableRow[];
  quantity: number;
  red: Apart;
  existing: Apart;
  not_counted: Apart;
  misc: Apart;
  suggested: Suggested;
  unlinked: number;
}

export interface KindSummary {
  kind: string | null;
  scope: 'main' | 'misc' | 'excluded' | null;
  /** Pieces counted in the total (main kinds and pieces with no kind yet). */
  quantity: number;
  groups: number;
  note: string | null;
}

export interface JobTable {
  rows: TableRow[];
  quantity: number;
  summary: KindSummary[];
  red: Apart;
  existing: Apart;
  not_counted: Apart;
  misc: Apart;
  suggested: Suggested;
  unlinked: number;
  sheets_excluded: number[];
}

const RANK: Record<RowColour, number> = { green: 0, grey: 1, amber: 2 };

function writtenFamily(profile: string | null): string | null {
  const m = profile ? /^[A-Za-z]+/.exec(profile) : null;
  return m ? m[0].toUpperCase() : null;
}

function sizeOf(m: MemberView): string | null {
  if (m.profile) return m.profile.replace(/^[A-Za-z]+/, '') || m.profile;
  return m.profile_raw;
}

function emptyApart(): Apart {
  return { pieces: 0, by_kind: [], member_ids: [] };
}

function addApart(a: Apart, m: MemberView): void {
  a.pieces += 1;
  a.member_ids.push(m.id);
  const hit = a.by_kind.find((k) => k.kind === m.kind.name);
  if (hit) hit.pieces += 1;
  else a.by_kind.push({ kind: m.kind.name, pieces: 1 });
}

/** The pieces of a table, split into the counted ones and the lines listed apart. */
export function classify(
  members: readonly MemberView[],
  includedSheets: ReadonlySet<string>,
  countMode = false,
) {
  const counted: MemberView[] = [];
  const suggested = emptyApart();
  const red = emptyApart();
  const existing = emptyApart();
  const notCounted = emptyApart();
  const misc = emptyApart();
  let unlinked = 0;
  for (const m of members) {
    if (!m.sheet_id || !includedSheets.has(m.sheet_id)) continue;
    if (m.deleted || m.merged_into !== null || m.not_member !== null) continue;
    if (m.count.state === 'rejected') continue; // a rejected suggestion is kept, never counted
    if (m.existing) {
      addApart(existing, m);
    } else if (m.counting === 'not_counted') {
      addApart(notCounted, m);
    } else if (m.counting === 'misc_reserved') {
      addApart(misc, m);
    } else if (m.status.color === 'unlinked') {
      unlinked += 1;
    } else if (countMode && m.count.state !== 'confirmed') {
      addApart(suggested, m); // count mode: only confirmed pieces are in the totals
    } else if (m.status.color === 'red') {
      addApart(red, m);
    } else {
      counted.push(m);
    }
  }
  return { counted, red, existing, notCounted, misc, suggested, unlinked };
}

function buildRows(
  pieces: readonly MemberView[],
  sheetOf: ReadonlyMap<string, SheetInfo>,
  grades: ReadonlyMap<ShapeFamily, GradeRule>,
  nameOf: (m: MemberView) => string | null,
  kinds: KindIndex,
): TableRow[] {
  const groups = new Map<string, TableRow>();
  for (const m of pieces) {
    const shape = m.catalog?.found ? m.catalog.shape : writtenFamily(m.profile);
    const size = sizeOf(m);
    const typed = nameOf(m);
    const name = typed ?? m.kind.name ?? '';
    // a measured length (two clicks) splits rows: pieces of one size and length make one row
    const measuredMm = m.length_source === 'measured_manual' ? m.length_mm : null;
    const lengthKey = measuredMm === null ? '' : String(Math.round((measuredMm / 25.4) * 8));
    const key = [m.kind.name ?? '', shape ?? '', size ?? '', name, lengthKey].join('|');
    const sheet = sheetOf.get(m.sheet_id as string);
    const colour: RowColour =
      m.symbol_color === 'grey' ? 'grey' : m.status.color === 'amber' ? 'amber' : 'green';
    let row = groups.get(key);
    if (!row) {
      const family = familyOf(m);
      const rule = family ? grades.get(family) : undefined;
      const suggestion = family ? (GRADE_SUGGESTION[family] ?? null) : null;
      row = {
        key,
        kind: m.kind.name,
        quantity: 0,
        reference: '',
        sheets: [],
        shape,
        size,
        name,
        name_is_system: typed === null,
        length_ft: measuredMm === null ? null : Math.round((measuredMm / 304.8) * 100) / 100,
        length_in: measuredMm === null ? null : Math.round((measuredMm / 25.4) * 10) / 10,
        unit_w: m.catalog?.found ? m.catalog.unit_w_lb_ft : null,
        total_w: null,
        grade: rule?.grade ?? null,
        grade_suggestion: rule ? null : suggestion,
        colour,
        flags: [],
        tags: [],
        member_ids: [],
      };
      groups.set(key, row);
    }
    row.quantity += 1;
    row.member_ids.push(m.id);
    if (m.tag.text) row.tags.push(m.tag.text);
    if (sheet && !row.sheets.includes(sheet.page_number)) row.sheets.push(sheet.page_number);
    if (RANK[colour] > RANK[row.colour]) row.colour = colour;
  }
  const rows = [...groups.values()];
  for (const r of rows) {
    if (r.length_ft !== null && r.unit_w !== null) {
      r.total_w = Math.round(r.quantity * r.length_ft * r.unit_w * 10) / 10;
    }
    r.sheets.sort((a, b) => a - b);
    const first = r.sheets[0];
    const info = [...sheetOf.values()].find((s) => s.page_number === first);
    const label = info?.sheet_number ?? (first === undefined ? '' : `p${first}`);
    r.reference = r.sheets.length > 1 ? `${label} (+${r.sheets.length - 1})` : label;
    const sample = pieces.find((m) => r.member_ids[0] === m.id) as MemberView;
    if (sample.catalog && !sample.catalog.found && sample.profile) {
      r.flags.push('not in catalog');
      if (RANK.amber > RANK[r.colour]) r.colour = 'amber';
    }
    if (!sample.profile) {
      r.flags.push('size not parsed');
      if (RANK.amber > RANK[r.colour]) r.colour = 'amber';
    }
    if (r.kind === null) r.flags.push('no kind');
    if (r.name_is_system && r.kind) r.flags.push('system wording');
    if (r.grade === null && r.grade_suggestion)
      r.flags.push(`grade not set (suggested ${r.grade_suggestion}, not applied)`);
    else if (r.grade === null) r.flags.push('grade not set');
  }
  const order = (k: string | null) => (k === null ? 1e6 : (kinds.get(k)?.sort ?? 1e5));
  rows.sort(
    (a, b) =>
      order(a.kind) - order(b.kind) ||
      (a.shape ?? '~').localeCompare(b.shape ?? '~') ||
      (a.size ?? '~').localeCompare(b.size ?? '~', undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

export interface TableInput {
  members: readonly MemberView[];
  sheets: readonly SheetInfo[];
  kinds: KindIndex;
  grades: ReadonlyMap<ShapeFamily, GradeRule>;
  /** The typed Name of a piece (an edit), or null for the system wording. */
  nameOf: (m: MemberView) => string | null;
  /** Count mode (Phase 8): only confirmed pieces are counted; undecided suggestions are listed apart. */
  countMode?: boolean;
}

export function buildPageTables(input: TableInput): PageTable[] {
  const out: PageTable[] = [];
  const sheetOf = new Map(input.sheets.map((s) => [s.sheet_id, s] as const));
  for (const s of [...input.sheets]
    .filter((x) => x.included)
    .sort((a, b) => a.page_number - b.page_number)) {
    const mine = input.members.filter((m) => m.sheet_id === s.sheet_id);
    const c = classify(mine, new Set([s.sheet_id]), input.countMode ?? false);
    if (mine.length === 0) continue;
    const rows = buildRows(c.counted, sheetOf, input.grades, input.nameOf, input.kinds);
    out.push({
      sheet_id: s.sheet_id,
      page_number: s.page_number,
      sheet_number: s.sheet_number,
      rows,
      quantity: rows.reduce((n, r) => n + r.quantity, 0),
      red: c.red,
      existing: c.existing,
      not_counted: c.notCounted,
      misc: c.misc,
      suggested: c.suggested,
      unlinked: c.unlinked,
    });
  }
  return out;
}

export function buildJobTable(input: TableInput): JobTable {
  const sheetOf = new Map(input.sheets.map((s) => [s.sheet_id, s] as const));
  const included = new Set(input.sheets.filter((s) => s.included).map((s) => s.sheet_id));
  const c = classify(input.members, included, input.countMode ?? false);
  const rows = buildRows(c.counted, sheetOf, input.grades, input.nameOf, input.kinds);
  const summary: KindSummary[] = [];
  const line = (kind: string | null, scope: KindSummary['scope'], note: string | null) => {
    const mine = rows.filter((r) => r.kind === kind);
    summary.push({
      kind,
      scope,
      quantity: mine.reduce((n, r) => n + r.quantity, 0),
      groups: mine.length,
      note,
    });
  };
  for (const k of input.kinds.values()) if (k.scope === 'main') line(k.kind, 'main', null);
  line(null, null, 'kind not set yet: choose it');
  const apartLine = (a: Apart, scope: 'misc' | 'excluded', note: string) => {
    for (const k of input.kinds.values()) {
      if (k.scope !== scope) continue;
      const n = a.by_kind.find((x) => x.kind === k.kind)?.pieces ?? 0;
      if (n > 0) summary.push({ kind: k.kind, scope, quantity: n, groups: 0, note });
    }
  };
  apartLine(c.misc, 'misc', 'not computed (misc steel is reserved)');
  apartLine(c.notCounted, 'excluded', 'not counted');
  return {
    rows,
    quantity: rows.reduce((n, r) => n + r.quantity, 0),
    summary,
    red: c.red,
    existing: c.existing,
    not_counted: c.notCounted,
    misc: c.misc,
    suggested: c.suggested,
    unlinked: c.unlinked,
    sheets_excluded: input.sheets.filter((s) => !s.included).map((s) => s.page_number),
  };
}
