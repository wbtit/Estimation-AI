// The automatic pipeline and the one-click confirmation of its guesses (Phase 6a).
//   POST /api/projects/:projectId/auto-run                          run the pipeline again (text, views, scale guess, classes, links)
//   GET  /api/projects/:projectId/auto-run-status                   latest auto_run job
//   GET  /api/projects/:projectId/flags                             flags per sheet and the draft label
//   POST /api/projects/:projectId/sheets/:sheetId/confirm-guesses   { who }  "these guesses are right"
//   POST /api/projects/:projectId/confirm-excluded-defaults         { who }  the same for every sheet excluded by default
// Confirming sets the confirmations a person could make one by one (view scale, line classes, the
// sheet's takeoff decision) and records who and when; nothing a person did is overwritten.
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { draftStatus, loadSheetFlags } from '../review/flags.js';
import { loadSheetInclusions } from '../review/takeoff-sheets.js';
import { HttpError } from './http-error.js';

export interface PipelineRouteOptions {
  db?: Kysely<Database>;
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
const whoBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: { who: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

export const pipelineRoutes: FastifyPluginAsync<PipelineRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/auto-run',
    { schema: { params: projectParams } },
    async (request, reply) => {
      const { projectId } = request.params;
      const file = await db()
        .selectFrom('project_files')
        .select(['id', 'scan_status'])
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file) throw new HttpError(404, { error: 'this project has no PDF yet' });
      if (file.scan_status !== 'done') {
        throw new HttpError(409, { error: 'the PDF scan is not finished' });
      }
      const open = await db()
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'auto_run')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
        .executeTakeFirst();
      if (open) return reply.status(202).send({ job_id: open.id, status: 'pending' });
      const job = await db()
        .insertInto('jobs')
        .values({
          type: 'auto_run',
          payload: JSON.stringify({ project_id: projectId, document_id: file.id }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, status: 'pending' });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/auto-run-status',
    { schema: { params: projectParams } },
    async (request) => {
      const job = await db()
        .selectFrom('jobs')
        .select(['id', 'status', 'result', 'error', 'created_at'])
        .where('type', '=', 'auto_run')
        .where(sql<boolean>`payload->>'project_id' = ${request.params.projectId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return { job: job ?? null };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/flags',
    { schema: { params: projectParams } },
    async (request) => {
      const sheets = await loadSheetFlags(db(), request.params.projectId);
      const run = await db()
        .selectFrom('jobs')
        .select(['status', 'result', 'error', 'created_at', 'locked_at', 'updated_at'])
        .where('type', '=', 'auto_run')
        .where(sql<boolean>`payload->>'project_id' = ${request.params.projectId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return {
        draft: draftStatus(sheets),
        sheets,
        last_run: run && {
          status: run.status,
          result: run.result,
          error: run.error,
          started_at: new Date(
            (run.locked_at ?? run.created_at) as unknown as string,
          ).toISOString(),
          finished_at: ['completed', 'failed'].includes(run.status)
            ? new Date(run.updated_at as unknown as string).toISOString()
            : null,
        },
      };
    },
  );

  /** Confirm every guess of one sheet; returns the sheet's flags afterwards (empty when all cleared). */
  async function confirmSheet(projectId: string, sheetId: string, who: string) {
    const inclusion = (await loadSheetInclusions(db(), projectId)).find(
      (s) => s.sheet_id === sheetId,
    );
    if (!inclusion) throw new HttpError(404, { error: 'sheet not found' });
    await db()
      .transaction()
      .execute(async (trx) => {
        if (inclusion.by_default) {
          await trx
            .insertInto('sheet_edits')
            .values({
              sheet_id: sheetId,
              field_name: 'takeoff',
              original_value: JSON.stringify(null),
              corrected_value: JSON.stringify(inclusion.included ? 'include' : 'exclude'),
              editor: who,
              reason: 'guesses confirmed',
            })
            .execute();
        }
        if (inclusion.included) {
          const views = await trx
            .selectFrom('sheet_views')
            .select(['id', 'scale_ratio', 'scale_source', 'scale_confirmed', 'classes_confirmed'])
            .select('structural_classes')
            .where('sheet_id', '=', sheetId)
            .execute();
          for (const v of views) {
            const update: Record<string, unknown> = {};
            if (!v.scale_confirmed && v.scale_ratio !== null) update.scale_confirmed = true;
            if (!v.classes_confirmed && v.structural_classes.length > 0)
              update.classes_confirmed = true;
            if (Object.keys(update).length === 0) continue;
            await trx.updateTable('sheet_views').set(update).where('id', '=', v.id).execute();
            if (update.scale_confirmed) {
              await trx
                .insertInto('sheet_edits')
                .values({
                  sheet_id: sheetId,
                  field_name: 'view_scale',
                  original_value: JSON.stringify({ view_id: v.id, confirmed: false }),
                  corrected_value: JSON.stringify({
                    view_id: v.id,
                    ratio: Number(v.scale_ratio),
                    source: v.scale_source,
                    confirmed: true,
                  }),
                  editor: who,
                  reason: 'guesses confirmed',
                })
                .execute();
            }
          }
        }
        await trx
          .updateTable('sheets')
          .set({ guesses_confirmed_by: who, guesses_confirmed_at: sql`NOW()` })
          .where('id', '=', sheetId)
          .execute();
      });
    return (await loadSheetFlags(db(), projectId)).find((s) => s.sheet_id === sheetId);
  }

  app.post<{ Params: { projectId: string; sheetId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/confirm-guesses',
    { schema: { params: sheetParams, body: whoBody } },
    async (request) => {
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const sheet = await confirmSheet(request.params.projectId, request.params.sheetId, who);
      const all = await loadSheetFlags(db(), request.params.projectId);
      return { sheet, draft: draftStatus(all) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/confirm-excluded-defaults',
    { schema: { params: projectParams, body: whoBody } },
    async (request) => {
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const { projectId } = request.params;
      const targets = (await loadSheetInclusions(db(), projectId)).filter(
        (s) => s.by_default && !s.included,
      );
      for (const t of targets) await confirmSheet(projectId, t.sheet_id, who);
      const all = await loadSheetFlags(db(), projectId);
      return { confirmed: targets.map((t) => t.page_number), draft: draftStatus(all) };
    },
  );
};
