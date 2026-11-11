// Review 3 migrations 034 (Cover / Title page) and 035 (one Foundation / column plan role), run on
// SYNTHETIC rows of the test database inside a transaction that is rolled back.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { insertProject, deleteProject } from './helpers.js';

const db = getDb();
const dir = path.resolve(__dirname, '../../../db/migrations');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
const ROLLBACK = new Error('rollback');

afterAll(async () => {
  await closeDatabaseConnection();
});

describe('migration 034: Cover / Title page', () => {
  it('adds the role and the page type, and re-guesses stored pages (guess column only)', async () => {
    const projectId = await insertProject(db);
    try {
      await db
        .transaction()
        .execute(async (trx) => {
          const sheet = async (
            index: number,
            title: string | null,
            guess: string,
            viewTitle: string | null = null,
          ) =>
            (
              await trx
                .insertInto('sheets')
                .values({
                  project_id: projectId,
                  page_index: index,
                  kind: 'other',
                  page_kind: 'vector',
                  scales: '[]',
                  review_reasons: [],
                  title,
                  view_title: viewTitle,
                  page_type_guess: guess,
                } as never)
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
          const ids = {
            cover: await sheet(0, 'COVER SHEET', 'general_notes'),
            first: await sheet(1, null, 'other'), // not the first page: unchanged
            firstNotes: await sheet(2, 'INDEX OF DRAWINGS', 'general_notes'),
            plan: await sheet(3, 'ROOF FRAMING PLAN', 'framing_plan'),
            notes: await sheet(4, 'GENERAL NOTES', 'general_notes'),
          };
          await sql.raw(read('034_cover_sheet.sql')).execute(trx);
          const guess = async (id: string) =>
            (
              await trx
                .selectFrom('sheets')
                .select('page_type_guess')
                .where('id', '=', id)
                .executeTakeFirstOrThrow()
            ).page_type_guess;
          expect(await guess(ids.cover)).toBe('cover_sheet');
          expect(await guess(ids.firstNotes)).toBe('cover_sheet'); // the title names an index
          expect(await guess(ids.plan)).toBe('framing_plan');
          expect(await guess(ids.notes)).toBe('general_notes'); // notes are not a cover
          expect(await guess(ids.first)).toBe('other'); // page_index 1: not the first page
          const role = await trx
            .selectFrom('role_names')
            .select(['behaviour', 'built_in'])
            .where('name', '=', 'Cover / Title page')
            .executeTakeFirstOrThrow();
          expect(role).toEqual({ behaviour: 'none', built_in: true });
          // the page type check refuses a made-up type (and the failed statement is undone)
          await sql`SAVEPOINT sp`.execute(trx);
          await expect(
            trx
              .updateTable('sheets')
              .set({ page_type_guess: 'nonsense' } as never)
              .where('id', '=', ids.plan)
              .execute(),
          ).rejects.toThrow();
          await sql`ROLLBACK TO SAVEPOINT sp`.execute(trx);
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
    } finally {
      await deleteProject(db, projectId);
    }
  });

  it('the first page (index 0) with no plan text is re-guessed; with plan text in the view title it is not', async () => {
    const projectId = await insertProject(db);
    try {
      await db
        .transaction()
        .execute(async (trx) => {
          const make = async (title: string | null, viewTitle: string | null) =>
            (
              await trx
                .insertInto('sheets')
                .values({
                  project_id: projectId,
                  page_index: 0,
                  kind: 'other',
                  page_kind: 'vector',
                  scales: '[]',
                  review_reasons: [],
                  title,
                  view_title: viewTitle,
                  page_type_guess: 'general_notes',
                } as never)
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
          const a = await make('GENERAL NOTES', null);
          await sql.raw(read('034_cover_sheet.sql')).execute(trx);
          expect(
            (
              await trx
                .selectFrom('sheets')
                .select('page_type_guess')
                .where('id', '=', a)
                .executeTakeFirstOrThrow()
            ).page_type_guess,
          ).toBe('cover_sheet');
          await trx
            .updateTable('sheets')
            .set({ page_type_guess: 'general_notes', view_title: 'FOUNDATION PLAN' } as never)
            .where('id', '=', a)
            .execute();
          await sql.raw(read('034_cover_sheet.sql')).execute(trx);
          expect(
            (
              await trx
                .selectFrom('sheets')
                .select('page_type_guess')
                .where('id', '=', a)
                .executeTakeFirstOrThrow()
            ).page_type_guess,
          ).toBe('general_notes');
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
    } finally {
      await deleteProject(db, projectId);
    }
  });
});

describe('migration 035: one Foundation / column plan role', () => {
  it('moves "Column plan" and "Foundation plan" views to one role; Pile plan stays; nothing else changes', async () => {
    const projectId = await insertProject(db);
    try {
      await db
        .transaction()
        .execute(async (trx) => {
          // the state before 035: put the old role names back (this transaction is rolled back)
          await trx
            .updateTable('role_names')
            .set({ name: 'Foundation plan', position: 4 } as never)
            .where('name', '=', 'Foundation / column plan')
            .execute();
          await trx
            .insertInto('role_names')
            .values({
              name: 'Column plan',
              behaviour: 'column_plan',
              built_in: true,
              position: 1,
            } as never)
            .execute();
          const view = async (index: number, role: string) => {
            const s = (
              await trx
                .insertInto('sheets')
                .values({
                  project_id: projectId,
                  page_index: index,
                  kind: 'plan',
                  page_kind: 'vector',
                  scales: '[]',
                  review_reasons: [],
                } as never)
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
            // every sheet has its first view already (a database trigger)
            const v = await trx
              .selectFrom('build_views')
              .select('id')
              .where('sheet_id', '=', s)
              .where('position', '=', 1)
              .executeTakeFirstOrThrow();
            await trx
              .updateTable('build_views')
              .set({ role_name: role } as never)
              .where('id', '=', v.id)
              .execute();
            return v.id;
          };
          const colPlan = await view(0, 'Column plan');
          const foundation = await view(1, 'Foundation plan');
          const pile = await view(2, 'Pile plan');
          const framing = await view(3, 'Framing plan');
          await sql.raw(read('035_foundation_column_plan_role.sql')).execute(trx);
          const roleOf = async (id: string) =>
            (
              await trx
                .selectFrom('build_views')
                .select('role_name')
                .where('id', '=', id)
                .executeTakeFirstOrThrow()
            ).role_name;
          expect(await roleOf(colPlan)).toBe('Foundation / column plan');
          expect(await roleOf(foundation)).toBe('Foundation / column plan');
          expect(await roleOf(pile)).toBe('Pile plan');
          expect(await roleOf(framing)).toBe('Framing plan');
          const roles = await trx
            .selectFrom('role_names')
            .select(['name', 'behaviour', 'position'])
            .where('built_in', '=', true)
            .orderBy('position')
            .execute();
          const names = roles.map((r) => r.name);
          expect(names[0]).toBe('Foundation / column plan');
          expect(names).not.toContain('Column plan');
          expect(names).not.toContain('Foundation plan');
          expect(names).toContain('Pile plan');
          expect(roles[0]!.behaviour).toBe('column_plan'); // the behaviour is what the build reads
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
    } finally {
      await deleteProject(db, projectId);
    }
  });
});
