// Phase 14f: "Renumber tags" (one recorded, undoable action; typed tags never changed), the tag
// counter that continues from the highest current tag, and duplicate tags (SYNTHETIC rows only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import {
  duplicateTagIds,
  renumberPlan,
  RENUMBER_REASON,
  type TagMember,
} from '../review/renumber-tags.js';
import { recordAction } from '../review/actions.js';
import { takeTagNumbers } from '../review/tag-counter.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

function tm(
  id: string,
  page: number,
  y: number,
  number: number | null,
  over: Partial<TagMember> = {},
): TagMember {
  return {
    id,
    member_id: `LF-C-${id}`,
    sheet_id: `S${page}`,
    page_index: page,
    top: [100, y],
    tag: { prefix: 'C', number },
    deleted: false,
    counted_piece: true,
    typed: false,
    ...over,
  };
}

describe('renumber rule (pure)', () => {
  it('numbers counted pieces per prefix in page order, then reading order, job-wide', () => {
    const plan = renumberPlan(
      [
        tm('a', 0, 300, 7),
        tm('b', 0, 100, 3),
        tm('c', 1, 50, 44),
        tm('d', 0, 200, 9, { deleted: true }),
        tm('e', 0, 250, 5, { tag: { prefix: 'B', number: 5 } }),
      ],
      false,
    );
    const after = Object.fromEntries(plan.map((c) => [c.id, c.after.number]));
    expect(after).toEqual({ b: 1, a: 2, c: 3, e: 1 });
  });

  it('never changes a typed tag, an ignored piece or a label-first member, and skips their numbers', () => {
    const plan = renumberPlan(
      [
        tm('a', 0, 100, 10),
        tm('t', 0, 150, 2, { typed: true }),
        tm('i', 0, 160, 3, { counted_piece: false }),
        tm('b', 0, 200, 20),
        tm('c', 0, 300, 30),
      ],
      false,
    );
    expect(plan.map((c) => [c.id, c.after.number])).toEqual([
      ['a', 1],
      ['b', 4],
      ['c', 5],
    ]);
  });

  it('restarts per sheet when the project numbers tags per sheet; untagged pieces stay untagged', () => {
    const plan = renumberPlan([tm('a', 0, 100, 5), tm('b', 1, 100, 9), tm('n', 1, 50, null)], true);
    expect(plan.map((c) => [c.id, c.after.number])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('finds duplicate tags among members that are not deleted', () => {
    const d = duplicateTagIds(
      [tm('a', 0, 1, 4), tm('b', 1, 1, 4), tm('c', 0, 1, 5), tm('x', 0, 1, 5, { deleted: true })],
      false,
    );
    expect([...d].sort()).toEqual(['a', 'b']);
  });
});

describe('Renumber tags (test database)', () => {
  let projectId: string;
  let pageA: string;
  let pageB: string;
  const ids: Record<string, string> = {};
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const tagsOf = async (sheetId: string) =>
    Object.fromEntries(
      (
        (await get(`/sheets/${sheetId}/line-first`)).json().pieces as {
          id: string;
          tag: string;
          duplicate_tag: boolean;
        }[]
      ).map((p) => [p.id, p.tag]),
    );

  beforeAll(async () => {
    projectId = await insertProject(db);
    pageA = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    pageB = await insertSheet(db, projectId, { page_index: 1, width_pt: 1000, height_pt: 800 });
    for (const [sheet, keys] of [
      [pageA, ['a1', 'a2', 'a3', 'a4', 'a5']],
      [pageB, ['b1', 'b2']],
    ] as const) {
      const run = await db
        .insertInto('build_runs')
        .values({
          project_id: projectId,
          sheet_id: sheet,
          requested_by: WHO,
          mode: 'person',
          status: 'done',
          finished_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      let i = 0;
      for (const key of keys) {
        i += 1;
        const n = (sheet === pageA ? 0 : 5) + i;
        const row = await db
          .insertInto('members')
          .values({
            project_id: projectId,
            sheet_id: sheet,
            member_id: `LF-C-${key}`,
            origin: 'manual',
            type: 'column',
            kind: 'Column',
            build_run_id: run.id,
            tag_prefix: 'C',
            tag_number: n,
            page_x0: 100,
            page_y0: 100 * i,
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow();
        ids[key] = row.id;
      }
    }
    await db
      .insertInto('tag_counters')
      .values({ project_id: projectId, scope_key: '', prefix: 'C', last_number: 7 })
      .execute();
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('a delete alone frees no number; the counter continues from the counter row', async () => {
    const del = await post('/line-first/pieces/delete', {
      who: WHO,
      member_ids: [ids.a2!, ids.a4!],
    });
    expect(del.statusCode).toBe(200);
    // a person types a tag on a5 (C7 -> C40); it must never be renumbered
    const typed = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.a5}`,
      payload: { who: WHO, tag_text: 'C40' },
    });
    expect(typed.statusCode).toBe(200);
    const preview = (await get('/tags/renumber')).json();
    // a1 C1 stays; a3 C3 -> C2; b1 C6 -> C3; b2 C7 -> C4
    expect(preview).toMatchObject({ changes: 3, by_prefix: { C: 3 }, duplicates: 0 });
  });

  it('renumbers as one action; typed tags untouched; the counter follows; undo and redo restore', async () => {
    const res = await post('/tags/renumber', { who: WHO });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(3);
    const a = await tagsOf(pageA);
    const b = await tagsOf(pageB);
    expect([a[ids.a1!], a[ids.a3!], a[ids.a5!]]).toEqual(['C1', 'C2', 'C40']);
    expect([b[ids.b1!], b[ids.b2!]]).toEqual(['C3', 'C4']);
    const rows = await db
      .selectFrom('member_edits')
      .select(['action_id', 'reason'])
      .where('field_name', '=', 'tag')
      .where('reason', '=', RENUMBER_REASON)
      .where('member_id', 'in', Object.values(ids))
      .execute();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.action_id)).size).toBe(1);
    const log = await db
      .selectFrom('count_actions')
      .select(['action', 'detail'])
      .where('project_id', '=', projectId)
      .where('edit_action_id', '=', res.json().action_id)
      .executeTakeFirstOrThrow();
    expect(log.action).toBe('edit');
    expect(log.detail).toMatchObject({ change: 'renumber_tags', changed: 3 });
    expect((await get('/tags/renumber')).json().changes).toBe(0);
    // the counter row is back at the highest number in use (C40, typed), so the next is C41
    expect(await takeTagNumbers(db, projectId, pageA, 'C')).toBe(41);

    expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    expect((await tagsOf(pageB))[ids.b2!]).toBe('C7');
    expect((await tagsOf(pageA))[ids.a3!]).toBe('C3');
    expect((await post('/redo', { who: WHO })).statusCode).toBe(200);
    expect((await tagsOf(pageB))[ids.b2!]).toBe('C4');
    expect((await tagsOf(pageA))[ids.a5!]).toBe('C40');
  });

  it('a deleted piece brought back after a renumber shows a duplicate tag; renumber clears it', async () => {
    // a2 (deleted, still C2) comes back, as an undo of its delete would do; a3 is C2 since the renumber
    await recordAction(db, WHO, [
      { memberId: ids.a2!, field: 'review_status', before: 'rejected', after: 'edited' },
    ]);
    const dup = () =>
      get(`/sheets/${pageA}/line-first`).then(
        (r) =>
          Object.fromEntries(
            (r.json().pieces as { id: string; duplicate_tag: boolean }[]).map((p) => [
              p.id,
              p.duplicate_tag,
            ]),
          ) as Record<string, boolean>,
      );
    const before = await dup();
    expect([before[ids.a2!], before[ids.a3!], before[ids.a1!]]).toEqual([true, true, false]);
    expect((await get('/tags/renumber')).json().duplicates).toBe(2);
    await post('/tags/renumber', { who: WHO });
    const after = await dup();
    expect(Object.values(after).every((d) => d === false)).toBe(true);
    const a = await tagsOf(pageA);
    expect([a[ids.a1!], a[ids.a2!], a[ids.a3!], a[ids.a5!]]).toEqual(['C1', 'C2', 'C3', 'C40']);
  });
});
