// What one work session recorded (session preparation, migration 027), from its frozen export
// (scripts/session-export.ts). Pure: the script reads the export directory, never the database.
// Rules fixed before the report was first run on real data:
//
// Window: the session's start to its end (or the export time while it is still open).
// Integrity
//   I1 tagging: every row of the project inside the window carries the session id; person rows carry
//      the session actor, system rows (built members, snapshots) actor 'system'. Rows outside: listed.
//   I2 snapshots: every Build run of the session has exactly one snapshot; every built page has a
//      before_user_edit snapshot earlier than the page's first piece edit (member_edits row of a
//      piece on that page, drawn pieces included).
//   I3 no auto builds: every run is mode 'person' and has its own 'rebuild' log row (the Build
//      press); every auto_builds row is suggest only; every built piece comes from such a run.
//   I4 exports: count of 'export' rows in the session (all tagged); a download is only known if
//      logged, so 0 means "none logged".
// Per built page (the page's FIRST before_user_edit snapshot of the session = SYSTEM VERSION; the
// export's effective pieces = FINAL), matched and classified with the Phase 11b rules
// (system-report.ts matchPieces / classify). Groups: columns (type 'column') and beams (the rest).
//   kept = matched system pieces neither deleted nor ignored (unchanged, approved, size or length
//   changed); unchanged = kept_unchanged + confirmed_unchanged; deleted = system false positives;
//   drawn = final pieces with no system match added by a person and not deleted (system misses);
//   kind_changed = matched pairs whose kind differs; ends_moved = kept pieces a person moved.
//   precision = kept / system pieces; recall = kept / final pieces (final = not deleted, not ignored).
//   Strict variants use unchanged instead of kept.
// Labels: positives = kept + drawn; negatives = deleted system pieces. Drawn-then-deleted and
// ignored pieces are no label. Reliability notes per page: not_saved (built, no Save page in the
// session), bulk_delete (one delete action of >= BULK_DELETE members), most_system_deleted (>= 90%
// of a group's system pieces deleted), approved_by_save_only (every approval came with Save page),
// edits_after_save, rebuilt (more than one run).
import { classify, matchPieces } from './system-report.js';
import type { PieceView } from './line-first-pieces.js';
import type { SnapshotPiece } from '../db/types.js';

export const BULK_DELETE = 10;
export const MOST_DELETED = 0.9;
/** An approval this close before a Save page of the same page came with it. */
export const SAVE_APPROVE_MS = 2000;

/** The export's file names (scripts/session-export.ts writes them, the report reads them). */
export const EXPORT_FILES = [
  'work_sessions',
  'count_actions',
  'page_events',
  'sheet_edits',
  'member_edits',
  'members',
  'pieces_final',
  'build_runs',
  'build_snapshots',
  'build_views',
  'view_deselections',
  'view_exclusions',
  'view_undo',
  'measurements',
  'auto_builds',
  'sheets',
  'timing',
] as const;

type Time = string;
interface Tagged {
  id: string | number;
  actor: string | null;
  session_id: string | null;
}
interface TaggedId extends Tagged {
  id: string;
}
export interface SessionExport {
  manifest: { session_id: string; project_id: string; exported_at: Time };
  work_sessions: {
    id: string;
    project_id: string;
    actor: string;
    started_at: Time;
    ended_at: Time | null;
  }[];
  count_actions: (Tagged & {
    sheet_id: string | null;
    action: string;
    detail: Record<string, unknown> | null;
    created_at: Time;
  })[];
  page_events: (Tagged & { sheet_id: string; kind: string; created_at: Time })[];
  sheet_edits: (Tagged & { sheet_id: string; field_name: string; created_at: Time })[];
  member_edits: (Tagged & {
    member_id: string;
    field_name: string;
    action_id: string | null;
    created_at: Time;
  })[];
  members: (TaggedId & {
    sheet_id: string | null;
    origin: string;
    build_run_id: string | null;
    created_at: Time;
  })[];
  pieces_final: PieceView[];
  build_runs: (TaggedId & {
    sheet_id: string;
    mode: string;
    status: string;
    started_at: Time;
  })[];
  build_snapshots: (TaggedId & {
    sheet_id: string;
    build_run_id: string | null;
    mode: string;
    before_user_edit: boolean | null;
    pieces: SnapshotPiece[];
    created_at: Time;
  })[];
  build_views: {
    sheet_id: string;
    position: number;
    role_name: string | null;
    no_beams_at: Time | null;
  }[];
  view_deselections: (Tagged & { created_at: Time })[];
  view_exclusions: (Tagged & { created_at: Time })[];
  view_undo: (Tagged & { created_at: Time })[];
  measurements: (Tagged & { created_at: Time })[];
  auto_builds: { id: string; status: string; counts: Record<string, unknown> | null }[];
  sheets: { id: string; page_index: number }[];
  timing: {
    session_id: string;
    actor: string;
    pages: {
      sheet_id: string;
      page_index: number;
      first_open: Time | null;
      first_save: Time | null;
      last_action: Time | null;
      wall_to_save_s: number | null;
      wall_to_last_action_s: number | null;
      active_to_save_s: number | null;
      active_total_s: number;
      opens: number;
      actions: number;
    }[];
  }[];
}

export type Group = 'beams' | 'columns';
export const GROUPS: Group[] = ['beams', 'columns'];

export interface GroupCounts {
  system: number;
  final: number;
  kept: number;
  unchanged: number;
  approved_unchanged: number;
  deleted: number;
  drawn: number;
  drawn_then_deleted: number;
  ignored: number;
  removed_by_rebuild: number;
  size_changed: number;
  length_changed: number;
  kind_changed: number;
  ends_moved: number;
  /** labels */
  positives: number;
  negatives: number;
}

export interface BuiltPage {
  page: number;
  sheet_id: string;
  snapshot_id: string;
  runs: number;
  saved: boolean;
  groups: Record<Group, GroupCounts>;
  system_kinds: Record<string, number>;
  final_kinds: Record<string, number>;
  notes: string[];
}

export interface Check {
  id: string;
  pass: boolean;
  detail: Record<string, unknown>;
}

const ms = (t: Time | Date) => new Date(t).getTime();
const page = (index: Map<string, number>, sid: string | null) =>
  sid === null ? null : (index.get(sid) ?? -2) + 1;
const groupOf = (type: string | null | undefined): Group =>
  type === 'column' ? 'columns' : 'beams';
const zero = (): GroupCounts => ({
  system: 0,
  final: 0,
  kept: 0,
  unchanged: 0,
  approved_unchanged: 0,
  deleted: 0,
  drawn: 0,
  drawn_then_deleted: 0,
  ignored: 0,
  removed_by_rebuild: 0,
  size_changed: 0,
  length_changed: 0,
  kind_changed: 0,
  ends_moved: 0,
  positives: 0,
  negatives: 0,
});
const tally = (xs: (string | null)[]) => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x ?? '(none)'] = (out[x ?? '(none)'] ?? 0) + 1;
  return out;
};
export const ratio = (a: number, b: number): number | null =>
  b === 0 ? null : Math.round((a / b) * 1000) / 1000;

/** Compares one page's system version and final pieces (header rules). */
export function comparePage(
  system: readonly SnapshotPiece[],
  final: readonly PieceView[],
): { groups: Record<Group, GroupCounts> } {
  const groups: Record<Group, GroupCounts> = { beams: zero(), columns: zero() };
  const match = matchPieces(system, final);
  system.forEach((s, i) => {
    const g = groups[groupOf(s.type)];
    g.system += 1;
    const j = match.get(i);
    const f = j === undefined ? undefined : final[j];
    const c = classify(s, f);
    if (c === 'removed_by_rebuild') g.removed_by_rebuild += 1;
    else if (c === 'deleted_by_person') g.deleted += 1;
    else if (c === 'ignored') g.ignored += 1;
    else {
      g.kept += 1;
      if (c === 'kept_unchanged') g.unchanged += 1;
      if (c === 'confirmed_unchanged') {
        g.unchanged += 1;
        g.approved_unchanged += 1;
      }
      if (c === 'size_changed' || c === 'size_and_length_changed') g.size_changed += 1;
      if (c === 'length_changed' || c === 'size_and_length_changed') g.length_changed += 1;
      if (f && (s.kind ?? '') !== (f.kind ?? '')) g.kind_changed += 1;
      if (f?.ends_moved) g.ends_moved += 1;
    }
  });
  const matched = new Set(match.values());
  final.forEach((f, j) => {
    const g = groups[groupOf(f.type)];
    if (!f.deleted && !f.ignored) g.final += 1;
    if (matched.has(j)) return;
    if (f.added && f.deleted) g.drawn_then_deleted += 1;
    else if (f.added && !f.ignored) g.drawn += 1;
  });
  for (const g of Object.values(groups)) {
    g.positives = g.kept + g.drawn;
    g.negatives = g.deleted;
  }
  return { groups };
}

export function sumGroups(rows: readonly GroupCounts[]): GroupCounts {
  const out = zero();
  for (const r of rows) for (const k of Object.keys(out) as (keyof GroupCounts)[]) out[k] += r[k];
  return out;
}

export function sessionReport(x: SessionExport) {
  const session = x.work_sessions.find((s) => s.id === x.manifest.session_id);
  if (!session) throw new Error('the export has no row of its session');
  const sid = session.id;
  const start = ms(session.started_at);
  const end = session.ended_at ? ms(session.ended_at) : ms(x.manifest.exported_at);
  const inWindow = (t: Time) => ms(t) >= start && ms(t) <= end;
  const index = new Map(x.sheets.map((s) => [s.id, s.page_index]));
  const mine = <T extends { session_id: string | null }>(rows: readonly T[]) =>
    rows.filter((r) => r.session_id === sid);
  const actions = mine(x.count_actions);
  const runs = mine(x.build_runs);
  const runIds = new Set(runs.map((r) => r.id));

  // ---- step 1: the session(s) ----
  const pagesOf = (rows: { sheet_id: string | null }[]) =>
    new Set(rows.map((r) => r.sheet_id).filter((s): s is string => !!s));
  const opened = pagesOf([...actions.filter((a) => a.action === 'view'), ...mine(x.page_events)]);
  const built = pagesOf(runs);
  const saved = pagesOf(actions.filter((a) => a.action === 'save'));
  const sessions = x.work_sessions.map((s) => {
    const own = x.count_actions.filter((a) => a.session_id === s.id);
    const ownRuns = x.build_runs.filter((r) => r.session_id === s.id);
    return {
      session_id: s.id,
      actor: s.actor,
      project_id: s.project_id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      open_at_export: s.ended_at === null,
      duration_min:
        Math.round(
          ((s.ended_at ? ms(s.ended_at) : ms(x.manifest.exported_at)) - ms(s.started_at)) / 6000,
        ) / 10,
      pages_opened: pagesOf([
        ...own.filter((a) => a.action === 'view'),
        ...x.page_events.filter((e) => e.session_id === s.id),
      ]).size,
      pages_built: pagesOf(ownRuns).size,
      pages_saved: pagesOf(own.filter((a) => a.action === 'save')).size,
    };
  });
  const noSession = tally(
    x.count_actions.filter((a) => a.session_id === null).map((a) => `${a.actor}:${a.action}`),
  );

  // ---- step 2: integrity ----
  type Row = { table: string; id: string | number; actor: string | null; session: string | null };
  const off: Row[] = [];
  let checked = 0;
  const scan = <T extends Tagged>(
    table: string,
    rows: readonly T[],
    at: (r: T) => Time,
    expect: (r: T) => string,
  ) => {
    for (const r of rows) {
      if (!inWindow(at(r))) continue;
      checked += 1;
      if (r.session_id !== sid || r.actor !== expect(r))
        off.push({ table, id: r.id, actor: r.actor, session: r.session_id });
    }
  };
  const person = () => session.actor;
  const created = (r: { created_at: Time }) => r.created_at;
  scan('count_actions', x.count_actions, created, person);
  scan('page_events', x.page_events, created, person);
  scan('sheet_edits', x.sheet_edits, created, person);
  scan('member_edits', x.member_edits, created, person);
  scan('build_runs', x.build_runs, (r) => r.started_at, person);
  scan('view_deselections', x.view_deselections, created, person);
  scan('view_exclusions', x.view_exclusions, created, person);
  scan('view_undo', x.view_undo, created, person);
  scan('measurements', x.measurements, created, person);
  scan('members', x.members, created, (r) => (r.origin === 'manual' ? person() : 'system'));
  scan('build_snapshots', x.build_snapshots, created, () => 'system');

  const snapsOf = (runId: string) => x.build_snapshots.filter((b) => b.build_run_id === runId);
  const runSnapshotProblems = runs
    .filter((r) => snapsOf(r.id).length !== 1)
    .map((r) => ({ run_id: r.id, snapshots: snapsOf(r.id).length }));
  const memberSheet = new Map(x.members.map((m) => [m.id, m.sheet_id]));
  const firstSnapshot = new Map<string, (typeof x.build_snapshots)[number]>();
  for (const b of [...mine(x.build_snapshots)].sort((a, c) => ms(a.created_at) - ms(c.created_at)))
    if (b.before_user_edit && runIds.has(b.build_run_id ?? '') && !firstSnapshot.has(b.sheet_id))
      firstSnapshot.set(b.sheet_id, b);
  const snapshotOrder = [...built].map((sheet) => {
    const snap = firstSnapshot.get(sheet);
    const edits = mine(x.member_edits)
      .filter((e) => memberSheet.get(e.member_id) === sheet)
      .map((e) => ms(e.created_at));
    const firstEdit = edits.length ? Math.min(...edits) : null;
    return {
      page: page(index, sheet),
      snapshot: !!snap,
      before_first_edit: !!snap && (firstEdit === null || ms(snap.created_at) < firstEdit),
    };
  });
  const presses = new Set(
    actions
      .filter((a) => a.action === 'rebuild')
      .map((a) => (a.detail?.build_run_id as string | undefined) ?? ''),
  );
  const unpressed = runs.filter((r) => r.mode !== 'person' || !presses.has(r.id)).length;
  const autoBuilt = x.auto_builds.filter((a) => a.counts?.mode !== 'suggest').length;
  const builtOutside = x.members.filter(
    (m) => m.origin !== 'manual' && m.build_run_id !== null && !runIds.has(m.build_run_id),
  ).length;
  const exports = x.count_actions.filter((a) => a.action === 'export' && inWindow(a.created_at));
  const checks: Check[] = [
    {
      id: 'I1 every row in the window tagged with the session (actor + id)',
      pass: off.length === 0,
      detail: { rows_checked: checked, not_tagged: off.length, rows: off.slice(0, 50) },
    },
    {
      id: 'I2a every Build run has exactly one snapshot',
      pass: runSnapshotProblems.length === 0,
      detail: { runs: runs.length, problems: runSnapshotProblems },
    },
    {
      id: 'I2b every built page: before_user_edit snapshot earlier than its first piece edit',
      pass: snapshotOrder.every((p) => p.snapshot && p.before_first_edit),
      detail: { pages: snapshotOrder },
    },
    {
      id: 'I3 no page built without a Build press (no auto builds)',
      pass: unpressed === 0 && autoBuilt === 0 && builtOutside === 0,
      detail: {
        runs: runs.length,
        runs_without_press: unpressed,
        auto_builds: x.auto_builds.length,
        auto_builds_not_suggest: autoBuilt,
        built_pieces_from_other_runs: builtOutside,
      },
    },
    {
      id: 'I4 exports in the session are logged and tagged',
      pass: exports.every((a) => a.session_id === sid && a.actor === session.actor),
      detail: {
        exports_logged: exports.length,
        untagged: exports.filter((a) => a.session_id !== sid).length,
      },
    },
  ];

  // ---- step 3 + 5: per built page ----
  const finalBySheet = new Map<string, PieceView[]>();
  for (const p of x.pieces_final)
    if (p.sheet_id) finalBySheet.set(p.sheet_id, [...(finalBySheet.get(p.sheet_id) ?? []), p]);
  const deleteSizes = (sheet: string) =>
    actions
      .filter((a) => a.sheet_id === sheet && a.action === 'delete')
      .map((a) => Number(a.detail?.members ?? 1));
  const builtPages: BuiltPage[] = [...firstSnapshot.values()]
    .map((snap) => {
      const sheet = snap.sheet_id;
      const final = finalBySheet.get(sheet) ?? [];
      const { groups } = comparePage(snap.pieces, final);
      const notes: string[] = [];
      const pageActions = actions.filter((a) => a.sheet_id === sheet);
      const saves = pageActions.filter((a) => a.action === 'save').map((a) => ms(a.created_at));
      if (saves.length === 0) notes.push('not_saved');
      const big = deleteSizes(sheet).filter((n) => n >= BULK_DELETE);
      if (big.length) notes.push(`bulk_delete(${big.join('+')})`);
      for (const g of GROUPS)
        if (groups[g].system > 0 && groups[g].deleted / groups[g].system >= MOST_DELETED)
          notes.push(`most_system_deleted(${g} ${groups[g].deleted}/${groups[g].system})`);
      const approvals = pageActions.filter((a) => a.action === 'approve');
      if (
        approvals.length &&
        approvals.every((a) =>
          saves.some((t) => t >= ms(a.created_at) && t - ms(a.created_at) <= SAVE_APPROVE_MS),
        )
      )
        notes.push('approved_by_save_only');
      if (saves.length) {
        const after = pageActions.filter(
          (a) => ms(a.created_at) > saves[0]! && !['view', 'save'].includes(a.action),
        ).length;
        if (after) notes.push(`edits_after_save(${after})`);
      }
      const n = runs.filter((r) => r.sheet_id === sheet).length;
      if (n > 1) notes.push(`rebuilt(${n} runs)`);
      return {
        page: page(index, sheet)!,
        sheet_id: sheet,
        snapshot_id: (snap as unknown as { id: string }).id,
        runs: n,
        saved: saves.length > 0,
        groups,
        system_kinds: tally(snap.pieces.map((p) => p.kind)),
        final_kinds: tally(final.filter((f) => !f.deleted && !f.ignored).map((f) => f.kind)),
        notes,
      };
    })
    .sort((a, b) => a.page - b.page);
  const totals = Object.fromEntries(
    GROUPS.map((g) => [g, sumGroups(builtPages.map((p) => p.groups[g]))]),
  ) as Record<Group, GroupCounts>;
  const all = sumGroups(GROUPS.map((g) => totals[g]));
  const rates = (g: GroupCounts) => ({
    precision: ratio(g.kept, g.system),
    recall: ratio(g.kept, g.final),
    precision_strict: ratio(g.unchanged, g.system),
    recall_strict: ratio(g.unchanged, g.final),
  });
  const roleOf = new Map<string, string>();
  for (const v of [...x.build_views].sort((a, b) => a.position - b.position))
    if (!roleOf.has(v.sheet_id))
      roleOf.set(v.sheet_id, v.no_beams_at ? 'none (no beams)' : (v.role_name ?? '(no role)'));
  const pagesList = (ids: Iterable<string>) =>
    [...ids]
      .map((s) => ({ page: page(index, s)!, role: roleOf.get(s) ?? '(no view)' }))
      .sort((a, b) => a.page - b.page);

  // ---- step 4: timing ----
  const t = x.timing.find((s) => s.session_id === sid);
  const timing = (t?.pages ?? [])
    .map((p) => ({ ...p, page: p.page_index + 1 }))
    .sort((a, b) => a.page - b.page);
  const sum = (k: 'active_total_s' | 'actions' | 'opens') =>
    timing.reduce((a, p) => a + (p[k] ?? 0), 0);
  const timingTotals = {
    session_wall_min: Math.round((end - start) / 6000) / 10,
    active_total_min: Math.round(sum('active_total_s') / 6) / 10,
    pages_with_save: timing.filter((p) => p.first_save !== null).length,
    first_action_at: actions.length ? actions[0]!.created_at : null,
    last_action_at: actions.length ? actions[actions.length - 1]!.created_at : null,
  };
  const gaps = longGaps(
    [...actions.map((a) => a.created_at), ...mine(x.page_events).map((e) => e.created_at)],
    600,
  );

  return {
    session_id: sid,
    project_id: session.project_id,
    window: { from: session.started_at, to: new Date(end).toISOString(), open: !session.ended_at },
    sessions,
    no_session_actions: noSession,
    checks,
    built_pages: builtPages,
    totals: { ...totals, all },
    rates: {
      beams: rates(totals.beams),
      columns: rates(totals.columns),
      all: rates(all),
    },
    pages_opened_not_built: pagesList([...opened].filter((s) => !built.has(s))),
    pages_built_not_saved: pagesList([...built].filter((s) => !saved.has(s))),
    pages_saved_not_built: pagesList([...saved].filter((s) => !built.has(s))),
    actions_by_type: tally(actions.map((a) => a.action)),
    timing,
    timing_totals: timingTotals,
    idle_gaps_over_10_min: gaps,
  };
}

/** Gaps between consecutive rows longer than `seconds` (start time and minutes). */
export function longGaps(times: readonly Time[], seconds: number) {
  const ts = times.map(ms).sort((a, b) => a - b);
  const out: { from: string; minutes: number }[] = [];
  for (let i = 1; i < ts.length; i += 1)
    if ((ts[i]! - ts[i - 1]!) / 1000 > seconds)
      out.push({
        from: new Date(ts[i - 1]!).toISOString(),
        minutes: Math.round((ts[i]! - ts[i - 1]!) / 6000) / 10,
      });
  return out;
}

export type SessionReport = ReturnType<typeof sessionReport>;
