import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let uploadDir: string;
let app: ReturnType<typeof buildApp>;
let projectId: string;
let otherProjectId: string;

beforeAll(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-test-'));
  app = buildApp({ uploadDir });
  projectId = await insertProject(getDb());
  otherProjectId = await insertProject(getDb());
});

afterAll(async () => {
  await app.close();
  await deleteProject(getDb(), projectId);
  await deleteProject(getDb(), otherProjectId);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await closeDatabaseConnection();
});

describe('thumbnails', () => {
  it('serves the PNG for a sheet', async () => {
    const rel = `${projectId}/thumbs/page-0001.png`;
    fs.mkdirSync(path.dirname(path.join(uploadDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, rel), PNG);
    const id = await insertSheet(getDb(), projectId, { page_index: 10, thumbnail_path: rel });
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${id}/thumbnail`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG)).toBe(true);
    // the pages list (what the web reads) hands out the thumbnail URL
    const pages = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pages` });
    const page = pages.json().pages.find((p: { id: string }) => p.id === id);
    expect(page.thumbnail_url).toBe(`/api/projects/${projectId}/sheets/${id}/thumbnail`);
  });

  it('404 when the sheet has no thumbnail or the file is missing', async () => {
    const none = await insertSheet(getDb(), projectId, { page_index: 11 });
    const missing = await insertSheet(getDb(), projectId, {
      page_index: 12,
      thumbnail_path: `${projectId}/thumbs/gone.png`,
    });
    for (const id of [none, missing]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/sheets/${id}/thumbnail`,
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('never serves a file outside the upload directory', async () => {
    const outside = path.join(os.tmpdir(), `outside-${crypto.randomUUID()}.png`);
    fs.writeFileSync(outside, PNG);
    try {
      const id = await insertSheet(getDb(), projectId, {
        page_index: 13,
        thumbnail_path: path.relative(uploadDir, outside),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/sheets/${id}/thumbnail`,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
