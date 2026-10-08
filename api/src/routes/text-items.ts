// Text read from sheets (Phase 4b).
//   GET  /api/projects/:projectId/sheets/:sheetId/text-items[?needs_review=true]
//   POST /api/projects/:projectId/read-text        enqueue the read_text job for the project's PDF
//
// text is what the deterministic glyph reader decoded; ocr_text (if the optional cross-check ran)
// is kept beside it and never replaces it. A null text means "not read" (for example vertical text).
// Items read from the PDF text layer (methods ['pdf_text']) also carry level (word|line), the
// baseline angle and the deterministic parser output (`parsed`); mark candidates never claim a member.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, TextItemsTable } from '../db/types.js';
import { HttpError } from './http-error.js';

export interface TextItemRouteOptions {
  db?: Kysely<Database>;
}

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
const listQuery = {
  type: 'object',
  properties: { needs_review: { type: 'boolean' } },
  additionalProperties: false,
} as const;
const readBody = {
  type: ['object', 'null'],
  properties: { font_id: { type: 'string', minLength: 1, maxLength: 100 } },
  additionalProperties: false,
} as const;

const num = (v: string): number => Number(v);

export function textItemView(item: Selectable<TextItemsTable>) {
  return {
    id: item.id,
    item_key: item.item_key,
    bbox: { x0: num(item.x0), y0: num(item.y0), x1: num(item.x1), y1: num(item.y1) },
    orientation: item.orientation,
    text: item.text,
    ocr_text: item.ocr_text,
    methods: item.methods,
    confidence: item.confidence === null ? null : num(item.confidence),
    agree: item.agree,
    needs_review: item.needs_review,
    review_reasons: item.review_reasons,
    char_count: item.char_count,
    unknown_count: item.unknown_count,
    font_id: item.font_id,
    level: item.level,
    angle_deg: item.angle_deg === null ? null : num(item.angle_deg),
    parsed: item.parsed,
  };
}

export const textItemRoutes: FastifyPluginAsync<TextItemRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.get<{
    Params: { projectId: string; sheetId: string };
    Querystring: { needs_review?: boolean };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/text-items',
    { schema: { params: sheetParams, querystring: listQuery } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const sheet = await db()
        .selectFrom('sheets')
        .select('id')
        .where('id', '=', sheetId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!sheet) throw new HttpError(404, { error: 'sheet not found' });

      let query = db().selectFrom('text_items').selectAll().where('sheet_id', '=', sheetId);
      if (request.query.needs_review !== undefined) {
        query = query.where('needs_review', '=', request.query.needs_review);
      }
      const items = await query.orderBy('y0').orderBy('x0').execute();
      return {
        sheet_id: sheetId,
        count: items.length,
        needs_review: items.filter((i) => i.needs_review).length,
        items: items.map(textItemView),
      };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { font_id?: string } | null }>(
    '/api/projects/:projectId/read-text',
    { schema: { params: projectParams, body: readBody } },
    async (request, reply) => {
      const { projectId } = request.params;
      const file = await db()
        .selectFrom('project_files')
        .select(['id', 'scan_status'])
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file) {
        const project = await db()
          .selectFrom('projects')
          .select('id')
          .where('id', '=', projectId)
          .executeTakeFirst();
        throw new HttpError(project ? 409 : 404, {
          error: project ? 'this project has no PDF yet' : 'project not found',
        });
      }
      if (file.scan_status !== 'done') {
        throw new HttpError(409, {
          error: 'the PDF scan is not finished; text can be read after it',
        });
      }
      const open = await db()
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'read_text')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
        .executeTakeFirst();
      if (open)
        throw new HttpError(409, {
          error: 'a text read is already queued or running',
          job_id: open.id,
        });

      const payload: Record<string, string> = { project_id: projectId, document_id: file.id };
      if (request.body?.font_id) payload.font_id = request.body.font_id;
      const job = await db()
        .insertInto('jobs')
        .values({ type: 'read_text', payload: JSON.stringify(payload) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, status: 'pending' });
    },
  );
};
