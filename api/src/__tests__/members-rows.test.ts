import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { memberToInsertRow, rowToMember } from '../members/rows.js';
import { loadSyntheticMembers } from '../synthetic/fixture.js';
import { makeMember } from '../synthetic/member-factory.js';
import { deleteProject, insertProject } from './helpers.js';

const projects: string[] = [];

describe('member rows <-> contract (real database)', () => {
  afterAll(async () => {
    for (const id of projects) await deleteProject(getDb(), id);
    await closeDatabaseConnection();
  });

  it('round-trips every synthetic member through the members table unchanged', async () => {
    const db = getDb();
    const projectId = await insertProject(db);
    projects.push(projectId);
    const { members } = loadSyntheticMembers();

    await db
      .insertInto('members')
      .values(members.map((m) => memberToInsertRow(projectId, m, { origin: 'seed' })))
      .execute();
    const rows = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .execute();

    const byId = (list: { member_id: string }[]) =>
      [...list].sort((a, b) => (a.member_id < b.member_id ? -1 : 1));
    expect(byId(rows.map(rowToMember))).toEqual(byId(members));
  });

  it('keeps Cyrillic grid labels exact in the database', async () => {
    const db = getDb();
    const projectId = await insertProject(db);
    projects.push(projectId);
    const m = makeMember({ member_id: 'cyr', start: { grid_x: '\u0410' }, end: { grid_x: 'A' } });
    await db
      .insertInto('members')
      .values(memberToInsertRow(projectId, m, { origin: 'seed' }))
      .execute();

    const row = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect(row.start_grid_x?.codePointAt(0)).toBe(0x410);
    expect(row.end_grid_x).toBe('A');
    expect(rowToMember(row).start.grid_x).not.toBe(rowToMember(row).end.grid_x);
  });

  it('stores unknown values as NULL (no defaults) and reads them back as null', async () => {
    const db = getDb();
    const projectId = await insertProject(db);
    projects.push(projectId);
    const m = makeMember({
      member_id: 'incomplete',
      profile: null,
      material: null,
      grade: null,
      start: { elevation_mm: null, resolved_xyz_mm: null },
    });
    await db
      .insertInto('members')
      .values(memberToInsertRow(projectId, m, { origin: 'manual' }))
      .execute();

    const row = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect([row.material, row.grade, row.profile, row.start_elevation_mm, row.start_x_mm]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(rowToMember(row)).toEqual(m);
  });

  it('refuses a stored row that violates the contract instead of passing it on', async () => {
    const db = getDb();
    const projectId = await insertProject(db);
    projects.push(projectId);
    const m = makeMember({ member_id: 'bad-bbox' });
    await db
      .insertInto('members')
      .values({
        ...memberToInsertRow(projectId, m, { origin: 'seed' }),
        source_bbox: '{"not":"a bbox"}',
      })
      .execute();
    const row = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect(() => rowToMember(row)).toThrow();
  });
});
