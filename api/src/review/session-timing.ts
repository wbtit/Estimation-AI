// Time per page in one work session (migration 027), from the session's own rows:
//   - the page opens: count_actions 'view' (the workspace logs one each time a page is shown);
//   - the actions: every other count_actions row of the page (edit, add, delete, setup, save, ...);
//   - the activity pings: page_events 'active' (at most every 30 s while there is input on the page)
//     and 'leave' (the page was left or the browser tab hidden).
// "Done" = the page's first Save page ('save') in the session. Wall times run from the first open.
// Active time: all rows of the session on one time line; the gap from a row to the next counts for
// the row's page when it is at most IDLE_SECONDS and the row is not a 'leave'. So time spent on
// another page never counts for this one, and idle gaps over 2 min never count.

export const IDLE_SECONDS = 120;

export interface SessionRow {
  sheet_id: string | null;
  at: Date | string;
  /** 'view' (open), 'active' / 'leave' (pings) or the count_actions action name */
  kind: string;
}

export interface PageTiming {
  sheet_id: string;
  first_open: string | null;
  first_save: string | null;
  last_action: string | null;
  wall_to_save_s: number | null;
  wall_to_last_action_s: number | null;
  active_to_save_s: number | null;
  active_total_s: number;
  opens: number;
  actions: number;
}

const PINGS = new Set(['active', 'leave']);
const ms = (t: Date | string) => new Date(t).getTime();
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const sec = (a: number | null, b: number | null) =>
  a === null || b === null ? null : Math.round((b - a) / 100) / 10;

export function sessionPageTimes(
  rows: readonly SessionRow[],
  idleSeconds = IDLE_SECONDS,
): PageTiming[] {
  const line = rows
    .map((r, i) => ({ ...r, t: ms(r.at), i }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  type Acc = {
    open: number | null;
    save: number | null;
    last: number | null;
    opens: number;
    actions: number;
    active: number;
  };
  const pages = new Map<string, Acc>();
  const acc = (sid: string): Acc => {
    let a = pages.get(sid);
    if (!a) {
      a = { open: null, save: null, last: null, opens: 0, actions: 0, active: 0 };
      pages.set(sid, a);
    }
    return a;
  };
  for (const r of line) {
    if (!r.sheet_id) continue;
    const a = acc(r.sheet_id);
    if (r.kind === 'view') {
      a.opens += 1;
      if (a.open === null) a.open = r.t;
    } else if (!PINGS.has(r.kind)) {
      a.actions += 1;
      a.last = r.t;
      if (r.kind === 'save' && a.save === null) a.save = r.t;
    }
  }
  // a page acted on without a logged open starts at its first row
  for (const r of line) {
    if (r.sheet_id) {
      const a = acc(r.sheet_id);
      if (a.open === null) a.open = r.t;
    }
  }
  const toSave = new Map<string, number>();
  for (let k = 0; k + 1 < line.length; k += 1) {
    const r = line[k]!;
    const next = line[k + 1]!;
    if (!r.sheet_id || r.kind === 'leave') continue;
    const gap = (next.t - r.t) / 1000;
    if (gap > idleSeconds) continue;
    const a = acc(r.sheet_id);
    a.active += gap;
    if (a.save !== null && next.t <= a.save) {
      toSave.set(r.sheet_id, (toSave.get(r.sheet_id) ?? 0) + gap);
    }
  }
  return [...pages.entries()].map(([sid, a]) => ({
    sheet_id: sid,
    first_open: iso(a.open),
    first_save: iso(a.save),
    last_action: iso(a.last),
    wall_to_save_s: sec(a.open, a.save),
    wall_to_last_action_s: sec(a.open, a.last),
    active_to_save_s: a.save === null ? null : Math.round((toSave.get(sid) ?? 0) * 10) / 10,
    active_total_s: Math.round(a.active * 10) / 10,
    opens: a.opens,
    actions: a.actions,
  }));
}

export const TIMING_COLUMNS = [
  'session_id',
  'actor',
  'project_id',
  'page',
  'sheet_id',
  'first_open',
  'first_save',
  'last_action',
  'wall_to_save_s',
  'wall_to_last_action_s',
  'active_to_save_s',
  'active_total_s',
  'opens',
  'actions',
] as const;

/** One CSV line per page (ids, page numbers and times only), pages in page order. */
export function timingCsv(
  session: { id: string; actor: string; project_id: string },
  pages: readonly (PageTiming & { page_index: number })[],
): string {
  const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const lines = [TIMING_COLUMNS.join(',')];
  for (const p of [...pages].sort((a, b) => a.page_index - b.page_index)) {
    const row: Record<string, unknown> = {
      ...p,
      session_id: session.id,
      actor: session.actor,
      project_id: session.project_id,
      page: p.page_index + 1,
    };
    lines.push(TIMING_COLUMNS.map((c) => cell(row[c])).join(','));
  }
  return lines.join('\n') + '\n';
}
