// Sheets (one per PDF page), thumbnails and the manual scale override.
//   GET   /api/projects/:projectId/sheets
//   GET   /api/projects/:projectId/sheets/:sheetId
//   GET   /api/projects/:projectId/sheets/:sheetId/thumbnail
//   PATCH /api/projects/:projectId/sheets/:sheetId/scale-override   { scale|null, editor, reason? }
//
// The extracted scale is never overwritten. An override lives in its own columns and every
// change is an append-only row in sheet_edits (the effective value before and after, who, when).
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
};
