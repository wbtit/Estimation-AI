// Review screen endpoints that are not about views or members.
//   PATCH /api/projects/:projectId/sheets/:sheetId/page-type  { value|null, editor, reason? }
//   PATCH /api/projects/:projectId/sheets/:sheetId/level      { value|null, editor, reason? }
//   GET   /api/projects/:projectId/notes                      text lines of the general-notes pages
//   POST  /api/projects/:projectId/rescan                     re-run the scan (guesses refresh; overrides stay)
//
// Page type and level are GUESSES; a person's choice is an append-only sheet_edits row (before and
// after, who, when) and the extracted guess is never overwritten.
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, PageType } from '../db/types.js';
import { loadSheetOverrides } from '../review/overrides.js';
import { HttpError } from './http-error.js';

export interface ReviewRouteOptions {
  db?: Kysely<Database>;
}

export const PAGE_TYPES: readonly PageType[] = [
  'framing_plan',
  'foundation_plan',
  'elevation',
  'detail',
  'schedule_legend',
  'general_notes',
  'other',
];

const uuid = { type: 'string', format: 'uuid' } as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const overrideBody = (valueSchema: object) =>
  ({
    type: 'object',
    required: ['value', 'editor'],
    additionalProperties: false,
    properties: {
      value: valueSchema,
      editor: { type: 'string', minLength: 1, maxLength: 100 },
      reason: { type: ['string', 'null'], maxLength: 500 },
    },
  }) as const;

export const reviewRoutes: FastifyPluginAsync<ReviewRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function setOverride(
    projectId: string,
    sheetId: string,
    field: 'page_type' | 'level',
    value: string | null,
    editor: string,
    reason: string | null | undefined,
  ) {
    const sheet = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!sheet) throw new HttpError(404, { error: 'sheet not found' });
    const who = editor.trim();
    if (who === '') throw new HttpError(400, { error: 'editor must not be blank' });
    const overrides = (await loadSheetOverrides(db(), [sheetId])).get(sheetId) ?? {};
    const guess = field === 'page_type' ? sheet.page_type_guess : sheet.level_guess;
    const before = overrides[field] ?? guess ?? null;
    const after = value ?? guess ?? null;
    await db()
      .insertInto('sheet_edits')
      .values({
        sheet_id: sheetId,
        field_name: field,
        original_value: JSON.stringify(before),
        corrected_value: JSON.stringify(value),
        editor: who,
        reason: reason ?? null,
      })
      .execute();
    return { sheet_id: sheetId, field, before, after, overridden: value !== null };
  }

  app.patch<{
    Params: { projectId: string; sheetId: string };
    Body: { value: PageType | null; editor: string; reason?: string | null };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/page-type',
    {
      schema: {
        params: sheetParams,
        body: overrideBody({ anyOf: [{ enum: [...PAGE_TYPES] }, { type: 'null' }] }),
      },
    },
    async (request) =>
      setOverride(
        request.params.projectId,
        request.params.sheetId,
        'page_type',
        request.body.value,
        request.body.editor,
        request.body.reason,
      ),
  );

  app.patch<{
    Params: { projectId: string; sheetId: string };
    Body: { value: string | null; editor: string; reason?: string | null };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/level',
    {
      schema: {
        params: sheetParams,
        body: overrideBody({ type: ['string', 'null'], maxLength: 60 }),
      },
    },
    async (request) => {
      const value = request.body.value === null ? null : request.body.value.trim();
      if (value === '')
        throw new HttpError(400, { error: 'level must not be blank (send null to clear)' });
      return setOverride(
        request.params.projectId,
        request.params.sheetId,
        'level',
        value,
        request.body.editor,
        request.body.reason,
      );
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/notes',
    { schema: { params: projectParams } },
    async (request) => {
      const { projectId } = request.params;
      const sheets = await db()
        .selectFrom('sheets')
        .selectAll()
        .where('project_id', '=', projectId)
        .orderBy('page_index')
        .execute();
      const overrides = await loadSheetOverrides(
        db(),
        sheets.map((s) => s.id),
      );
      const notes = sheets.filter((s) => {
        const o = overrides.get(s.id)?.page_type;
        return (o ?? s.page_type_guess) === 'general_notes';
      });
      const out = [];
      for (const s of notes) {
        const lines = await db()
          .selectFrom('text_items')
          .select(['text', 'x0', 'y0', 'x1', 'y1'])
          .where('sheet_id', '=', s.id)
          .where('level', '=', 'line')
          .orderBy('y0')
          .orderBy('x0')
          .execute();
        out.push({
          sheet_id: s.id,
          page_number: s.page_index + 1,
          sheet_number: s.sheet_number,
          lines: lines.map((l) => ({
            text: l.text ?? '',
            bbox: { x0: Number(l.x0), y0: Number(l.y0), x1: Number(l.x1), y1: Number(l.y1) },
          })),
        });
      }
      return { sheets: out };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/rescan',
    { schema: { params: projectParams } },
    async (request, reply) => {
      const { projectId } = request.params;
      const file = await db()
        .selectFrom('project_files')
        .select(['id', 'scan_status'])
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file) throw new HttpError(404, { error: 'this project has no PDF yet' });
      const open = await db()
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'scan_pdf')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
        .executeTakeFirst();
      if (open)
        throw new HttpError(409, { error: 'a scan is already queued or running', job_id: open.id });
      const job = await db()
        .insertInto('jobs')
        .values({
          type: 'scan_pdf',
          payload: JSON.stringify({ project_id: projectId, document_id: file.id }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, status: 'pending' });
    },
  );
};
