import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import {
  deleteJobsFor,
  deleteProject,
  fakePdf,
  jobsFor,
  multipartBody,
  uniqueLabel,
} from './helpers.js';

const MAX = 50_000;
let uploadDir: string;
const created: string[] = [];

beforeAll(() => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-test-'));
});

afterAll(async () => {
  for (const id of created) {
    await deleteJobsFor(getDb(), id);
    await deleteProject(getDb(), id);
  }
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await closeDatabaseConnection();
});

function appWithTempDir() {
  return buildApp({ uploadDir, maxUploadBytes: MAX });
}

async function createProject(a: ReturnType<typeof buildApp>, body: Record<string, unknown> = {}) {
  const res = await a.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: uniqueLabel('test-project'), ...body },
  });
  if (res.statusCode === 201) created.push(res.json().id);
  return res;
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

describe('projects', () => {
  it('creates a project with server-set status and defaults', async () => {
    const a = appWithTempDir();
    const res = await createProject(a, {
      name: '  Synthetic Tower  ',
      number: 'SYN-9',
      location: 'Nowhere',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Synthetic Tower',
      number: 'SYN-9',
      location: 'Nowhere',
      status: 'created',
      design_standard: 'AISC',
      unit_system: 'mm',
      document: null,
    });
    await a.close();
  });

  it('ignores a client-supplied status (the server owns it)', async () => {
    const a = appWithTempDir();
    const res = await createProject(a, { status: 'approved' });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('created');
    await a.close();
  });

  it.each([
    ['missing name', { name: undefined }],
    ['blank name', { name: '   ' }],
    ['unsupported unit system', { unit_system: 'in' }],
    ['name too long', { name: 'x'.repeat(201) }],
  ])('rejects %s with 400', async (_label, body) => {
    const a = appWithTempDir();
    const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { ...body } });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it('lists and gets projects; 404 for unknown, 400 for a malformed id', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const list = await a.inject({ method: 'GET', url: '/api/projects' });
    expect(list.statusCode).toBe(200);
    expect((list.json().projects as { id: string }[]).some((p) => p.id === id)).toBe(true);
    expect((await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json().id).toBe(id);
    expect(
      (await a.inject({ method: 'GET', url: `/api/projects/${crypto.randomUUID()}` })).statusCode,
    ).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/api/projects/nope' })).statusCode).toBe(400);
    await a.close();
  });

  it('a new project is real, never opened; opening it sets last opened and sorts it first', async () => {
    const a = appWithTempDir();
    const first = (await createProject(a)).json();
    const second = (await createProject(a)).json();
    expect(first).toMatchObject({ purpose: 'real', last_opened_at: null });
    const opened = await a.inject({ method: 'POST', url: `/api/projects/${first.id}/opened` });
    expect(opened.statusCode).toBe(200);
    const list = (await a.inject({ method: 'GET', url: '/api/projects' })).json().projects as {
      id: string;
      last_opened_at: string | null;
      pages: { plans: number; built: number; reviewed: number };
    }[];
    const ids = list.map((p) => p.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(list.find((p) => p.id === first.id)?.last_opened_at).not.toBeNull();
    expect(list.find((p) => p.id === first.id)?.pages).toEqual({ plans: 0, built: 0, reviewed: 0 });
    // opening is not a logged action
    const logged = await getDb()
      .selectFrom('count_actions')
      .select('id')
      .where('project_id', '=', first.id)
      .execute();
    expect(logged).toHaveLength(0);
    await a.close();
  });

  it('rename, change purpose and archive need who and are logged as project actions', async () => {
    const a = appWithTempDir();
    const p = (await createProject(a)).json();
    const url = `/api/projects/${p.id}`;
    const newName = uniqueLabel('renamed');
    expect((await a.inject({ method: 'PATCH', url, payload: { name: newName } })).statusCode).toBe(
      400,
    );
    const res = await a.inject({
      method: 'PATCH',
      url,
      payload: { name: newName, purpose: 'demo', archived: true, who: 'Tester' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: newName, purpose: 'demo', archived: true });
    const log = await getDb()
      .selectFrom('count_actions')
      .select(['action', 'who', 'detail'])
      .where('project_id', '=', p.id)
      .orderBy('id')
      .execute();
    expect(log.map((r) => [r.action, r.who, (r.detail as { change: string }).change])).toEqual([
      ['project', 'Tester', 'rename'],
      ['project', 'Tester', 'purpose'],
      ['project', 'Tester', 'archive'],
    ]);
    // the stage alone needs no who and is not logged (unchanged behaviour)
    expect((await a.inject({ method: 'PATCH', url, payload: { stage: 'Won' } })).statusCode).toBe(
      200,
    );
    expect(
      (await a.inject({ method: 'PATCH', url, payload: { purpose: 'other', who: 'T' } }))
        .statusCode,
    ).toBe(400);
    await a.close();
  });

  it('duplicate as demo queues one copy job with purpose demo and logs who asked', async () => {
    const a = appWithTempDir();
    const p = (await createProject(a)).json();
    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/duplicate`,
      payload: { who: 'Tester' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().name).toBe(`${p.name as string} (demo)`);
    const jobs = await getDb()
      .selectFrom('jobs')
      .selectAll()
      .where('type', '=', 'copy_project')
      .where(sql<boolean>`payload->>'project_id' = ${p.id as string}`)
      .execute();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ purpose: 'demo', name: `${p.name as string} (demo)` });
    const log = await getDb()
      .selectFrom('count_actions')
      .select(['action', 'who', 'detail'])
      .where('project_id', '=', p.id)
      .execute();
    expect(log).toHaveLength(1);
    expect(log[0]!.detail).toMatchObject({ change: 'duplicate_as_demo', job_id: jobs[0]!.id });
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/projects/${p.id}/duplicate`,
          payload: { who: 'Tester', name: p.name },
        })
      ).statusCode,
    ).toBe(409);
    await a.close();
  });
});

describe('PDF upload', () => {
  it('streams the PDF to disk, records sha256/size/sanitized name and queues one scan job', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const pdf = Buffer.concat([fakePdf(), Buffer.alloc(10_000, 3)]);
    const { payload, headers } = multipartBody('My Drawings (rev 2).pdf', pdf);

    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/pdf`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('scanning');
    expect(body.document).toMatchObject({
      original_filename: 'My Drawings _rev 2_.pdf',
      size_bytes: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      scan_status: 'pending',
      page_count: null,
    });

    const stored = filesUnder(path.join(uploadDir, id));
    expect(stored).toHaveLength(1);
    expect(fs.readFileSync(stored[0] as string).equals(pdf)).toBe(true);

    const jobs = await jobsFor(getDb(), id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(jobs[0]?.payload).toEqual({
      project_id: id,
      document_id: body.document.id,
      auto_run: true,
    });

    expect((await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json().document.id).toBe(
      body.document.id,
    );
    await a.close();
  });

  it('accepts by magic bytes whatever the filename says, and never lets the name escape the upload dir', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const { payload, headers } = multipartBody('../../../evil.txt', fakePdf());
    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/pdf`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().document.original_filename).toBe('evil.txt');
    for (const f of filesUnder(path.join(uploadDir, id)))
      expect(f.startsWith(uploadDir + path.sep)).toBe(true);
    await a.close();
  });

  it('rejects a non-PDF by magic bytes (415) and stores nothing', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const { payload, headers } = multipartBody(
      'looks-like.pdf',
      Buffer.from('this is plain text, not a PDF'),
    );
    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/pdf`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(415);
    expect(filesUnder(path.join(uploadDir, id))).toEqual([]);
    const project = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json();
    expect([project.status, project.document]).toEqual(['created', null]);
    expect(await jobsFor(getDb(), id)).toEqual([]);
    await a.close();
  });

  it('rejects a file over the size limit (413) and stores nothing', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const big = Buffer.concat([fakePdf(), Buffer.alloc(MAX + 1000, 1)]);
    const { payload, headers } = multipartBody('big.pdf', big);
    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/pdf`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(413);
    expect(filesUnder(path.join(uploadDir, id))).toEqual([]);
    expect(
      (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json().document,
    ).toBeNull();
    await a.close();
  });

  it('allows only one PDF per project (409) and leaves the first untouched', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const first = multipartBody('first.pdf', fakePdf('first'));
    expect(
      (await a.inject({ method: 'POST', url: `/api/projects/${id}/pdf`, ...first })).statusCode,
    ).toBe(201);
    const second = multipartBody('second.pdf', fakePdf('second'));
    expect(
      (await a.inject({ method: 'POST', url: `/api/projects/${id}/pdf`, ...second })).statusCode,
    ).toBe(409);

    const stored = filesUnder(path.join(uploadDir, id));
    expect(stored).toHaveLength(1);
    expect(fs.readFileSync(stored[0] as string, 'utf8')).toContain('first');
    await a.close();
  });

  it('two simultaneous uploads: exactly one wins, one file and one job remain', async () => {
    const a = appWithTempDir();
    const id = (await createProject(a)).json().id as string;
    const send = (label: string) =>
      a.inject({
        method: 'POST',
        url: `/api/projects/${id}/pdf`,
        ...multipartBody(`${label}.pdf`, fakePdf(label)),
      });
    const results = await Promise.all([send('a'), send('b')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(filesUnder(path.join(uploadDir, id))).toHaveLength(1);
    const jobs = await jobsFor(getDb(), id);
    expect(jobs).toHaveLength(1);
    await a.close();
  });

  it('404 for an unknown project; 415 for a request that is not multipart', async () => {
    const a = appWithTempDir();
    const ghost = multipartBody('x.pdf', fakePdf());
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/projects/${crypto.randomUUID()}/pdf`,
          ...ghost,
        })
      ).statusCode,
    ).toBe(404);
    const id = (await createProject(a)).json().id as string;
    const res = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/pdf`,
      payload: { file: 'nope' },
    });
    expect(res.statusCode).toBe(415);
    await a.close();
  });
});
