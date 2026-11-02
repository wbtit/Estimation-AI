// Phase 14f: page lines: the pages list says which pages have lines; "prepare" queues one job and
// wakes the worker (pg_notify); the one-off backfill queues only for real projects (SYNTHETIC rows).
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { JOBS_CHANNEL } from '../review/image-similar.js';
import { applyBackfill, planBackfill } from '../review/lines-backfill.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();

async function project(purpose: 'real' | 'evaluation'): Promise<string> {
  const id = await insertProject(db);
  await db.updateTable('projects').set({ purpose }).where('id', '=', id).execute();
  await db
    .insertInto('project_files')
    .values({
      project_id: id,
      original_filename: 'synthetic.pdf',
      stored_path: `${id}/x.pdf`,
      sha256: '0'.repeat(64),
      size_bytes: 1,
      scan_status: 'done',
    })
    .execute();
  return id;
}

const linesRow = (sheetId: string) => ({
  sheet_id: sheetId,
  classes: JSON.stringify(['k']),
  lines: JSON.stringify([[0, 0, 10, 0, 0, 1]]),
  n_lines: 1,
  version: 'v',
});

describe('page lines (test database)', () => {
  let real: string;
  let evaluation: string;
  const sheets: Record<string, string> = {};

  beforeAll(async () => {
    real = await project('real');
    evaluation = await project('evaluation');
    sheets.ready = await insertSheet(db, real, { page_index: 0 });
    sheets.missing = await insertSheet(db, real, { page_index: 1 });
    sheets.queued = await insertSheet(db, real, { page_index: 2 });
    sheets.raster = await insertSheet(db, real, { page_index: 3, page_kind: 'scanned' });
    sheets.evalPage = await insertSheet(db, evaluation, { page_index: 0 });
    await db.insertInto('sheet_lines').values(linesRow(sheets.ready)).execute();
    await db
      .insertInto('jobs')
      .values({ type: 'sheet_lines', payload: JSON.stringify({ sheet_id: sheets.queued }) })
      .execute();
  });

  afterAll(async () => {
    await db
      .deleteFrom('jobs')
      .where('type', '=', 'sheet_lines')
      .where(sql<boolean>`payload->>'sheet_id' = ANY(${Object.values(sheets)})`)
      .execute();
    await deleteProject(db, real);
    await deleteProject(db, evaluation);
    await closeDatabaseConnection();
  });

  it('the pages list says which pages have lines', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${real}/pages` });
    const pages = res.json().pages as { id: string; lines_ready: boolean }[];
    const ready = Object.fromEntries(pages.map((p) => [p.id, p.lines_ready]));
    expect(ready[sheets.ready!]).toBe(true);
    expect(ready[sheets.missing!]).toBe(false);
  });

  it('prepare queues one job, wakes the worker, and answers ready once the lines exist', async () => {
    const listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    const heard: string[] = [];
    listener.on('notification', (n) => heard.push(n.payload ?? ''));
    await listener.query(`LISTEN ${JOBS_CHANNEL}`);
    try {
      const url = `/api/projects/${real}/sheets/${sheets.missing}/lines/prepare`;
      const first = await app.inject({ method: 'POST', url });
      expect(first.statusCode).toBe(202);
      expect(first.json().status).toBe('queued');
      const again = await app.inject({ method: 'POST', url });
      expect(again.json().job_id).toBe(first.json().job_id); // one open job per page
      await new Promise((r) => setTimeout(r, 200));
      expect(heard).toContain(first.json().job_id);
      await db.insertInto('sheet_lines').values(linesRow(sheets.missing!)).execute();
      const done = await app.inject({ method: 'POST', url });
      expect(done.statusCode).toBe(200);
      expect(done.json().status).toBe('ready');
    } finally {
      await listener.end();
    }
  });

  it('the backfill plans only real projects, skips pages with lines or an open job, then queues', async () => {
    await db.deleteFrom('sheet_lines').where('sheet_id', '=', sheets.missing!).execute();
    await db
      .deleteFrom('jobs')
      .where('type', '=', 'sheet_lines')
      .where(sql<boolean>`payload->>'sheet_id' = ${sheets.missing}`)
      .execute();
    const before = await db.selectFrom('jobs').select(db.fn.countAll().as('n')).executeTakeFirst();
    const plan = await planBackfill(db, [real, evaluation]);
    expect(plan.refused).toEqual([{ id: evaluation, reason: 'purpose is evaluation, not real' }]);
    expect(plan.projects).toEqual([
      { id: real, vector_pages: 3, with_lines: 1, open_jobs: 1, to_queue: [sheets.missing] },
    ]);
    // planning writes nothing
    const after = await db.selectFrom('jobs').select(db.fn.countAll().as('n')).executeTakeFirst();
    expect(after?.n).toBe(before?.n);
    const jobs = await applyBackfill(db, plan);
    expect(jobs).toHaveLength(1);
    const again = await planBackfill(db, [real]);
    expect(again.projects[0]!.to_queue).toEqual([]);
  });
});
