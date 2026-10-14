// The pilot timing report (Phase 10 Part E): read-only, from the copilot's action log.
//
// Per sheet and per person:
//   - active time: a person's actions in time order; each gap between two of their consecutive
//     actions is given to the sheet of the LATER action; a gap longer than IDLE_SECONDS (5 minutes)
//     is not active time and is reported apart (how many, how long). So time is never counted twice
//     when a person moves between sheets.
//   - actions by name: pieces created (clicks), accepted, rejected, edited, deleted, undo, redo,
//     measurements, typical changes.
//   - from the pieces as they are NOW: the live counted pieces a person made on the sheet (their
//     latest create or accept), how many of them are typical, and how many have no length.
// Pure: the route feeds it the log rows and the member views.

export const IDLE_SECONDS = 300;

export interface ActionRow {
  sheet_id: string | null;
  member_id: string | null;
  who: string;
  action: string;
  created_at: Date | string;
}

export interface PieceInfo {
  id: string;
  live: boolean;
  confirmed: boolean;
  typical: boolean;
  has_length: boolean;
}

export interface ReportRow {
  sheet_id: string | null;
  who: string;
  first: string;
  last: string;
  actions: number;
  active_seconds: number;
  /** Gaps over IDLE_SECONDS before an action on this sheet: not counted as active time. */
  idle_gaps: number;
  idle_seconds: number;
  created: number;
  accepted: number;
  rejected: number;
  edited: number;
  deleted: number;
  undo: number;
  redo: number;
  measured: number;
  typical_changes: number;
  /** Live counted pieces this person made on this sheet (their latest create or accept). */
  pieces: number;
  typical_pieces: number;
  pieces_without_length: number;
}

const ms = (t: Date | string) => new Date(t).getTime();
const round1 = (v: number) => Math.round(v * 10) / 10;

function empty(sheet: string | null, who: string, at: number): ReportRow {
  const iso = new Date(at).toISOString();
  return {
    sheet_id: sheet,
    who,
    first: iso,
    last: iso,
    actions: 0,
    active_seconds: 0,
    idle_gaps: 0,
    idle_seconds: 0,
    created: 0,
    accepted: 0,
    rejected: 0,
    edited: 0,
    deleted: 0,
    undo: 0,
    redo: 0,
    measured: 0,
    typical_changes: 0,
    pieces: 0,
    typical_pieces: 0,
    pieces_without_length: 0,
  };
}

const COUNTER: Record<string, keyof ReportRow> = {
  create: 'created',
  accept: 'accepted',
  reject: 'rejected',
  edit: 'edited',
  delete: 'deleted',
  undo: 'undo',
  redo: 'redo',
  measure: 'measured',
  typical: 'typical_changes',
};

export function pilotReport(
  actions: readonly ActionRow[],
  pieces: readonly PieceInfo[],
  idleSeconds = IDLE_SECONDS,
): ReportRow[] {
  const sorted = [...actions].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const rows = new Map<string, ReportRow>();
  const rowOf = (sheet: string | null, who: string, at: number) => {
    const key = `${sheet ?? ''}|${who}`;
    let r = rows.get(key);
    if (!r) {
      r = empty(sheet, who, at);
      rows.set(key, r);
    }
    return r;
  };
  const lastAt = new Map<string, number>();
  const maker = new Map<string, { sheet: string | null; who: string }>();
  for (const a of sorted) {
    const at = ms(a.created_at);
    const r = rowOf(a.sheet_id, a.who, at);
    r.actions += 1;
    r.last = new Date(at).toISOString();
    const prev = lastAt.get(a.who);
    if (prev !== undefined) {
      const gap = (at - prev) / 1000;
      if (gap > idleSeconds) {
        r.idle_gaps += 1;
        r.idle_seconds += gap;
      } else {
        r.active_seconds += gap;
      }
    }
    lastAt.set(a.who, at);
    const field = COUNTER[a.action];
    if (field) (r[field] as number) += 1;
    if ((a.action === 'create' || a.action === 'accept') && a.member_id) {
      maker.set(a.member_id, { sheet: a.sheet_id, who: a.who });
    }
  }
  for (const p of pieces) {
    if (!p.live || !p.confirmed) continue;
    const m = maker.get(p.id);
    if (!m) continue;
    const r = rows.get(`${m.sheet ?? ''}|${m.who}`);
    if (!r) continue;
    r.pieces += 1;
    if (p.typical) r.typical_pieces += 1;
    if (!p.has_length) r.pieces_without_length += 1;
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      active_seconds: round1(r.active_seconds),
      idle_seconds: round1(r.idle_seconds),
    }))
    .sort(
      (a, b) => (a.sheet_id ?? '').localeCompare(b.sheet_id ?? '') || a.who.localeCompare(b.who),
    );
}

export const REPORT_COLUMNS = [
  'page',
  'sheet_number',
  'who',
  'first',
  'last',
  'actions',
  'active_minutes',
  'idle_gaps_over_5_min',
  'idle_minutes',
  'created',
  'accepted',
  'rejected',
  'edited',
  'deleted',
  'undo',
  'redo',
  'measured',
  'typical_changes',
  'pieces',
  'typical_pieces',
  'pieces_without_length',
] as const;

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One CSV line per sheet and person; `pageOf` gives the page number and sheet number of a sheet. */
export function reportCsv(
  rows: readonly ReportRow[],
  pageOf: (sheetId: string | null) => { page: number | null; sheet_number: string | null },
): string {
  const lines = [REPORT_COLUMNS.join(',')];
  for (const r of rows) {
    const p = pageOf(r.sheet_id);
    lines.push(
      [
        p.page ?? '',
        p.sheet_number ?? '',
        r.who,
        r.first,
        r.last,
        r.actions,
        round1(r.active_seconds / 60),
        r.idle_gaps,
        round1(r.idle_seconds / 60),
        r.created,
        r.accepted,
        r.rejected,
        r.edited,
        r.deleted,
        r.undo,
        r.redo,
        r.measured,
        r.typical_changes,
        r.pieces,
        r.typical_pieces,
        r.pieces_without_length,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
