import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp({ uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'views-')) });
const db = getDb();
let projectId: string;
let otherProject: string;
let sheetId: string;

const BOX = { x0: 100, y0: 100, x1: 600, y1: 500 };

async function addScaleText(
  sheet: string,
  key: string,
  x: number,
  y: number,
  raw: string,
  ratio: number,
) {
  await db
    .insertInto('text_items')
    .values({
      sheet_id: sheet,
      item_key: key,
      x0: x,
      y0: y,
      x1: x + 60,
      y1: y + 8,
      orientation: 'horizontal',
      text: raw,
      methods: ['pdf_text'],
      confidence: 1,
      font_id: 'pdf_text',
      level: 'line',
      angle_deg: 0,
      parsed: JSON.stringify([{ kind: 'scale', raw, scale_kind: 'ratio', ratio }]),
    })
    .execute();
}

beforeAll(async () => {
  projectId = await insertProject(db);
  otherProject = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1200, height_pt: 800 });
  await addScaleText(sheetId, 'k1', 120, 480, '1/8" = 1\'-0"', 96);
  await addScaleText(sheetId, 'k2', 900, 700, '1/4" = 1\'-0"', 48);
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await deleteProject(db, otherProject);
  await closeDatabaseConnection();
});

const base = () => `/api/projects/${projectId}/sheets/${sheetId}/views`;

describe('views', () => {
  it('creates a view with a scale SUGGESTION that is not yet effective', async () => {
    const res = await app.inject({
      method: 'POST',
      url: base(),
      payload: { box: BOX, who: 'alice' },
    });
    expect(res.statusCode).toBe(201);
    const v = res.json();
    expect(v.scale).toEqual({ ratio: null, text: null, source: null, confirmed: false });
    expect(v.suggestion).toMatchObject({ ratio: 96, where: 'inside', ambiguous: false });
    expect(v.plan_frame).toEqual({ origin_pt: [100, 500], y_up: true });
    expect(v.created_by).toBe('alice');
  });

  it('rejects bad boxes and unknown sheets', async () => {
    const small = await app.inject({
      method: 'POST',
      url: base(),
      payload: { box: { x0: 0, y0: 0, x1: 5, y1: 5 }, who: 'a' },
    });
    expect(small.statusCode).toBe(400);
    const off = await app.inject({
      method: 'POST',
      url: base(),
      payload: { box: { x0: 0, y0: 0, x1: 5000, y1: 300 }, who: 'a' },
    });
    expect(off.statusCode).toBe(400);
    const wrongProject = await app.inject({
      method: 'POST',
      url: `/api/projects/${otherProject}/sheets/${sheetId}/views`,
      payload: { box: BOX, who: 'a' },
    });
    expect(wrongProject.statusCode).toBe(404);
  });

  it('confirming the suggestion stores detected_text; typing stores user_confirmed; both audit', async () => {
    const created = (
      await app.inject({ method: 'POST', url: base(), payload: { box: BOX, who: 'bob' } })
    ).json();
    const patch = (body: object) =>
      app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/views/${created.id}`,
        payload: body,
      });

    const ok = (await patch({ who: 'bob', scale: { action: 'confirm_suggestion' } })).json();
    expect(ok.scale).toMatchObject({ ratio: 96, source: 'detected_text', confirmed: true });
    expect(ok.suggestion).toBeNull();

    const typed = (
      await patch({ who: 'bob', scale: { action: 'set', text: '1/4" = 1\'-0"' } })
    ).json();
    expect(typed.scale).toMatchObject({ ratio: 48, source: 'user_confirmed', confirmed: true });

    const byRatio = (await patch({ who: 'bob', scale: { action: 'set', ratio: 20 } })).json();
    expect(byRatio.scale).toMatchObject({ ratio: 20, source: 'user_confirmed' });

    const bad = await patch({ who: 'bob', scale: { action: 'set', text: 'about a quarter' } });
    expect(bad.statusCode).toBe(400);
    const nts = await patch({ who: 'bob', scale: { action: 'set', text: 'NTS' } });
    expect(nts.statusCode).toBe(400);

    const cleared = (await patch({ who: 'bob', scale: { action: 'clear' } })).json();
    expect(cleared.scale).toEqual({ ratio: null, text: null, source: null, confirmed: false });

    const audits = await db
      .selectFrom('sheet_edits')
      .selectAll()
      .where('sheet_id', '=', sheetId)
      .where('field_name', '=', 'view_scale')
      .execute();
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(audits.every((a) => a.editor === 'bob')).toBe(true);
  });

  it('confirm_suggestion fails when there is nothing to suggest', async () => {
    const far = (
      await app.inject({
        method: 'POST',
        url: base(),
        payload: { box: { x0: 700, y0: 20, x1: 800, y1: 60 }, who: 'a' },
      })
    ).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/views/${far.id}`,
      payload: { who: 'a', scale: { action: 'confirm_suggestion' } },
    });
    expect([res.statusCode, res.json().error]).toEqual([
      409,
      'there is no scale suggestion for this view',
    ]);
  });

  it('moves a box (keeping the scale), stores structural classes and lists views', async () => {
    const created = (
      await app.inject({ method: 'POST', url: base(), payload: { box: BOX, who: 'c' } })
    ).json();
    const url = `/api/projects/${projectId}/views/${created.id}`;
    await app.inject({
      method: 'PATCH',
      url,
      payload: { who: 'c', scale: { action: 'set', ratio: 96 } },
    });
    const moved = (
      await app.inject({
        method: 'PATCH',
        url,
        payload: {
          who: 'c',
          name: 'plan A',
          box: { x0: 50, y0: 60, x1: 700, y1: 500 },
          structural_classes: ['1.5-2.5|black|solid'],
        },
      })
    ).json();
    expect(moved.box).toEqual({ x0: 50, y0: 60, x1: 700, y1: 500 });
    expect(moved.plan_frame.origin_pt).toEqual([50, 500]);
    expect(moved.scale.ratio).toBe(96);
    expect(moved.structural_classes).toEqual(['1.5-2.5|black|solid']);
    // choosing the member line classes is a person's confirmation; the link job must keep it
    expect(moved.classes_confirmed).toBe(true);
    const back = (
      await app.inject({ method: 'PATCH', url, payload: { who: 'c', structural_classes: [] } })
    ).json();
    expect(back.classes_confirmed).toBe(false);
    const list = (await app.inject({ method: 'GET', url: base() })).json();
    expect(list.views.length).toBeGreaterThanOrEqual(3);
    expect(list.views.find((x: { id: string }) => x.id === created.id).suggestion).toBeNull();
  });

  it('refuses to delete a view that members use, and deletes an unused one', async () => {
    const v = (
      await app.inject({ method: 'POST', url: base(), payload: { box: BOX, who: 'd' } })
    ).json();
    await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        member_id: 'M-view-test',
        origin: 'extracted',
        type: 'beam',
        view_id: v.id,
        field_sources: '{}',
        field_confidence: '{}',
      })
      .execute();
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/views/${v.id}`,
    });
    expect(blocked.statusCode).toBe(409);
    await db.deleteFrom('members').where('member_id', '=', 'M-view-test').execute();
    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/views/${v.id}`,
    });
    expect(gone.statusCode).toBe(204);
  });
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
