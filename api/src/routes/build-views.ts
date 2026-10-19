// Views, exclude areas, deselected lines and role names (Phase 11c, docs/PHASE11C_PLAN.md).
//   GET    /api/role-names                                                  the role list
//   POST   /api/role-names                       { name, behaviour, who, project_id, sheet_id? }
//   PATCH  /api/role-names/:name                 { name?, behaviour?, who, project_id, sheet_id? }
//   POST   /api/projects/:projectId/sheets/:sheetId/build-views                    { box, name?, who }
//   PATCH  /api/projects/:projectId/sheets/:sheetId/build-views/:viewId            { name, who }
//   DELETE /api/projects/:projectId/sheets/:sheetId/build-views/:viewId            { who } (undoable)
//   POST   .../build-views/:viewId/exclusions                                      { box, who }
//   POST   .../build-views/:viewId/exclusions/suggest                              { who }
//   POST   .../build-views/:viewId/exclusions/accept                               { ids | all, who }
//   DELETE .../build-views/:viewId/exclusions/:exclusionId                         { who }
//   POST   .../build-views/:viewId/deselections/toggle                             { line, line_index?, who }
//   POST   .../build-views/:viewId/deselections/box                                { lines, who } (ctrl+drag)
//   POST   .../build-views/:viewId/deselections/reset                              { who }
// Every change is logged (count_actions, counts and ids only): view, exclusion and deselection
// changes as 'setup' rows with the view id (they count in minutes-per-page and mark the view
// "Requesting Build"), role list changes as 'role' rows.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, RoleBehaviour } from '../db/types.js';
import { pickView, viewJson, viewsOf, type Box, type LoadedView } from '../review/build-views.js';
import { logCountAction } from '../review/count-log.js';
import { overlapShare, suggestExcludes } from '../review/excludes.js';
import { deleteView, recordViewUndo } from '../review/view-undo.js';
import { HttpError } from './http-error.js';
import { boxSchema, checkBox, firstId } from './build.js';

export interface BuildViewRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const BEHAVIOURS = ['column_plan', 'framing', 'none'] as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const viewParams = {
  type: 'object',
  required: ['projectId', 'sheetId', 'viewId'],
  properties: { projectId: uuid, sheetId: uuid, viewId: uuid },
} as const;
const whoBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: { who },
} as const;
const line4 = {
  type: 'array',
  items: { type: 'number' },
  minItems: 4,
  maxItems: 4,
} as const;

/** Deselection match on the screen side: the same line as stored (0.01 pt rounding). */
const r2 = (v: number) => Math.round(v * 100) / 100;

function trimWho(value: string): string {
  const w = value.trim();
  if (w === '') throw new HttpError(400, { error: 'who must not be blank' });
  return w;
}

type ViewParams = { projectId: string; sheetId: string; viewId: string };

export const buildViewRoutes: FastifyPluginAsync<BuildViewRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadSheet(projectId: string, sheetId: string) {
    const s = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'sheet not found' });
    return s;
  }

  async function target(p: ViewParams) {
    const s = await loadSheet(p.projectId, p.sheetId);
    const views = await viewsOf(db(), s.id);
    const v = pickView(views, p.viewId);
    if (!v) throw new HttpError(404, { error: 'view not found on this page' });
    return { s, v, views };
  }

  /** One logged setup change of a view, in one transaction; the view then requests a build. */
  async function change(
    s: { id: string; project_id: string },
    v: LoadedView,
    editor: string,
    detail: Record<string, unknown>,
    work: (trx: Transaction<Database>) => Promise<void>,
    marksBuild = true,
  ): Promise<void> {
    await db()
      .transaction()
      .execute(async (trx) => {
        await work(trx);
        if (marksBuild)
          await trx
            .updateTable('build_views')
            .set({ setup_changed_at: new Date() })
            .where('id', '=', v.row.id)
            .execute();
        await logCountAction(trx, {
          projectId: s.project_id,
          sheetId: s.id,
          action: 'setup',
          who: editor,
          detail: { ...detail, view_id: v.row.id },
        });
      });
  }

  const fresh = async (sheetId: string, viewId: string) =>
    viewJson(pickView(await viewsOf(db(), sheetId), viewId)!);

  // ---- role names --------------------------------------------------------------------------------
  app.get('/api/role-names', async () => ({
    roles: await db()
      .selectFrom('role_names')
      .select(['name', 'behaviour', 'built_in'])
      .orderBy('position')
      .orderBy('name')
      .execute(),
  }));

  async function logRole(
    projectId: string,
    sheetId: string | undefined,
    editor: string,
    detail: Record<string, unknown>,
    trx: Transaction<Database>,
  ) {
    const p = await trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    await logCountAction(trx, {
      projectId,
      sheetId: sheetId ?? null,
      action: 'role',
      who: editor,
      detail,
    });
  }

  app.post<{
    Body: {
      name: string;
      behaviour: RoleBehaviour;
      who: string;
      project_id: string;
      sheet_id?: string;
    };
  }>(
    '/api/role-names',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'behaviour', 'who', 'project_id'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            behaviour: { enum: BEHAVIOURS },
            who,
            project_id: uuid,
            sheet_id: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const editor = trimWho(b.who);
      const name = b.name.trim().replace(/\s+/g, ' ');
      if (name === '') throw new HttpError(400, { error: 'a role name must not be blank' });
      const exists = await db()
        .selectFrom('role_names')
        .select('name')
        .where(({ fn }) => fn('lower', ['name']), '=', name.toLowerCase())
        .executeTakeFirst();
      if (exists) throw new HttpError(409, { error: 'that role name exists', name: exists.name });
      await db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .insertInto('role_names')
            .values({ name, behaviour: b.behaviour, created_by: editor, updated_by: editor })
            .execute();
          await logRole(
            b.project_id,
            b.sheet_id,
            editor,
            { kind: 'add', behaviour: b.behaviour },
            trx,
          );
        });
      return reply.status(201).send({ name, behaviour: b.behaviour, built_in: false });
    },
  );

  app.patch<{
    Params: { name: string };
    Body: {
      name?: string;
      behaviour?: RoleBehaviour;
      who: string;
      project_id: string;
      sheet_id?: string;
    };
  }>(
    '/api/role-names/:name',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
        },
        body: {
          type: 'object',
          required: ['who', 'project_id'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            behaviour: { enum: BEHAVIOURS },
            who,
            project_id: uuid,
            sheet_id: uuid,
          },
        },
      },
    },
    async (request) => {
      const b = request.body;
      const editor = trimWho(b.who);
      const row = await db()
        .selectFrom('role_names')
        .selectAll()
        .where('name', '=', request.params.name)
        .executeTakeFirst();
      if (!row) throw new HttpError(404, { error: 'role name not found' });
      if (row.built_in) throw new HttpError(400, { error: 'built-in role names are fixed' });
      const name = b.name === undefined ? row.name : b.name.trim().replace(/\s+/g, ' ');
      if (name === '') throw new HttpError(400, { error: 'a role name must not be blank' });
      const behaviour = b.behaviour ?? row.behaviour;
      if (name !== row.name) {
        const clash = await db()
          .selectFrom('role_names')
          .select('name')
          .where(({ fn }) => fn('lower', ['name']), '=', name.toLowerCase())
          .where('name', '<>', row.name)
          .executeTakeFirst();
        if (clash) throw new HttpError(409, { error: 'that role name exists', name: clash.name });
      }
      const views = await db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .updateTable('role_names')
            .set({ name, behaviour, updated_by: editor, updated_at: new Date() })
            .where('name', '=', row.name)
            .execute();
          // a new behaviour changes what the build does with every view of that name
          let marked = 0;
          if (behaviour !== row.behaviour)
            marked = Number(
              (
                await trx
                  .updateTable('build_views')
                  .set({ setup_changed_at: new Date() })
                  .where('role_name', '=', name)
                  .executeTakeFirst()
              ).numUpdatedRows,
            );
          await logRole(
            b.project_id,
            b.sheet_id,
            editor,
            { kind: 'edit', renamed: name !== row.name, behaviour, views_marked: marked },
            trx,
          );
          return marked;
        });
      return { name, behaviour, built_in: false, views_marked: views };
    },
  );

  // ---- views -------------------------------------------------------------------------------------
  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { box: Box; name?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['box', 'who'],
          additionalProperties: false,
          properties: {
            box: boxSchema,
            name: { type: 'string', minLength: 1, maxLength: 60 },
            who,
          },
        },
      },
    },
    async (request, reply) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = trimWho(request.body.who);
      checkBox(s, request.body.box, 'view box');
      const views = await viewsOf(db(), s.id);
      const position = Math.max(0, ...views.map((v) => v.row.position)) + 1;
      const now = new Date();
      const id = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .insertInto('build_views')
            .values({
              sheet_id: s.id,
              position,
              name: request.body.name?.trim() || `View ${position}`,
              box: JSON.stringify(request.body.box),
              box_confirmed_by: editor,
              box_confirmed_at: now,
              setup_changed_at: now,
              created_by: editor,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await logCountAction(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            action: 'setup',
            who: editor,
            detail: { field: 'view_add', view_id: row.id, position },
          });
          await recordViewUndo(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            viewId: row.id,
            kind: 'add',
            who: editor,
          });
          return row.id;
        });
      return reply.status(201).send(await fresh(s.id, id));
    },
  );

  app.patch<{ Params: ViewParams; Body: { name: string; who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId',
    {
      schema: {
        params: viewParams,
        body: {
          type: 'object',
          required: ['name', 'who'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, who },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const name = request.body.name.trim();
      if (name === '') throw new HttpError(400, { error: 'a view name must not be blank' });
      await change(
        s,
        v,
        editor,
        { field: 'view_name' },
        async (trx) => {
          await trx.updateTable('build_views').set({ name }).where('id', '=', v.row.id).execute();
        },
        false,
      );
      return fresh(s.id, v.row.id);
    },
  );

  // Delete a view (not the first). Its untouched built pieces go with it; pieces a person edited or
  // drew move to the first view. On the person's Undo stack (view_undo), with every removed row.
  app.delete<{ Params: ViewParams; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId',
    { schema: { params: viewParams, body: whoBody } },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      if (v.row.position === 1) throw new HttpError(400, { error: 'the first view stays' });
      const r = await db()
        .transaction()
        .execute(async (trx) => {
          const d = await deleteView(trx, v.row.id);
          await recordViewUndo(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            viewId: v.row.id,
            kind: 'delete',
            who: editor,
            snapshot: d.snapshot,
          });
          await logCountAction(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            action: 'setup',
            who: editor,
            detail: {
              field: 'view_delete',
              view_id: v.row.id,
              pieces_removed: d.pieces_removed,
              pieces_kept: d.pieces_kept,
            },
          });
          return d;
        });
      return { ok: true, pieces_removed: r.pieces_removed, pieces_kept: r.pieces_kept };
    },
  );

  // ---- exclusions --------------------------------------------------------------------------------
  app.post<{ Params: ViewParams; Body: { box: Box; who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/exclusions',
    {
      schema: {
        params: viewParams,
        body: {
          type: 'object',
          required: ['box', 'who'],
          additionalProperties: false,
          properties: { box: boxSchema, who },
        },
      },
    },
    async (request, reply) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      checkBox(s, request.body.box, 'exclude box');
      let id = '';
      await change(s, v, editor, { field: 'exclusion_add' }, async (trx) => {
        id = (
          await trx
            .insertInto('view_exclusions')
            .values({
              view_id: v.row.id,
              box: JSON.stringify(request.body.box),
              status: 'accepted',
              created_by: editor,
              accepted_by: editor,
              accepted_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
      return reply.status(201).send({ id, view: await fresh(s.id, v.row.id) });
    },
  );

  // Suggest excludes: replaces the view's open suggestions with fresh ones (accepted boxes stay).
  // Not a build input until accepted, so the view does not request a build; it is still logged.
  app.post<{ Params: ViewParams; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/exclusions/suggest',
    { schema: { params: viewParams, body: whoBody } },
    async (request) => {
      const { s, v, views } = await target(request.params);
      const editor = trimWho(request.body.who);
      const lines = await db()
        .selectFrom('sheet_lines')
        .select(['lines'])
        .where('sheet_id', '=', s.id)
        .executeTakeFirst();
      if (!lines) throw new HttpError(409, { error: 'the lines of this page are not ready yet' });
      const w = s.width_pt === null ? 0 : Number(s.width_pt);
      const h = s.height_pt === null ? 0 : Number(s.height_pt);
      const rotated = s.rotation === 90 || s.rotation === 270;
      const page: [number, number] = rotated ? [h, w] : [w, h];
      const box = (v.row.box as Box | null) ?? null;
      // grid evidence: grid lines (with their bubbles) of the view's latest finished build
      const first = firstId(views);
      const run = (
        await db()
          .selectFrom('build_runs')
          .select(['id', 'view_id'])
          .where('sheet_id', '=', s.id)
          .where('status', '=', 'done')
          .orderBy('finished_at', 'desc')
          .execute()
      ).find((r) => (r.view_id ?? first) === v.row.id);
      let grid: Box | null = null;
      let beams: Box | null = null;
      if (run) {
        const g = await db()
          .selectFrom('grid_lines')
          .select(['x0', 'y0', 'x1', 'y1', 'bubble'])
          .where('build_run_id', '=', run.id)
          .execute();
        const pts: [number, number][] = [];
        for (const r of g) {
          pts.push([Number(r.x0), Number(r.y0)], [Number(r.x1), Number(r.y1)]);
          const b = r.bubble as { cx: number; cy: number; r: number } | null;
          if (b) pts.push([b.cx - b.r, b.cy - b.r], [b.cx + b.r, b.cy + b.r]);
        }
        grid = bounds(pts);
        const bl = await db()
          .selectFrom('beam_lines')
          .select(['x0', 'y0', 'x1', 'y1'])
          .where('build_run_id', '=', run.id)
          .execute();
        beams = bounds(
          bl.flatMap((r) => [
            [Number(r.x0), Number(r.y0)] as [number, number],
            [Number(r.x1), Number(r.y1)] as [number, number],
          ]),
        );
      }
      const accepted = v.exclusions.filter((e) => e.status === 'accepted');
      const found = suggestExcludes(lines.lines as number[][], page, box, grid, beams).filter(
        (x) => !accepted.some((a) => overlapShare(x.box, a.box) > 0.5),
      );
      await change(
        s,
        v,
        editor,
        { field: 'exclusion_suggest', suggested: found.length, grid_evidence: grid !== null },
        async (trx) => {
          await trx
            .deleteFrom('view_exclusions')
            .where('view_id', '=', v.row.id)
            .where('status', '=', 'suggested')
            .execute();
          for (const x of found)
            await trx
              .insertInto('view_exclusions')
              .values({
                view_id: v.row.id,
                box: JSON.stringify(x.box),
                status: 'suggested',
                rule: x.rule,
                created_by: editor,
              })
              .execute();
        },
        false,
      );
      return {
        suggested: found.length,
        grid_evidence: grid !== null,
        view: await fresh(s.id, v.row.id),
      };
    },
  );

  app.post<{ Params: ViewParams; Body: { ids?: string[]; all?: boolean; who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/exclusions/accept',
    {
      schema: {
        params: viewParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            ids: { type: 'array', items: uuid, minItems: 1, maxItems: 200 },
            all: { type: 'boolean' },
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const open = v.exclusions.filter((e) => e.status === 'suggested');
      const ids = request.body.all ? open.map((e) => e.id) : (request.body.ids ?? []);
      if (ids.length === 0) throw new HttpError(400, { error: 'give ids or all' });
      if (ids.some((id) => !open.some((e) => e.id === id)))
        throw new HttpError(404, { error: 'a suggestion was not found on this view' });
      await change(
        s,
        v,
        editor,
        { field: 'exclusion_accept', accepted: ids.length },
        async (trx) => {
          await trx
            .updateTable('view_exclusions')
            .set({ status: 'accepted', accepted_by: editor, accepted_at: new Date() })
            .where('id', 'in', ids)
            .execute();
        },
      );
      return { accepted: ids.length, view: await fresh(s.id, v.row.id) };
    },
  );

  app.delete<{ Params: ViewParams & { exclusionId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/exclusions/:exclusionId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'sheetId', 'viewId', 'exclusionId'],
          properties: { projectId: uuid, sheetId: uuid, viewId: uuid, exclusionId: uuid },
        },
        body: whoBody,
      },
    },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const e = v.exclusions.find((x) => x.id === request.params.exclusionId);
      if (!e) throw new HttpError(404, { error: 'exclude box not found on this view' });
      await change(
        s,
        v,
        editor,
        { field: 'exclusion_delete', status: e.status },
        async (trx) => {
          await trx.deleteFrom('view_exclusions').where('id', '=', e.id).execute();
        },
        e.status === 'accepted', // an open suggestion is not a build input
      );
      return { ok: true, view: await fresh(s.id, v.row.id) };
    },
  );

  // ---- deselected lines --------------------------------------------------------------------------
  async function linesVersion(sheetId: string): Promise<string | null> {
    return (
      (
        await db()
          .selectFrom('sheet_lines')
          .select('version')
          .where('sheet_id', '=', sheetId)
          .executeTakeFirst()
      )?.version ?? null
    );
  }

  app.post<{
    Params: ViewParams;
    Body: { line: [number, number, number, number]; line_index?: number; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/deselections/toggle',
    {
      schema: {
        params: viewParams,
        body: {
          type: 'object',
          required: ['line', 'who'],
          additionalProperties: false,
          properties: { line: line4, line_index: { type: 'integer', minimum: 0 }, who },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const l = request.body.line.map(r2) as [number, number, number, number];
      const hit = v.deselections.find((d) => d.line.every((x, i) => r2(x) === l[i]));
      const version = await linesVersion(s.id);
      await change(
        s,
        v,
        editor,
        { field: hit ? 'reselect' : 'deselect', lines: 1 },
        async (trx) => {
          if (hit) await trx.deleteFrom('view_deselections').where('id', '=', hit.id).execute();
          else
            await trx
              .insertInto('view_deselections')
              .values({
                view_id: v.row.id,
                x0: l[0],
                y0: l[1],
                x1: l[2],
                y1: l[3],
                line_index: request.body.line_index ?? null,
                lines_version: version,
                created_by: editor,
              })
              .execute();
        },
      );
      return { deselected: !hit, view: await fresh(s.id, v.row.id) };
    },
  );

  // Ctrl + drag: deselect every line of the given pens fully inside the box (the screen sends the
  // highlighted lines it shows, so the server does not guess which lines were highlighted).
  app.post<{
    Params: ViewParams;
    Body: { lines: { line: [number, number, number, number]; line_index?: number }[]; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/deselections/box',
    {
      schema: {
        params: viewParams,
        body: {
          type: 'object',
          required: ['lines', 'who'],
          additionalProperties: false,
          properties: {
            lines: {
              type: 'array',
              maxItems: 5000,
              items: {
                type: 'object',
                required: ['line'],
                additionalProperties: false,
                properties: { line: line4, line_index: { type: 'integer', minimum: 0 } },
              },
            },
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const have = new Set(v.deselections.map((d) => d.line.map(r2).join(',')));
      const add = request.body.lines
        .map((x) => ({ ...x, line: x.line.map(r2) as [number, number, number, number] }))
        .filter((x, i, all) => {
          const k = x.line.join(',');
          return !have.has(k) && all.findIndex((y) => y.line.join(',') === k) === i;
        });
      if (add.length === 0) return { deselected: 0, view: await fresh(s.id, v.row.id) };
      const version = await linesVersion(s.id);
      await change(s, v, editor, { field: 'deselect_box', lines: add.length }, async (trx) => {
        await trx
          .insertInto('view_deselections')
          .values(
            add.map((x) => ({
              view_id: v.row.id,
              x0: x.line[0],
              y0: x.line[1],
              x1: x.line[2],
              y1: x.line[3],
              line_index: x.line_index ?? null,
              lines_version: version,
              created_by: editor,
            })),
          )
          .execute();
      });
      return { deselected: add.length, view: await fresh(s.id, v.row.id) };
    },
  );

  app.post<{ Params: ViewParams; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-views/:viewId/deselections/reset',
    { schema: { params: viewParams, body: whoBody } },
    async (request) => {
      const { s, v } = await target(request.params);
      const editor = trimWho(request.body.who);
      const n = v.deselections.length;
      if (n > 0)
        await change(s, v, editor, { field: 'deselect_reset', lines: n }, async (trx) => {
          await trx.deleteFrom('view_deselections').where('view_id', '=', v.row.id).execute();
        });
      return { reset: n, view: await fresh(s.id, v.row.id) };
    },
  );
};

function bounds(pts: [number, number][]): Box | null {
  if (pts.length === 0) return null;
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
}
