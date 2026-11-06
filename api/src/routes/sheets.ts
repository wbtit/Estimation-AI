// Sheets (one per PDF page): thumbnails, and a person's page name and sheet number.
//   GET   /api/projects/:projectId/sheets/:sheetId/thumbnail
//   PATCH /api/projects/:projectId/sheets/:sheetId/names   { name?: string | null, sheet_number?, who }
//
// Names (migration 030): the names read on the page are never overwritten; a person's page name is
// stored in name_override (null or blank = back to the name read on the page). A person's sheet
// number is written in place with sheet_number_source 'person' (the scan keeps it). Every change is
// an append-only sheet_edits row (the shown value before and after, who, when).
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { resolveUploadDir } from '../config.js';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { HttpError } from './http-error.js';

export interface SheetRouteOptions {
  db?: Kysely<Database>;
  /** Absolute directory holding thumbnails. Default: UPLOAD_DIR or <repo>/uploads. */
  uploadDir?: string;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;

export const sheetRoutes: FastifyPluginAsync<SheetRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();
  const uploadDir = options.uploadDir ?? resolveUploadDir(process.env.UPLOAD_DIR);

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadSheet(projectId: string, sheetId: string) {
    const sheet = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!sheet) throw new HttpError(404, { error: 'sheet not found' });
    return sheet;
  }

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/thumbnail',
    { schema: { params: sheetParams } },
    async (request, reply) => {
      const sheet = await loadSheet(request.params.projectId, request.params.sheetId);
      if (!sheet.thumbnail_path) throw new HttpError(404, { error: 'no thumbnail for this sheet' });
      const file = path.resolve(uploadDir, sheet.thumbnail_path);
      if (!file.startsWith(uploadDir + path.sep))
        throw new HttpError(404, { error: 'thumbnail not found' });
      try {
        await fs.promises.access(file, fs.constants.R_OK);
      } catch {
        throw new HttpError(404, { error: 'thumbnail not found' });
      }
      return reply
        .header('content-type', 'image/png')
        .header('cache-control', 'private, max-age=300')
        .send(fs.createReadStream(file));
    },
  );

  app.patch<{
    Params: { projectId: string; sheetId: string };
    Body: { name?: string | null; sheet_number?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/names',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            name: { type: ['string', 'null'], maxLength: 200 },
            sheet_number: { type: 'string', maxLength: 40 },
            who: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const body = request.body;
      const editor = body.who.trim();
      if (editor === '') throw new HttpError(400, { error: 'who must not be blank' });
      if (body.name === undefined && body.sheet_number === undefined)
        throw new HttpError(400, { error: 'give a name or a sheet_number' });
      const number = body.sheet_number?.trim();
      if (number === '') throw new HttpError(400, { error: 'the sheet number must not be blank' });
      const name = body.name === undefined ? undefined : body.name?.trim() || null;
      return db()
        .transaction()
        .execute(async (trx) => {
          const s = await trx
            .selectFrom('sheets')
            .selectAll()
            .where('id', '=', sheetId)
            .where('project_id', '=', projectId)
            .forUpdate()
            .executeTakeFirst();
          if (!s) throw new HttpError(404, { error: 'sheet not found' });
          const now = new Date();
          const edits: { field_name: string; before: unknown; after: unknown }[] = [];
          const set: Record<string, unknown> = {};
          if (name !== undefined) {
            const shown = (o: string | null) => o ?? s.view_title ?? s.title_block_name ?? null;
            edits.push({
              field_name: 'page_name',
              before: shown(s.name_override),
              after: shown(name),
            });
            Object.assign(set, {
              name_override: name,
              name_confirmed_by: editor,
              name_confirmed_at: now,
            });
          }
          if (number !== undefined) {
            edits.push({ field_name: 'sheet_number', before: s.sheet_number, after: number });
            Object.assign(set, {
              sheet_number: number,
              sheet_number_source: 'person',
              sheet_number_confirmed_by: editor,
              sheet_number_confirmed_at: now,
            });
          }
          await trx.updateTable('sheets').set(set).where('id', '=', s.id).execute();
          await trx
            .insertInto('sheet_edits')
            .values(
              edits.map((e) => ({
                sheet_id: s.id,
                field_name: e.field_name,
                original_value: JSON.stringify(e.before ?? null),
                corrected_value: JSON.stringify(e.after ?? null),
                editor,
              })),
            )
            .execute();
          const after = await trx
            .selectFrom('sheets')
            .select(['sheet_number', 'name_override', 'view_title', 'title_block_name'])
            .where('id', '=', s.id)
            .executeTakeFirstOrThrow();
          return {
            ok: true,
            sheet_number: after.sheet_number,
            name: after.name_override ?? after.view_title ?? after.title_block_name ?? null,
            name_override: after.name_override,
          };
        });
    },
  );
};
