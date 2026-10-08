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
import type { Database, SheetViewsTable, ViewBox } from '../db/types.js';
import {
  boxProblem,
  normaliseBox,
  planFrameOf,
  suggestScale,
  type ScaleItem,
} from '../review/geometry.js';
import { parseScaleExact } from '../scale/index.js';
import { HttpError } from './http-error.js';

export interface ViewRouteOptions {
  db?: Kysely<Database>;
  uploadDir?: string;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const boxSchema = {
  type: 'object',
  required: ['x0', 'y0', 'x1', 'y1'],
  additionalProperties: false,
  properties: {
    x0: { type: 'number' },
    y0: { type: 'number' },
    x1: { type: 'number' },
    y1: { type: 'number' },
  },
} as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const viewParams = {
  type: 'object',
  required: ['projectId', 'viewId'],
  properties: { projectId: uuid, viewId: uuid },
} as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const createBody = {
  type: 'object',
  required: ['box', 'who'],
  additionalProperties: false,
  properties: {
    box: boxSchema,
    name: { type: ['string', 'null'], maxLength: 100 },
    who: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;
const patchBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: ['string', 'null'], maxLength: 100 },
    box: boxSchema,
    structural_classes: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
    scale: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: { enum: ['confirm_suggestion', 'set', 'clear'] },
        text: { type: 'string', maxLength: 100 },
        ratio: { type: 'number', exclusiveMinimum: 0 },
      },
    },
  },
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

interface ScaleEntryJson {
  kind?: string;
  raw?: string;
  ratio?: number | null;
}

export async function scaleItemsOfSheet(
  db: Kysely<Database>,
  sheetId: string,
): Promise<ScaleItem[]> {
  const rows = await db
    .selectFrom('text_items')
    .select(['x0', 'y0', 'x1', 'y1', 'parsed'])
    .where('sheet_id', '=', sheetId)
    .where('level', '=', 'line')
    .where('parsed', 'is not', null)
    .execute();
  const out: ScaleItem[] = [];
  for (const r of rows) {
    const parsed = (Array.isArray(r.parsed) ? r.parsed : []) as ScaleEntryJson[];
    for (const e of parsed) {
      if (e.kind === 'scale' && typeof e.raw === 'string') {
        out.push({
          bbox: { x0: Number(r.x0), y0: Number(r.y0), x1: Number(r.x1), y1: Number(r.y1) },
          raw: e.raw,
          ratio: typeof e.ratio === 'number' ? e.ratio : null,
        });
      }
    }
  }
  return out;
}

export const viewRoutes: FastifyPluginAsync<ViewRouteOptions> = async (app, options) => {
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

  async function loadView(projectId: string, viewId: string) {
    const row = await db()
      .selectFrom('sheet_views as v')
      .innerJoin('sheets as s', 's.id', 'v.sheet_id')
      .selectAll('v')
      .select('s.project_id as project_id')
      .where('v.id', '=', viewId)
      .where('s.project_id', '=', projectId)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, { error: 'view not found' });
    return row;
  }

  async function suggestionFor(sheetId: string, box: ViewBox) {
    return suggestScale(box, await scaleItemsOfSheet(db(), sheetId));
  }

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/views',
    { schema: { params: sheetParams } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      await loadSheet(projectId, sheetId);
      const rows = await db()
        .selectFrom('sheet_views')
        .selectAll()
        .where('sheet_id', '=', sheetId)
        .orderBy('created_at')
        .execute();
      const items = await scaleItemsOfSheet(db(), sheetId);
      return {
        views: rows.map((r) =>
          viewJson(r, r.scale_confirmed ? null : suggestScale(r.box as ViewBox, items)),
        ),
      };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { box: ViewBox; name?: string | null; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/views',
    { schema: { params: sheetParams, body: createBody } },
    async (request, reply) => {
      const { projectId, sheetId } = request.params;
      const sheet = await loadSheet(projectId, sheetId);
      const box = normaliseBox(request.body.box);
      const problem = boxProblem(
        box,
        Number(sheet.width_pt ?? Infinity),
        Number(sheet.height_pt ?? Infinity),
      );
      if (problem) throw new HttpError(400, { error: problem });
      const row = await db()
        .insertInto('sheet_views')
        .values({
          sheet_id: sheetId,
          name: request.body.name ?? null,
          box: JSON.stringify(box),
          plan_frame: JSON.stringify(planFrameOf(box)),
          created_by: request.body.who.trim(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return reply.status(201).send(viewJson(row, await suggestionFor(sheetId, box)));
    },
  );

  app.patch<{
    Params: { projectId: string; viewId: string };
    Body: {
      who: string;
      name?: string | null;
      box?: ViewBox;
      structural_classes?: string[];
      scale?: { action: 'confirm_suggestion' | 'set' | 'clear'; text?: string; ratio?: number };
    };
  }>(
    '/api/projects/:projectId/views/:viewId',
    { schema: { params: viewParams, body: patchBody } },
    async (request) => {
      const { projectId, viewId } = request.params;
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const view = await loadView(projectId, viewId);
      const sheet = await loadSheet(projectId, view.sheet_id);
      const update: Record<string, unknown> = {};

      let box = view.box as ViewBox;
      if (request.body.box) {
        box = normaliseBox(request.body.box);
        const problem = boxProblem(
          box,
          Number(sheet.width_pt ?? Infinity),
          Number(sheet.height_pt ?? Infinity),
        );
        if (problem) throw new HttpError(400, { error: problem });
        update.box = JSON.stringify(box);
        update.plan_frame = JSON.stringify(planFrameOf(box));
      }
      if (request.body.name !== undefined) update.name = request.body.name;
      if (request.body.structural_classes)
        update.structural_classes = request.body.structural_classes;

      const scale = request.body.scale;
      let auditAfter: Record<string, unknown> | null = null;
      if (scale) {
        if (scale.action === 'clear') {
          Object.assign(update, {
            scale_ratio: null,
            scale_text: null,
            scale_source: null,
            scale_confirmed: false,
          });
          auditAfter = { ratio: null, confirmed: false };
        } else if (scale.action === 'confirm_suggestion') {
          const s = await suggestionFor(sheet.id, box);
          if (!s) throw new HttpError(409, { error: 'there is no scale suggestion for this view' });
          Object.assign(update, {
            scale_ratio: s.ratio,
            scale_text: s.raw,
            scale_source: 'detected_text',
            scale_confirmed: true,
          });
          auditAfter = { ratio: s.ratio, source: 'detected_text', confirmed: true };
        } else {
          let ratio: number | null = scale.ratio ?? null;
          let text: string | null = scale.text ?? null;
          if (ratio === null && text !== null) {
            const parsed = parseScaleExact(text);
            if (parsed === null || parsed.ratio === null) {
              throw new HttpError(400, {
                error:
                  'not a recognised scale with a ratio; use e.g. 1/8" = 1\'-0", 1" = 20\' or 1:96',
              });
            }
            ratio = parsed.ratio;
            text = parsed.raw;
          }
          if (ratio === null) throw new HttpError(400, { error: 'give a scale text or a ratio' });
          Object.assign(update, {
            scale_ratio: ratio,
            scale_text: text ?? `1:${ratio}`,
            scale_source: 'user_confirmed',
            scale_confirmed: true,
          });
          auditAfter = { ratio, source: 'user_confirmed', confirmed: true };
        }
      }

      if (Object.keys(update).length === 0)
        throw new HttpError(400, { error: 'nothing to change' });
      const row = await db()
        .transaction()
        .execute(async (trx) => {
          const saved = await trx
            .updateTable('sheet_views')
            .set(update)
            .where('id', '=', viewId)
            .returningAll()
            .executeTakeFirstOrThrow();
          if (auditAfter) {
            await trx
              .insertInto('sheet_edits')
              .values({
                sheet_id: sheet.id,
                field_name: 'view_scale',
                original_value: JSON.stringify({
                  view_id: viewId,
                  ratio: num(view.scale_ratio),
                  source: view.scale_source,
                  confirmed: view.scale_confirmed,
                }),
                corrected_value: JSON.stringify({ view_id: viewId, ...auditAfter }),
                editor: who,
                reason: null,
              })
              .execute();
          }
          return saved;
        });
      return viewJson(row, row.scale_confirmed ? null : await suggestionFor(sheet.id, box));
    },
  );

  app.delete<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId',
    { schema: { params: viewParams } },
    async (request, reply) => {
      const { projectId, viewId } = request.params;
      await loadView(projectId, viewId);
      const used = await db()
        .selectFrom('members')
        .select('id')
        .where('view_id', '=', viewId)
        .limit(1)
        .executeTakeFirst();
      if (used)
        throw new HttpError(409, { error: 'members use this view; delete or move them first' });
      await db().deleteFrom('sheet_views').where('id', '=', viewId).execute();
      return reply.status(204).send();
    },
  );

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
