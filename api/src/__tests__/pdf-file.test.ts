// The PDF viewer's file route: GET /api/projects/:projectId/pdf-file (byte ranges).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject } from './helpers.js';

const db = getDb();
let otherProject: string;

beforeAll(async () => {
  otherProject = await insertProject(db);
});

afterAll(async () => {
  await deleteProject(db, otherProject);
  await closeDatabaseConnection();
});

describe('pdf-file', () => {
  it('streams the stored PDF with byte ranges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdffile-'));
    const own = buildApp({ uploadDir: dir });
    const pid = await insertProject(db);
    const rel = `${pid}/source.pdf`;
    fs.mkdirSync(path.join(dir, pid), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), Buffer.from('%PDF-1.4\n0123456789abcdef'));
    await db
      .insertInto('project_files')
      .values({
        project_id: pid,
        original_filename: 'x.pdf',
        stored_path: rel,
        sha256: '0'.repeat(64),
        size_bytes: 25,
      })
      .execute();
    const full = await own.inject({ method: 'GET', url: `/api/projects/${pid}/pdf-file` });
    expect([full.statusCode, full.headers['content-type'], full.headers['accept-ranges']]).toEqual([
      200,
      'application/pdf',
      'bytes',
    ]);
    expect(full.body.startsWith('%PDF-')).toBe(true);
    const part = await own.inject({
      method: 'GET',
      url: `/api/projects/${pid}/pdf-file`,
      headers: { range: 'bytes=9-12' },
    });
    expect([part.statusCode, part.body, part.headers['content-range']]).toEqual([
      206,
      '0123',
      'bytes 9-12/25',
    ]);
    const tail = await own.inject({
      method: 'GET',
      url: `/api/projects/${pid}/pdf-file`,
      headers: { range: 'bytes=-4' },
    });
    expect(tail.body).toBe('cdef');
    const bad = await own.inject({
      method: 'GET',
      url: `/api/projects/${pid}/pdf-file`,
      headers: { range: 'bytes=900-999' },
    });
    expect(bad.statusCode).toBe(416);
    const none = await own.inject({ method: 'GET', url: `/api/projects/${otherProject}/pdf-file` });
    expect(none.statusCode).toBe(404);
    await deleteProject(db, pid);
  });
});
