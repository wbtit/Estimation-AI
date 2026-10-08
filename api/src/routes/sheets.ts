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
import type { Kysely, Selectable } from 'kysely';
import { resolveUploadDir } from '../config.js';
import { getDb } from '../db/client.js';
import type { Database, SheetsTable } from '../db/types.js';
import { parseScaleExact } from '../scale/index.js';
import { effectiveScale, sheetView, type SheetOverrides } from '../views.js';
import { loadSheetOverrides } from '../review/overrides.js';
import { HttpError } from './http-error.js';

export interface SheetRouteOptions {
  db?: Kysely<Database>;
  /** Absolute directory holding thumbnails. Default: UPLOAD_DIR or <repo>/uploads. */
  uploadDir?: string;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const overrideBody = {
  type: 'object',
  required: ['scale', 'editor'],
  additionalProperties: false,
  properties: {
    scale: { type: ['string', 'null'], maxLength: 100 },
    editor: { type: 'string', minLength: 1, maxLength: 100 },
    reason: { type: ['string', 'null'], maxLength: 500 },
  },
} as const;

interface OverrideBody {
  scale: string | null;
  editor: string;
  reason?: string | null;
}

const SCALE_REASONS = ['scale_not_found', 'multiple_scales'];

/**
 * Scale-related review reasons after an override is set or cleared. A manual scale resolves them.
 * Clearing it restores what the scan found, but only for pages the scan could read.
 */
export function reviewReasonsForScale(
  sheet: Pick<Selectable<SheetsTable>, 'review_reasons' | 'scales' | 'page_kind'>,
  hasOverride: boolean,
): string[] {
  const base = sheet.review_reasons.filter((r) => !SCALE_REASONS.includes(r));
  if (hasOverride || sheet.page_kind !== 'vector') return base;
  if (sheet.scales.length === 0) return [...base, 'scale_not_found'];
  if (sheet.scales.length > 1) return [...base, 'multiple_scales'];
  return base;
}

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

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sheets',
    { schema: { params: projectParams } },
    async (request) => {
      const { projectId } = request.params;
      const project = await db()
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project) throw new HttpError(404, { error: 'project not found' });
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
      return { sheets: sheets.map((s) => sheetView(s, overrides.get(s.id))) };
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId',
    { schema: { params: sheetParams } },
    async (request) => {
      const sheet = await loadSheet(request.params.projectId, request.params.sheetId);
      const overrides: Map<string, SheetOverrides> = await loadSheetOverrides(db(), [sheet.id]);
      return sheetView(sheet, overrides.get(sheet.id));
    },
  );

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

  app.patch<{ Params: { projectId: string; sheetId: string }; Body: OverrideBody }>(
    '/api/projects/:projectId/sheets/:sheetId/scale-override',
    { schema: { params: sheetParams, body: overrideBody } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const { scale, reason } = request.body;
      const editor = request.body.editor.trim();
      if (editor === '') throw new HttpError(400, { error: 'editor must not be blank' });

      const parsed = scale === null ? null : parseScaleExact(scale);
      if (scale !== null && parsed === null) {
        throw new HttpError(400, {
          error: 'not a recognised scale; use e.g. 1/8" = 1\'-0", 1" = 20\', 1:96 or NTS',
        });
      }

      const updated = await db()
        .transaction()
        .execute(async (trx) => {
          const sheet = await trx
            .selectFrom('sheets')
            .selectAll()
            .where('id', '=', sheetId)
            .where('project_id', '=', projectId)
            .forUpdate()
            .executeTakeFirst();
          if (!sheet) throw new HttpError(404, { error: 'sheet not found' });

          const before = effectiveScale(sheet);
          const overrideRaw = parsed?.raw ?? null;
          const overrideRatio = parsed?.ratio ?? null;
          // Same meaning = same kind and ratio (spacing differences do not count). The kind matters:
          // NTS has a null ratio, which must not be confused with "no override".
          const current =
            sheet.scale_override === null ? null : parseScaleExact(sheet.scale_override);
          const unchanged =
            parsed === null
              ? sheet.scale_override === null
              : current !== null && current.kind === parsed.kind && current.ratio === parsed.ratio;
          if (unchanged) return sheet;

          const reasons = reviewReasonsForScale(sheet, overrideRaw !== null);
          const after = await trx
            .updateTable('sheets')
            .set({
              scale_override: overrideRaw,
              scale_override_ratio: overrideRatio,
              scale_source:
                overrideRaw !== null ? 'manual' : sheet.scale_parsed !== null ? 'pdf_text' : null,
              review_reasons: reasons,
              needs_review: reasons.length > 0,
            })
            .where('id', '=', sheetId)
            .returningAll()
            .executeTakeFirstOrThrow();

          const effective = (e: ReturnType<typeof effectiveScale>) =>
            e === null ? null : JSON.stringify({ raw: e.raw, ratio: e.ratio, source: e.source });
          await trx
            .insertInto('sheet_edits')
            .values({
              sheet_id: sheetId,
              field_name: 'scale_override',
              original_value: effective(before),
              corrected_value: effective(effectiveScale(after)),
              editor,
              reason: reason?.trim() || null,
            })
            .execute();
          return after;
        });
      return sheetView(updated, (await loadSheetOverrides(db(), [updated.id])).get(updated.id));
    },
  );
};
