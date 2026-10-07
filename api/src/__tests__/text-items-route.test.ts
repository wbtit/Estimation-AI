import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteJobsFor, deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
let projectId: string;
let otherProjectId: string;
let sheetId: string;

interface Seed {
  key: string;
  x0: number;
  y0: number;
  text: string | null;
  orientation?: 'horizontal' | 'vertical';
  needsReview?: boolean;
  reasons?: string[];
  ocr?: string | null;
  agree?: boolean | null;
}

async function insertItem(sheet: string, s: Seed): Promise<void> {
  await getDb()
    .insertInto('text_items')
    .values({
      sheet_id: sheet,
      item_key: s.key,
      x0: s.x0,
      y0: s.y0,
      x1: s.x0 + 40,
      y1: s.y0 + 7,
      orientation: s.orientation ?? 'horizontal',
      text: s.text,
      ocr_text: s.ocr ?? null,
      methods: s.text === null ? [] : s.ocr ? ['glyph', 'ocr'] : ['glyph'],
      confidence: s.text === null ? 0 : 0.8,
      agree: s.agree ?? null,
      needs_review: s.needsReview ?? false,
      review_reasons: s.reasons ?? [],
      char_count: s.text?.length ?? 0,
      unknown_count: 0,
      font_id: 'test-font',
    })
    .execute();
}

beforeAll(async () => {
  const db = getDb();
  projectId = await insertProject(db);
  otherProjectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0 });
  await insertItem(sheetId, { key: 'b', x0: 50, y0: 100, text: 'B2' });
  await insertItem(sheetId, { key: 'a', x0: 10, y0: 100, text: 'S4.1', ocr: 'S4.1', agree: true });
  await insertItem(sheetId, { key: 'c', x0: 10, y0: 20, text: 'BEAM' });
  await insertItem(sheetId, {
    key: 'v',
    x0: 300,
    y0: 400,
    text: null,
    orientation: 'vertical',
    needsReview: true,
    reasons: ['vertical_text_not_read'],
  });
});

afterAll(async () => {
  await app.close();
  for (const id of [projectId, otherProjectId]) {
    await deleteJobsFor(getDb(), id);
    await deleteProject(getDb(), id);
  }
  await closeDatabaseConnection();
});

const list = (project: string, sheet: string, query = '') =>
  app.inject({ method: 'GET', url: `/api/projects/${project}/sheets/${sheet}/text-items${query}` });

describe('GET text-items', () => {
  it('lists a sheet text items in reading order with their review state', async () => {
    const res = await list(projectId, sheetId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ sheet_id: sheetId, count: 4, needs_review: 1 });
    expect(body.items.map((i: { text: string | null }) => i.text)).toEqual([
      'BEAM',
      'S4.1',
      'B2',
      null,
    ]);
    expect(body.items[1]).toMatchObject({
      bbox: { x0: 10, y0: 100, x1: 50, y1: 107 },
      orientation: 'horizontal',
      methods: ['glyph', 'ocr'],
      ocr_text: 'S4.1',
      agree: true,
      confidence: 0.8,
      needs_review: false,
      font_id: 'test-font',
    });
  });

  it('shows vertical text as not read, never as text', async () => {
    const res = await list(projectId, sheetId, '?needs_review=true');
    const items = res.json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: null,
      orientation: 'vertical',
      methods: [],
      review_reasons: ['vertical_text_not_read'],
    });
  });

  it('can filter out the items that need review', async () => {
    const res = await list(projectId, sheetId, '?needs_review=false');
    expect(res.json().count).toBe(3);
  });

  it('returns an empty list for a sheet with nothing read', async () => {
    const empty = await insertSheet(getDb(), projectId, { page_index: 1 });
    expect((await list(projectId, empty)).json()).toMatchObject({ count: 0, items: [] });
  });

  it('404 for an unknown sheet and for a sheet of another project; 400 for a bad id or query', async () => {
    expect((await list(projectId, randomUUID())).statusCode).toBe(404);
    expect((await list(otherProjectId, sheetId)).statusCode).toBe(404);
    expect((await list(projectId, 'nope')).statusCode).toBe(400);
    expect((await list(projectId, sheetId, '?needs_review=maybe')).statusCode).toBe(400);
    expect((await list(projectId, sheetId, '?other=1')).statusCode).toBe(200); // unknown query fields are stripped
  });
});

describe('POST read-text', () => {
  async function withFile(project: string, scanStatus: 'pending' | 'scanning' | 'done' | 'failed') {
    await getDb()
      .insertInto('project_files')
      .values({
        project_id: project,
        original_filename: 'job-001.pdf',
        stored_path: `${project}/x.pdf`,
        sha256: '0'.repeat(64),
        size_bytes: 1,
        scan_status: scanStatus,
      })
      .execute();
  }
  const post = (project: string, payload?: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/projects/${project}/read-text`, payload });

  it('409 for a project with no PDF, 404 for an unknown project', async () => {
    const empty = await insertProject(getDb());
    try {
      const res = await post(empty);
      expect([res.statusCode, res.json().error]).toEqual([409, 'this project has no PDF yet']);
      expect((await post(randomUUID())).statusCode).toBe(404);
    } finally {
      await deleteProject(getDb(), empty);
    }
  });

  it('409 until the scan has finished', async () => {
    const pid = await insertProject(getDb());
    try {
      await withFile(pid, 'scanning');
      expect((await post(pid)).statusCode).toBe(409);
    } finally {
      await deleteProject(getDb(), pid);
    }
  });

  it('queues one read_text job with the document and the optional font, and refuses a second', async () => {
    const pid = await insertProject(getDb());
    try {
      await withFile(pid, 'done');
      const res = await post(pid, { font_id: 'cad-font-a' });
      expect(res.statusCode).toBe(202);
      const job = await getDb()
        .selectFrom('jobs')
        .selectAll()
        .where('id', '=', res.json().job_id)
        .executeTakeFirstOrThrow();
      expect(job).toMatchObject({ type: 'read_text', status: 'pending', attempts: 0 });
      const file = await getDb()
        .selectFrom('project_files')
        .select('id')
        .where('project_id', '=', pid)
        .executeTakeFirstOrThrow();
      expect(job.payload).toEqual({ project_id: pid, document_id: file.id, font_id: 'cad-font-a' });

      const again = await post(pid);
      expect([again.statusCode, again.json().job_id]).toEqual([409, job.id]);
    } finally {
      await deleteJobsFor(getDb(), pid);
      await deleteProject(getDb(), pid);
    }
  });

  it('works without a body, and rejects a bad font id', async () => {
    const pid = await insertProject(getDb());
    try {
      await withFile(pid, 'done');
      expect((await post(pid, { font_id: '' })).statusCode).toBe(400);
      const res = await post(pid, { other: 1 }); // unknown body fields are stripped, not stored
      expect(res.statusCode).toBe(202);
      const job = await getDb()
        .selectFrom('jobs')
        .select('payload')
        .where('id', '=', res.json().job_id)
        .executeTakeFirstOrThrow();
      expect(Object.keys(job.payload as object)).toEqual(['project_id', 'document_id']);
    } finally {
      await deleteJobsFor(getDb(), pid);
      await deleteProject(getDb(), pid);
    }
  });
});
