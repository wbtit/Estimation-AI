// Phase 0 project intake: the Project details step (SYNTHETIC rows, test database).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject } from './helpers.js';

const app = buildApp();
const db = getDb();

describe('project details step (test database)', () => {
  let projectId: string;
  let other: string;
  const put = (payload: object) =>
    app.inject({ method: 'PUT', url: `/api/projects/${projectId}/details`, payload });
  const row = () =>
    db.selectFrom('projects').selectAll().where('id', '=', projectId).executeTakeFirstOrThrow();
  const edits = () =>
    db
      .selectFrom('project_detail_edits')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    projectId = await insertProject(db);
    other = await insertProject(db);
  });
  afterAll(async () => {
    await db.deleteFrom('jobs').where('type', '=', 'read_details').execute();
    await deleteProject(db, projectId);
    await deleteProject(db, other);
    await app.close();
    await closeDatabaseConnection();
  });

  it('a new project has the four details empty; the list shows them', async () => {
    const p = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}` })).json();
    expect(p).toMatchObject({ client: null, location: null, building_type: null });
  });

  it('saves what the step shows, as person edits with who', async () => {
    const before = (await row()).name;
    const res = await put({
      who: 'ann',
      name: 'Riverside Warehouse',
      client: 'Acme Holdings',
      location: 'Portland, OR',
      building_type: 'Warehouse',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toEqual(['name', 'client', 'location', 'building_type']);
    expect(await row()).toMatchObject({
      name: 'Riverside Warehouse',
      client: 'Acme Holdings',
      location: 'Portland, OR',
      building_type: 'Warehouse',
    });
    const log = await edits();
    expect(log.map((e) => [e.field, e.kind, e.who]).sort()).toEqual([
      ['building_type', 'edit', 'ann'],
      ['location', 'edit', 'ann'],
      ['owner', 'edit', 'ann'],
      ['project_name', 'edit', 'ann'],
    ]);
    expect((log.find((e) => e.field === 'project_name')!.before as { value: string }).value).toBe(
      before,
    );
    // the rename is logged like any rename
    const ca = await db
      .selectFrom('count_actions')
      .select(['action', 'who'])
      .where('project_id', '=', projectId)
      .execute();
    expect(ca).toEqual([{ action: 'project', who: 'ann' }]);
    // and the details panel API sees the edit over a read value
    const d = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/project-details` })
    ).json();
    expect(d.fields.find((f: { field: string }) => f.field === 'owner')).toMatchObject({
      value: 'Acme Holdings',
      edited: true,
      edited_by: 'ann',
    });
  });

  it('an explicitly cleared field stays empty; an unchanged field writes nothing', async () => {
    const n = (await edits()).length;
    const res = await put({ who: 'ann', client: '  ', location: 'Portland, OR' });
    expect(res.json().saved).toEqual(['client']); // location did not change
    expect((await row()).client).toBeNull();
    expect((await edits()).length).toBe(n + 1);
    // a field that is not sent is unchanged
    await put({ who: 'ann', building_type: 'Industrial' });
    expect(await row()).toMatchObject({ location: 'Portland, OR', building_type: 'Industrial' });
  });

  it('the name can never be empty: null or blank keeps the current one', async () => {
    const name = (await row()).name;
    const res = await put({ who: 'ann', name: '   ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name_kept: true, saved: [] });
    expect((await row()).name).toBe(name);
  });

  it('a name another project has is refused (409), and nothing is saved', async () => {
    const taken = (
      await db
        .selectFrom('projects')
        .select('name')
        .where('id', '=', other)
        .executeTakeFirstOrThrow()
    ).name;
    const before = await row();
    const res = await put({ who: 'ann', name: taken, client: 'Changed' });
    expect(res.statusCode).toBe(409);
    expect(await row()).toMatchObject({ name: before.name, client: before.client });
  });

  it('needs who, and a project that exists', async () => {
    expect((await put({ name: 'x' })).statusCode).toBe(400);
    expect((await put({ who: '   ', name: 'x' })).statusCode).toBe(400);
    const none = await app.inject({
      method: 'PUT',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/details',
      payload: { who: 'ann' },
    });
    expect(none.statusCode).toBe(404);
  });

  it('the details answer says "reading" while a read job is open', async () => {
    const get = async () =>
      (
        await app.inject({ method: 'GET', url: `/api/projects/${projectId}/project-details` })
      ).json();
    expect((await get()).reading).toBe(false);
    const r = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/project-details/read`,
      payload: { who: 'ann' },
    });
    expect(r.statusCode).toBe(202);
    expect((await get()).reading).toBe(true);
    await db.deleteFrom('jobs').where('type', '=', 'read_details').execute();
    expect((await get()).reading).toBe(false);
  });
});
