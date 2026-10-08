// Human actions on members. Every action is saved to member_edits (before, after, who, when).
//   POST /api/projects/:projectId/members     add a member by hand (a column in v1)
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, ViewBox } from '../db/types.js';
import { planXY } from '../review/geometry.js';
import { recordAction } from '../review/actions.js';
import { parseProfile } from '../review/profile.js';
import { parseLengthMm } from '../units/parse.js';
import { loadMemberViews } from './members.js';
import { HttpError } from './http-error.js';

export interface MemberActionOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const createBody = {
  type: 'object',
  required: ['view_id', 'type', 'point', 'who'],
  additionalProperties: false,
  properties: {
    view_id: uuid,
    type: { enum: ['column', 'beam', 'brace', 'joist', 'other'] },
    mark: { type: ['string', 'null'], maxLength: 40 },
    profile_text: { type: ['string', 'null'], maxLength: 80 },
    point: {
      type: 'object',
      required: ['x', 'y'],
      additionalProperties: false,
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    base_elevation: { type: ['string', 'null'], maxLength: 40 },
    top_elevation: { type: ['string', 'null'], maxLength: 40 },
    who: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

interface CreateBody {
  view_id: string;
  type: 'column' | 'beam' | 'brace' | 'joist' | 'other';
  mark?: string | null;
  profile_text?: string | null;
  point: { x: number; y: number };
  base_elevation?: string | null;
  top_elevation?: string | null;
  who: string;
}

export const memberActionRoutes: FastifyPluginAsync<MemberActionOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.post<{ Params: { projectId: string }; Body: CreateBody }>(
    '/api/projects/:projectId/members',
    { schema: { params: projectParams, body: createBody } },
    async (request, reply) => {
      const { projectId } = request.params;
      const b = request.body;
      const who = b.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const view = await db()
        .selectFrom('sheet_views as v')
        .innerJoin('sheets as s', 's.id', 'v.sheet_id')
        .select(['v.id', 'v.sheet_id', 'v.box', 'v.scale_ratio', 'v.scale_confirmed'])
        .where('v.id', '=', b.view_id)
        .where('s.project_id', '=', projectId)
        .executeTakeFirst();
      if (!view) throw new HttpError(404, { error: 'view not found' });
      const box = view.box as ViewBox;
      if (b.point.x < box.x0 || b.point.x > box.x1 || b.point.y < box.y0 || b.point.y > box.y1) {
        throw new HttpError(400, { error: 'the point is outside the view' });
      }
      const profileText = b.profile_text?.trim() || null;
      const parsed = profileText ? parseProfile(profileText) : null;
      const parseElev = (text: string | null | undefined, label: string): number | null => {
        if (text === undefined || text === null || text.trim() === '') return null;
        const mm = parseLengthMm(text);
        if (mm === null)
          throw new HttpError(400, { error: `${label} is not a length (use 12'-6", 3000 mm)` });
        return mm;
      };
      const base = parseElev(b.base_elevation, 'base elevation');
      const top = parseElev(b.top_elevation, 'top elevation');
      const ratio =
        view.scale_confirmed && view.scale_ratio !== null ? Number(view.scale_ratio) : null;
      const [px, py] = ratio ? planXY(box, ratio, b.point) : [null, null];
      const memberId = `M-${randomUUID().slice(0, 12)}`;
      const summary = {
        type: b.type,
        mark: b.mark?.trim() || null,
        profile_raw: profileText,
        profile: parsed?.canonical ?? null,
      };

      const id = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .insertInto('members')
            .values({
              project_id: projectId,
              sheet_id: view.sheet_id,
              view_id: view.id,
              plan_sheet_id: view.sheet_id,
              member_id: memberId,
              origin: 'manual',
              type: b.type,
              mark: summary.mark,
              profile_raw: profileText,
              profile: summary.profile,
              start_elevation_mm: base,
              end_elevation_mm: top,
              quantity: 1,
              plan_start_x_mm: px === null ? null : Math.round(px * 10) / 10,
              plan_start_y_mm: py === null ? null : Math.round((py as number) * 10) / 10,
              plan_scale_ratio: ratio,
              plan_method: 'manual',
              length_source: b.type === 'column' ? 'manual' : null,
              source_bbox: JSON.stringify({
                x0: b.point.x - 6,
                y0: b.point.y - 6,
                x1: b.point.x + 6,
                y1: b.point.y + 6,
              }),
              field_sources: '{}',
              field_confidence: '{}',
              review_status: 'edited',
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          await recordAction(trx, who, [
            {
              memberId: row.id,
              field: '__created__',
              before: null,
              after: summary,
              status: 'edited',
            },
          ]);
          return row.id;
        });
      const [created] = await loadMemberViews(db(), projectId, { memberIds: [id] });
      return reply.status(201).send(created);
    },
  );
};
