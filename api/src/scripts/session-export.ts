// Frozen export of one work session (session preparation, migration 027): every row the session's
// project wrote on the session's day, the members built or drawn in the session with their effective
// values at export time, and the session's time per page. The copy is the training / measurement
// source from then on.
//   npm run session:export -- --session <id> [--out <dir>]
// Default out: fixtures/private/sessions/<session id>/. READ-ONLY on the database (the connection is
// opened with default_transaction_read_only); writes only the JSON / CSV files, then makes them and
// the directory read-only. Refuses an existing directory. Prints ids and counts only.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from '../db/types.js';
import { loadPieces } from '../review/line-first-pieces.js';
import { EXPORT_FILES } from '../review/session-report.js';
import { sessionPageTimes, timingCsv, type SessionRow } from '../review/session-timing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { session: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.session) {
    console.error('usage: npm run session:export -- --session <id> [--out <dir>]');
    return 1;
  }
  const out = values.out ?? path.join(root, 'fixtures/private/sessions', values.session);
  if (fs.existsSync(out)) {
    console.error(
      'refused: the export directory already exists (a frozen copy is never rewritten)',
    );
    return 1;
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c default_transaction_read_only=on',
    max: 2,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  try {
    const exportedAt = new Date(
      (await sql<{ now: Date }>`SELECT now() AS now`.execute(db)).rows[0]!.now,
    );
    const session = await db
      .selectFrom('work_sessions')
      .selectAll()
      .where('id', '=', values.session)
      .executeTakeFirst();
    if (!session) {
      console.error('session not found');
      return 1;
    }
    const p = session.project_id;
    // the session's UTC day: other sessions and the owner's no-session rows of that day come along
    const day = new Date(session.started_at);
    day.setUTCHours(0, 0, 0, 0);
    const sessions = await db
      .selectFrom('work_sessions')
      .selectAll()
      .where('project_id', '=', p)
      .where('started_at', '>=', day)
      .orderBy('started_at')
      .execute();
    const sids = sessions.map((s) => s.id);
    const sheets = await db
      .selectFrom('sheets')
      .select(['id', 'page_index', 'width_pt', 'height_pt', 'rotation', 'reviewed_at'])
      .where('project_id', '=', p)
      .orderBy('page_index')
      .execute();
    const sheetIds = sheets.map((s) => s.id);
    const ofDay = <T extends { created_at: Date }>(rows: T[]) =>
      rows.filter((r) => new Date(r.created_at) >= day);
    const viewIds = (
      await db.selectFrom('build_views').select('id').where('sheet_id', 'in', sheetIds).execute()
    ).map((v) => v.id);
    const byView = async (
      table: 'view_deselections' | 'view_exclusions',
    ): Promise<Record<string, unknown>[]> =>
      viewIds.length === 0
        ? []
        : ofDay(
            await db
              .selectFrom(table)
              .selectAll()
              .where('view_id', 'in', viewIds)
              .orderBy('created_at')
              .execute(),
          );
    const runs = await db
      .selectFrom('build_runs')
      .selectAll()
      .where('project_id', '=', p)
      .where('started_at', '>=', day)
      .orderBy('started_at')
      .execute();
    const runIds = runs.map((r) => r.id);
    // members built by the day's runs or drawn in its sessions
    const members = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', p)
      .where((eb) =>
        eb.or([
          ...(runIds.length ? [eb('build_run_id', 'in', runIds)] : []),
          ...(sids.length ? [eb('session_id', 'in', sids)] : []),
        ]),
      )
      .orderBy('member_id')
      .execute();
    const memberIds = members.map((m) => m.id);
    const data: Record<(typeof EXPORT_FILES)[number], unknown> = {
      work_sessions: sessions,
      count_actions: await db
        .selectFrom('count_actions')
        .selectAll()
        .where('project_id', '=', p)
        .where('created_at', '>=', day)
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
      page_events: await db
        .selectFrom('page_events')
        .selectAll()
        .where('project_id', '=', p)
        .where('created_at', '>=', day)
        .orderBy('created_at')
        .execute(),
      sheet_edits: ofDay(
        await db
          .selectFrom('sheet_edits')
          .selectAll()
          .where('sheet_id', 'in', sheetIds)
          .orderBy('created_at')
          .execute(),
      ),
      member_edits: memberIds.length
        ? await db
            .selectFrom('member_edits')
            .selectAll()
            .where('member_id', 'in', memberIds)
            .orderBy('created_at')
            .orderBy('id')
            .execute()
        : [],
      members,
      pieces_final: memberIds.length ? await loadPieces(db, p, { memberIds }) : [],
      build_runs: runs,
      build_snapshots: runIds.length
        ? await db
            .selectFrom('build_snapshots')
            .selectAll()
            .where('build_run_id', 'in', runIds)
            .orderBy('created_at')
            .execute()
        : [],
      build_views: await db
        .selectFrom('build_views')
        .select([
          'id',
          'sheet_id',
          'position',
          'box',
          'role_name',
          'scale_ratio',
          'tos_mm',
          'no_beams_at',
          'column_plan_view_id',
          'setup_changed_at',
          'built_at',
        ])
        .where('sheet_id', 'in', sheetIds)
        .orderBy('sheet_id')
        .orderBy('position')
        .execute(),
      view_deselections: await byView('view_deselections'),
      view_exclusions: await byView('view_exclusions'),
      view_undo: await db
        .selectFrom('view_undo')
        .selectAll()
        .where('project_id', '=', p)
        .where(sql<boolean>`created_at >= ${day}`)
        .orderBy('created_at')
        .execute(),
      measurements: await db
        .selectFrom('measurements')
        .selectAll()
        .where('project_id', '=', p)
        .where('created_at', '>=', day)
        .orderBy('created_at')
        .execute(),
      auto_builds: await db
        .selectFrom('auto_builds')
        .select(['id', 'status', 'started_at', 'finished_at', 'counts'])
        .where('project_id', '=', p)
        .orderBy('started_at')
        .execute(),
      sheets,
      timing: [],
    };
    const index = new Map(sheets.map((s) => [s.id, s.page_index]));
    const timing: { session_id: string; actor: string; pages: unknown[] }[] = [];
    const csv: string[] = [];
    for (const s of sessions) {
      const rows: SessionRow[] = [
        ...(data.count_actions as { session_id: string | null; sheet_id: string | null }[])
          .filter((r) => r.session_id === s.id)
          .map((r) => {
            const a = r as unknown as { sheet_id: string | null; created_at: Date; action: string };
            return { sheet_id: a.sheet_id, at: a.created_at, kind: a.action };
          }),
        ...(data.page_events as { session_id: string | null }[])
          .filter((r) => r.session_id === s.id)
          .map((r) => {
            const e = r as unknown as { sheet_id: string; created_at: Date; kind: string };
            return { sheet_id: e.sheet_id, at: e.created_at, kind: e.kind };
          }),
      ];
      const pages = sessionPageTimes(rows).map((t) => ({
        ...t,
        page_index: index.get(t.sheet_id) ?? -1,
      }));
      timing.push({ session_id: s.id, actor: s.actor, pages });
      csv.push(timingCsv(s, pages));
    }
    data.timing = timing;

    fs.mkdirSync(out, { recursive: true });
    const files: Record<string, { rows: number; sha256: string }> = {};
    const write = (name: string, text: string, rows: number) => {
      fs.writeFileSync(path.join(out, name), text);
      files[name] = { rows, sha256: crypto.createHash('sha256').update(text).digest('hex') };
    };
    for (const k of EXPORT_FILES) {
      const rows = data[k] as unknown[];
      write(`${k}.json`, JSON.stringify(rows, null, 1) + '\n', rows.length);
    }
    sessions.forEach((s, i) =>
      write(`timing-${s.id}.csv`, csv[i]!, (timing[i]?.pages ?? []).length),
    );
    let commit: string | null = null;
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    } catch {
      commit = null;
    }
    write(
      'manifest.json',
      JSON.stringify(
        {
          session_id: session.id,
          project_id: p,
          day_from: day.toISOString(),
          exported_at: exportedAt.toISOString(),
          session_open_at_export: session.ended_at === null,
          sessions: sessions.map((s) => ({ id: s.id, actor: s.actor })),
          code_commit: commit,
          files,
        },
        null,
        1,
      ) + '\n',
      1,
    );
    for (const f of fs.readdirSync(out)) fs.chmodSync(path.join(out, f), 0o444);
    fs.chmodSync(out, 0o555);
    console.log(
      JSON.stringify(
        {
          session_id: session.id,
          project_id: p,
          session_open_at_export: session.ended_at === null,
          rows: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.rows])),
        },
        null,
        1,
      ),
    );
    return 0;
  } finally {
    await db.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'export failed');
    process.exit(1);
  },
);
