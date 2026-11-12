// Phase 0 cover details: the project details panel and the drawing index check.
//   GET  /api/projects/:projectId/project-details                 fields (effective value, source), index check
//   POST /api/projects/:projectId/project-details/read            queue a read (worker job read_details)
//   POST /api/projects/:projectId/project-details/recheck         queue the index re-check only
//   PUT  /api/projects/:projectId/project-details/:field          { value | null, who, from_alternative? }
//   POST /api/projects/:projectId/project-details/:field/use-as-project  { who } project_name / project_number only
//   POST /api/projects/:projectId/project-details/undo            { who } the last edit of this person
// A person's edit is appended (project_detail_edits) and wins over the read value; a re-read never
// replaces it. "Use as project name / number" is a one-click logged edit of projects.name / number.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { HttpError } from './http-error.js';

type Db = Kysely<Database> | Transaction<Database>;

export const DETAIL_FIELDS = [
  'project_name',
  'project_number',
  'owner',
  'architect',
  'engineer',
  'contractor',
  'address',
  'location',
  'building_type',
  'date',
  'issue',
  'issue_status',
  'building_code',
  'risk_category',
  'load_ground_snow',
  'load_roof_snow',
  'load_wind_speed',
  'load_seismic_category',
  'load_site_class',
  'load_live',
  'load_dead',
] as const;
type Field = (typeof DETAIL_FIELDS)[number];

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const fieldParams = {
  type: 'object',
  required: ['projectId', 'field'],
  properties: { projectId: uuid, field: { type: 'string', enum: [...DETAIL_FIELDS] } },
} as const;

const trim = (v: string) => {
  const w = v.trim();
  if (!w) throw new HttpError(400, { error: 'who must not be blank' });
  return w;
};

interface Effective {
  value: string | null;
  edited: boolean;
  edited_by: string | null;
  edited_at: Date | null;
}

/** The latest edit of each field that has not been undone (kind edit / use_alternative). */
export async function effectiveEdits(db: Db, projectId: string): Promise<Map<string, Effective>> {
  const rows = await db
    .selectFrom('project_detail_edits as e')
    .selectAll('e')
    .where('e.project_id', '=', projectId)
    .where('e.kind', 'in', ['edit', 'use_alternative'])
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('project_detail_edits as u')
            .select('u.id')
            .whereRef('u.undo_of', '=', 'e.id'),
        ),
      ),
    )
    .orderBy('e.created_at')
    .orderBy('e.id')
    .execute();
  const out = new Map<string, Effective>();
  for (const r of rows) {
    const after = r.after as { value: string | null } | null;
    out.set(r.field, {
      value: after?.value ?? null,
      edited: true,
      edited_by: r.who,
      edited_at: r.created_at as unknown as Date,
    });
  }
  return out;
}

export const projectDetailsRoutes: FastifyPluginAsync<{ db?: Kysely<Database> }> = async (
  app,
  options,
) => {
  const db = () => options.db ?? getDb();
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function project(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .select(['id', 'name', 'number'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return p;
  }

  async function effectiveOf(trx: Db, projectId: string, field: string) {
    const edits = await effectiveEdits(trx, projectId);
    const e = edits.get(field);
    if (e) return e.value;
    const read = await trx
      .selectFrom('project_details')
      .select('value')
      .where('project_id', '=', projectId)
      .where('field', '=', field)
      .executeTakeFirst();
    return read?.value ?? null;
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/project-details',
    { schema: { params: projectParams } },
    async (request) => {
      const { projectId } = request.params;
      const p = await project(projectId);
      const [reads, readRow, edits, rows, flagRows, sheets] = await Promise.all([
        db()
          .selectFrom('project_details')
          .selectAll()
          .where('project_id', '=', projectId)
          .execute(),
        db()
          .selectFrom('project_detail_reads')
          .selectAll()
          .where('project_id', '=', projectId)
          .executeTakeFirst(),
        effectiveEdits(db(), projectId),
        db()
          .selectFrom('drawing_index_rows')
          .selectAll()
          .where('project_id', '=', projectId)
          .orderBy('page_index')
          .orderBy('number')
          .execute(),
        db()
          .selectFrom('drawing_index_flags')
          .selectAll()
          .where('project_id', '=', projectId)
          .orderBy('kind')
          .orderBy('number')
          .execute(),
        db()
          .selectFrom('sheets')
          .select(['id', 'page_index'])
          .where('project_id', '=', projectId)
          .execute(),
      ]);
      const byField = new Map(reads.map((r) => [r.field, r]));
      const sheetPage = new Map(sheets.map((s) => [s.id, s.page_index]));
      const fields = DETAIL_FIELDS.map((f) => {
        const r = byField.get(f);
        const e = edits.get(f);
        return {
          field: f,
          value: e ? e.value : (r?.value ?? null),
          read_value: r?.value ?? null,
          edited: !!e,
          edited_by: e?.edited_by ?? null,
          page_index: r?.page_index ?? null,
          box: (r?.box as number[] | undefined) ?? null,
          rule: r?.rule ?? null,
          confidence: r?.confidence ?? null,
          flags: r?.flags ?? [],
          alternatives: (r?.alternatives as unknown[] | undefined) ?? [],
          agreement: r?.agreement ?? null,
        };
      });
      const matched = rows.filter((r) => r.match !== 'none').length;
      const status = !readRow
        ? 'not_read'
        : readRow.no_text_pages.length > 0 && reads.length === 0
          ? 'no_text'
          : 'read';
      return {
        status,
        project: { name: p.name, number: p.number },
        read: readRow
          ? {
              read_at: readRow.read_at,
              cover_pages: readRow.cover_pages,
              no_text_pages: readRow.no_text_pages,
              pages: readRow.pages,
              seconds: readRow.seconds === null ? null : Number(readRow.seconds),
            }
          : null,
        fields,
        index: {
          rows: rows.map((r) => ({
            id: r.id,
            page_index: r.page_index,
            number: r.number,
            title: r.title,
            box: r.box,
            match: r.match,
            matched_page: r.matched_page,
            matched_sheet_id: r.matched_sheet_id,
          })),
          flags: flagRows.map((f) => ({
            id: f.id,
            kind: f.kind,
            number: f.number,
            title: f.title,
            detail: f.detail,
            sheet_id: f.sheet_id,
            // the page to jump to: ours, else the index page that lists it
            page_index: f.sheet_id
              ? (sheetPage.get(f.sheet_id) ?? f.page_index)
              : (f.page_index ?? f.index_page),
            index_page: f.index_page,
          })),
          summary: {
            rows: rows.length,
            matched,
            percent: rows.length ? Math.round((1000 * matched) / rows.length) / 10 : null,
          },
        },
      };
    },
  );

  const queue = async (projectId: string, mode: 'read' | 'recheck') => {
    await project(projectId);
    const open = await db()
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', 'read_details')
      .where('status', 'in', ['pending', 'processing'])
      .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
      .executeTakeFirst();
    if (open) return { job_id: open.id, queued: false };
    const job = await db()
      .insertInto('jobs')
      .values({ type: 'read_details', payload: JSON.stringify({ project_id: projectId, mode }) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { job_id: job.id, queued: true };
  };
  for (const mode of ['read', 'recheck'] as const)
    app.post<{ Params: { projectId: string }; Body: { who: string } }>(
      `/api/projects/:projectId/project-details/${mode}`,
      {
        schema: {
          params: projectParams,
          body: {
            type: 'object',
            required: ['who'],
            additionalProperties: false,
            properties: { who },
          },
        },
      },
      async (request, reply) => {
        trim(request.body.who);
        return reply.status(202).send(await queue(request.params.projectId, mode));
      },
    );

  app.put<{
    Params: { projectId: string; field: Field };
    Body: { value: string | null; who: string; from_alternative?: boolean };
  }>(
    '/api/projects/:projectId/project-details/:field',
    {
      schema: {
        params: fieldParams,
        body: {
          type: 'object',
          required: ['value', 'who'],
          additionalProperties: false,
          properties: {
            value: { type: ['string', 'null'], maxLength: 400 },
            who,
            from_alternative: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { projectId, field } = request.params;
      await project(projectId);
      const editor = trim(request.body.who);
      const value = request.body.value === null ? null : request.body.value.trim() || null;
      const id = await db()
        .transaction()
        .execute(async (trx) => {
          const before = await effectiveOf(trx, projectId, field);
          const row = await trx
            .insertInto('project_detail_edits')
            .values({
              project_id: projectId,
              field,
              before: JSON.stringify({ value: before }),
              after: JSON.stringify({ value }),
              kind: request.body.from_alternative ? 'use_alternative' : 'edit',
              who: editor,
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          return row.id;
        });
      return { id, field, value };
    },
  );

  app.post<{
    Params: { projectId: string; field: Field };
    Body: { who: string };
  }>(
    '/api/projects/:projectId/project-details/:field/use-as-project',
    {
      schema: {
        params: fieldParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who },
        },
      },
    },
    async (request) => {
      const { projectId, field } = request.params;
      if (field !== 'project_name' && field !== 'project_number')
        throw new HttpError(400, {
          error: 'only the project name and number can be used as the project',
        });
      const p = await project(projectId);
      const editor = trim(request.body.who);
      const out = await db()
        .transaction()
        .execute(async (trx) => {
          const value = await effectiveOf(trx, projectId, field);
          if (!value) throw new HttpError(409, { error: 'this field has no value' });
          const column = field === 'project_name' ? 'name' : 'number';
          const old = column === 'name' ? p.name : p.number;
          await trx
            .updateTable('projects')
            .set({ [column]: value } as never)
            .where('id', '=', projectId)
            .execute();
          const row = await trx
            .insertInto('project_detail_edits')
            .values({
              project_id: projectId,
              field,
              before: JSON.stringify({ projects_value: old }),
              after: JSON.stringify({ value }),
              kind: 'use_as_project',
              who: editor,
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          return { id: row.id, value, previous: old };
        });
      return out;
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/project-details/undo',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      await project(projectId);
      const editor = trim(request.body.who);
      const out = await db()
        .transaction()
        .execute(async (trx) => {
          const last = await trx
            .selectFrom('project_detail_edits as e')
            .selectAll('e')
            .where('e.project_id', '=', projectId)
            .where('e.who', '=', editor)
            .where('e.kind', '<>', 'undo')
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('project_detail_edits as u')
                    .select('u.id')
                    .whereRef('u.undo_of', '=', 'e.id'),
                ),
              ),
            )
            .orderBy('e.created_at', 'desc')
            .orderBy('e.id', 'desc')
            .executeTakeFirst();
          if (!last) throw new HttpError(409, { error: 'nothing to undo' });
          if (last.kind === 'use_as_project') {
            const prev = (last.before as { projects_value: string | null }).projects_value;
            const column = last.field === 'project_name' ? 'name' : 'number';
            await trx
              .updateTable('projects')
              .set({ [column]: prev } as never)
              .where('id', '=', projectId)
              .execute();
          }
          await trx
            .insertInto('project_detail_edits')
            .values({
              project_id: projectId,
              field: last.field,
              before: last.after === null ? null : JSON.stringify(last.after),
              after: last.before === null ? null : JSON.stringify(last.before),
              kind: 'undo',
              undo_of: last.id,
              who: editor,
            } as never)
            .execute();
          return { undone: last.id, field: last.field, kind: last.kind };
        });
      return out;
    },
  );
};
