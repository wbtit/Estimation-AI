// Review 3 item 4: the height of a column (its BOM length), until the Column Schedule is read
// (future: top - base elevation, splices). Sources, in order: a column's top and base elevations
// (height = top - base), the column's own height, the project's default column height; none of them
// set = no height, never a made-up number (review/line-first-pieces.ts columnHeight).
//
//   GET  /api/projects/:projectId/column-height
//        { default_height_mm }
//   POST /api/projects/:projectId/column-height-default   { who, height_mm | null }
//        the project's default (null clears); logged as a 'project' action with who, when, from, to
//   POST /api/projects/:projectId/line-first/columns/height
//        { who, member_ids[], height_mm?|null, top_mm?|null, base_mm?|null }
//        one or MANY columns in ONE recorded action (member_edits rows): one Undo puts them all back
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from '../review/actions.js';
import { logCountAction } from '../review/count-log.js';
import { loadPieces } from '../review/line-first-pieces.js';
import { HttpError } from './http-error.js';

export interface ColumnHeightRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const HEIGHT_MAX_MM = 200_000;
const ELEVATION_LIMIT_MM = 1_000_000;

export const columnHeightRoutes: FastifyPluginAsync<ColumnHeightRouteOptions> = async (
  app,
  options,
) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  const trimWho = (value: string): string => {
    const w = value.trim();
    if (w === '') throw new HttpError(400, { error: 'who must not be blank' });
    return w;
  };

  async function loadProject(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .select(['id', 'default_column_height_mm'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return p;
  }
  const mm = (v: string | null) => (v === null ? null : Number(v));

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/column-height',
    { schema: { params: projectParams } },
    async (request) => {
      const p = await loadProject(request.params.projectId);
      return { default_height_mm: mm(p.default_column_height_mm) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string; height_mm: number | null } }>(
    '/api/projects/:projectId/column-height-default',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'height_mm'],
          additionalProperties: false,
          properties: {
            who,
            height_mm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: HEIGHT_MAX_MM },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const editor = trimWho(request.body.who);
      const project = await loadProject(projectId);
      const next = request.body.height_mm;
      await db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .updateTable('projects')
            .set({ default_column_height_mm: next } as never)
            .where('id', '=', projectId)
            .execute();
          await logCountAction(trx, {
            projectId,
            action: 'project',
            who: editor,
            detail: {
              change: 'default_column_height',
              from: mm(project.default_column_height_mm),
              to: next,
            },
          });
        });
      return { default_height_mm: next };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: {
      who: string;
      member_ids: string[];
      height_mm?: number | null;
      top_mm?: number | null;
      base_mm?: number | null;
    };
  }>(
    '/api/projects/:projectId/line-first/columns/height',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'member_ids'],
          additionalProperties: false,
          properties: {
            who,
            member_ids: {
              type: 'array',
              items: uuid,
              minItems: 1,
              maxItems: 500,
              uniqueItems: true,
            },
            height_mm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: HEIGHT_MAX_MM },
            top_mm: {
              type: ['number', 'null'],
              minimum: -ELEVATION_LIMIT_MM,
              maximum: ELEVATION_LIMIT_MM,
            },
            base_mm: {
              type: ['number', 'null'],
              minimum: -ELEVATION_LIMIT_MM,
              maximum: ELEVATION_LIMIT_MM,
            },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const b = request.body;
      const editor = trimWho(b.who);
      await loadProject(projectId);
      const pieces = await loadPieces(db(), projectId, { memberIds: b.member_ids });
      if (pieces.length !== b.member_ids.length)
        throw new HttpError(404, { error: 'a piece was not found' });
      if (pieces.some((p) => p.type !== 'column'))
        throw new HttpError(409, {
          error: 'this sets the height of columns only',
          code: 'not_a_column',
        });
      const entries: EditEntry[] = [];
      const push = (id: string, field: string, before: number | null, after: number | null) => {
        if (before !== after)
          entries.push({ memberId: id, field, before, after, status: 'edited' });
      };
      for (const p of pieces) {
        const top = b.top_mm !== undefined ? b.top_mm : p.column_top_mm;
        const base = b.base_mm !== undefined ? b.base_mm : p.column_base_mm;
        if (top !== null && base !== null && top <= base)
          throw new HttpError(400, {
            error: 'the top elevation must be above the base elevation',
            code: 'bad_elevations',
          });
        if (b.height_mm !== undefined) push(p.id, 'column_height', p.column_height_mm, b.height_mm);
        if (b.top_mm !== undefined) push(p.id, 'column_top', p.column_top_mm, b.top_mm);
        if (b.base_mm !== undefined) push(p.id, 'column_base', p.column_base_mm, b.base_mm);
      }
      let actionId: string | null = null;
      if (entries.length > 0) {
        actionId = await db()
          .transaction()
          .execute(async (trx) => {
            const id = await recordAction(trx, editor, entries);
            await logCountAction(trx, {
              projectId,
              sheetId: pieces[0]?.sheet_id ?? null,
              memberId: pieces.length === 1 ? pieces[0]!.id : null,
              action: 'edit',
              who: editor,
              editActionId: id,
              detail: {
                column_height: true,
                members: pieces.length,
                fields: [...new Set(entries.map((e) => e.field))],
              },
            });
            return id;
          });
      }
      return {
        action_id: actionId,
        changed: entries.length > 0,
        pieces: await loadPieces(db(), projectId, { memberIds: b.member_ids }),
      };
    },
  );
};
