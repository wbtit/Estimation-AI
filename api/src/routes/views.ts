// Views: a box drawn on a sheet, with its own scale (a page can hold several scales).
//   GET    /api/projects/:projectId/sheets/:sheetId/views
//   POST   /api/projects/:projectId/sheets/:sheetId/views        { box, name?, who }
//   PATCH  /api/projects/:projectId/views/:viewId                 { who, name?, box?, scale?, structural_classes? }
//   DELETE /api/projects/:projectId/views/:viewId                 (refused while members use the view)
//   GET    /api/projects/:projectId/pdf-file                      the stored PDF (byte ranges supported)
//
// The scale of a view is SUGGESTED from scale text inside or near the box; it is stored with its
// source (detected_text when the user accepts the suggestion, user_confirmed when typed) and is
// only effective once confirmed. Members cannot be measured before that.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { resolveUploadDir } from '../config.js';
import { getDb } from '../db/client.js';
import type { Database, SheetViewsTable } from '../db/types.js';
import { HttpError } from './http-error.js';

export interface ViewRouteOptions {
  db?: Kysely<Database>;
  uploadDir?: string;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export function viewJson(row: Selectable<SheetViewsTable>, suggestion: unknown = null) {
  return {
    id: row.id,
    sheet_id: row.sheet_id,
    name: row.name,
    box: row.box,
    scale: {
      ratio: num(row.scale_ratio),
      text: row.scale_text,
      source: row.scale_source,
      confirmed: row.scale_confirmed,
    },
    structural_classes: row.structural_classes,
    classes_confirmed: row.classes_confirmed,
    class_table: row.class_table,
    plan_frame: row.plan_frame,
    created_by: row.created_by,
    created_at: row.created_at,
    suggestion,
  };
}

export const viewRoutes: FastifyPluginAsync<ViewRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();
  const uploadDir = options.uploadDir ?? resolveUploadDir(process.env.UPLOAD_DIR);

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/pdf-file',
    { schema: { params: projectParams } },
    async (request, reply) => {
      const file = await db()
        .selectFrom('project_files')
        .select('stored_path')
        .where('project_id', '=', request.params.projectId)
        .executeTakeFirst();
      if (!file) throw new HttpError(404, { error: 'this project has no PDF yet' });
      const abs = path.resolve(uploadDir, file.stored_path);
      if (!abs.startsWith(uploadDir + path.sep))
        throw new HttpError(404, { error: 'file not found' });
      let size: number;
      try {
        size = (await fs.promises.stat(abs)).size;
      } catch {
        throw new HttpError(404, { error: 'file not found' });
      }
      reply.header('content-type', 'application/pdf').header('accept-ranges', 'bytes');
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ''));
      if (range && (range[1] !== '' || range[2] !== '')) {
        let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
        let end = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2]);
        start = Math.max(0, start);
        end = Math.min(size - 1, end);
        if (start > end || start >= size) {
          return reply.status(416).header('content-range', `bytes */${size}`).send();
        }
        return reply
          .status(206)
          .header('content-range', `bytes ${start}-${end}/${size}`)
          .header('content-length', end - start + 1)
          .send(fs.createReadStream(abs, { start, end }));
      }
      return reply.header('content-length', size).send(fs.createReadStream(abs));
    },
  );
};
