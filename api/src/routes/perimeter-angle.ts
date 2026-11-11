// Phase 0 perimeter angle (manual, never detected): an L-section on the top flange of a perimeter
// beam. See review/perimeter-angle.ts for the model. Every add / edit is a recorded, undoable
// action like the other piece edits (member_edits rows + a count_actions row); removing is the
// existing POST .../line-first/pieces/delete.
//
//   GET  /api/projects/:projectId/perimeter-angles/options
//        { edition, angles[], last_profile, kind, grade, grade_is_default }   the AISC L shapes
//        (common ones first), the project's last profile (an L shape or a bent plate), the scope
//        kind of the BOM line, the grade of angles and bent plates (A36 unless the project set one)
//   POST /api/projects/:projectId/line-first/perimeter-angles
//        { who, beam_ids[], profile_text? | bent?: {thickness_in, leg1_in, leg2_in},
//          length_mm?, start_offset_mm?, slab_edge_side?, vertical_leg? }
//        one angle (an AISC L shape) or bent plate (custom made, sizes in inches) per beam, ONE
//        recorded action (one Undo removes them all)
//   POST /api/projects/:projectId/line-first/perimeter-angles/edit
//        { who, member_ids[], profile_text? | bent?, length_mm?|null, start_offset_mm?|null,
//          slab_edge_side?|null, vertical_leg?|null }
//   POST /api/projects/:projectId/perimeter-angles/grade  { who, grade|null }
//        the project's grade for angles and bent plates (null = back to the A36 default); logged
//        as a 'project' action with who, when, from and to
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from '../review/actions.js';
import { logCountAction } from '../review/count-log.js';
import { loadKinds, typeOfKind } from '../review/kinds.js';
import { loadPieces, type PieceView } from '../review/line-first-pieces.js';
import { loadMemberViews } from '../review/member-views.js';
import {
  angleGradeOf,
  angleKindOf,
  deriveAngle,
  listAngles,
  resolvePerimeterProfile,
  type BentPlate,
} from '../review/perimeter-angle.js';
import { takeTagNumbers } from '../review/tag-counter.js';
import { HttpError } from './http-error.js';
import { drawnValues } from './review-ui.js';

export interface PerimeterAngleRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const side = { enum: ['left', 'right', null] } as const;
const leg = { enum: ['long', 'short', null] } as const;
const LENGTH_MAX_MM = 200_000;
const bentSchema = {
  type: 'object',
  required: ['thickness_in', 'leg1_in', 'leg2_in'],
  additionalProperties: false,
  properties: {
    thickness_in: { type: 'number', exclusiveMinimum: 0, maximum: 48 },
    leg1_in: { type: 'number', exclusiveMinimum: 0, maximum: 48 },
    leg2_in: { type: 'number', exclusiveMinimum: 0, maximum: 48 },
  },
} as const;

function trimWho(value: string): string {
  const w = value.trim();
  if (w === '') throw new HttpError(400, { error: 'who must not be blank' });
  return w;
}

export const perimeterAngleRoutes: FastifyPluginAsync<PerimeterAngleRouteOptions> = async (
  app,
  options,
) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadProject(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return p;
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/perimeter-angles/options',
    { schema: { params: projectParams } },
    async (request) => {
      const project = await loadProject(request.params.projectId);
      const { edition, angles } = await listAngles(db());
      return {
        edition,
        angles,
        last_profile: project.perimeter_angle_profile ?? null,
        kind: angleKindOf(project),
        grade: angleGradeOf(project),
        grade_is_default: !project.perimeter_angle_grade?.trim(),
      };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: {
      who: string;
      beam_ids: string[];
      profile_text?: string;
      bent?: BentPlate;
      length_mm?: number | null;
      start_offset_mm?: number | null;
      slab_edge_side?: 'left' | 'right' | null;
      vertical_leg?: 'long' | 'short' | null;
    };
  }>(
    '/api/projects/:projectId/line-first/perimeter-angles',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'beam_ids'],
          additionalProperties: false,
          properties: {
            who,
            beam_ids: { type: 'array', items: uuid, minItems: 1, maxItems: 500, uniqueItems: true },
            profile_text: { type: 'string', minLength: 1, maxLength: 80 },
            bent: bentSchema,
            length_mm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: LENGTH_MAX_MM },
            start_offset_mm: { type: ['number', 'null'], minimum: 0, maximum: LENGTH_MAX_MM },
            slab_edge_side: side,
            vertical_leg: leg,
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const b = request.body;
      const editor = trimWho(b.who);
      const project = await loadProject(projectId);
      if (b.profile_text === undefined && !b.bent)
        throw new HttpError(400, {
          error: 'give a profile_text (an L shape) or the sizes of a bent plate',
          code: 'no_profile',
        });
      const { profile, sub_type } = await resolvePerimeterProfile(db(), {
        profile_text: b.profile_text,
        bent: b.bent,
      });
      const kind = angleKindOf(project);
      const info = (await loadKinds(db())).get(kind);
      if (!info)
        throw new HttpError(409, {
          error: `the kind "${kind}" is not in the kinds list: add it or set the project's angle kind`,
          code: 'no_kind',
        });
      const beams = await loadPieces(db(), projectId, { memberIds: b.beam_ids });
      if (beams.length !== b.beam_ids.length)
        throw new HttpError(404, { error: 'a beam was not found (or is not a built piece)' });
      for (const p of beams) {
        if (p.type === 'column' || p.parent_member_id !== null || !p.a || !p.b)
          throw new HttpError(409, {
            error:
              'a perimeter angle goes on a beam (a piece with two ends), not on a column or on another angle',
            code: 'not_a_beam',
          });
        if (p.deleted)
          throw new HttpError(409, { error: 'the beam is deleted', code: 'beam_deleted' });
        if (p.scale_ratio === null)
          throw new HttpError(409, { error: 'set the scale of the page first', code: 'no_scale' });
      }
      const type = typeOfKind(info, 'other');
      const created = await db()
        .transaction()
        .execute(async (trx) => {
          const entries: EditEntry[] = [];
          const ids: { id: string; sheetId: string | null; beam: string }[] = [];
          for (const beam of beams) {
            const d = deriveAngle(beam, b.start_offset_mm ?? null, b.length_mm ?? null);
            const number = await takeTagNumbers(trx, projectId, beam.sheet_id, info.prefix);
            const row = await trx
              .insertInto('members')
              .values({
                ...drawnValues({
                  projectId,
                  sheetId: beam.sheet_id!,
                  runId: beam.build_run_id!,
                  viewId: beam.build_view_id,
                  editor,
                  kind: info.kind,
                  prefix: info.prefix,
                  number,
                  type,
                  text: profile,
                  profile,
                  a: d.a!,
                  b: d.b!,
                  ratio: beam.scale_ratio!,
                  tos: beam.elevation_mm,
                  symbol: null,
                  symbolSource: null,
                  rotation: null,
                  realIn: null,
                }),
                parent_member_id: beam.id,
                angle_length_mm: b.length_mm ?? null,
                angle_start_offset_mm: b.start_offset_mm ?? null,
                slab_edge_side: b.slab_edge_side ?? null,
                vertical_leg: b.vertical_leg ?? null,
              } as never)
              .returning('id')
              .executeTakeFirstOrThrow();
            entries.push({
              memberId: row.id,
              field: '__created__',
              before: null,
              after: { type, kind: info.kind, profile_raw: profile, profile, parent: beam.id },
              status: 'edited',
            });
            ids.push({ id: row.id, sheetId: beam.sheet_id, beam: beam.id });
          }
          const actionId = await recordAction(trx, editor, entries);
          for (const x of ids)
            await logCountAction(trx, {
              projectId,
              sheetId: x.sheetId,
              memberId: x.id,
              action: 'add',
              who: editor,
              editActionId: actionId,
              detail: {
                kind: info.kind,
                perimeter_angle: true,
                sub_type,
                parent: x.beam,
                profile,
              },
            });
          // the project remembers the last profile used (a preference, not an undoable edit)
          await trx
            .updateTable('projects')
            .set({ perimeter_angle_profile: profile } as never)
            .where('id', '=', projectId)
            .execute();
          return { actionId, ids: ids.map((x) => x.id) };
        });
      const pieces = await loadPieces(db(), projectId, { memberIds: created.ids });
      return reply.status(201).send({ action_id: created.actionId, pieces });
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: {
      who: string;
      member_ids: string[];
      profile_text?: string;
      bent?: BentPlate;
      length_mm?: number | null;
      start_offset_mm?: number | null;
      slab_edge_side?: 'left' | 'right' | null;
      vertical_leg?: 'long' | 'short' | null;
    };
  }>(
    '/api/projects/:projectId/line-first/perimeter-angles/edit',
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
            profile_text: { type: 'string', minLength: 1, maxLength: 80 },
            bent: bentSchema,
            length_mm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: LENGTH_MAX_MM },
            start_offset_mm: { type: ['number', 'null'], minimum: 0, maximum: LENGTH_MAX_MM },
            slab_edge_side: side,
            vertical_leg: leg,
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const b = request.body;
      const editor = trimWho(b.who);
      await loadProject(projectId);
      const profile =
        b.profile_text !== undefined || b.bent
          ? (await resolvePerimeterProfile(db(), { profile_text: b.profile_text, bent: b.bent }))
              .profile
          : null;
      const pieces = await loadPieces(db(), projectId, { memberIds: b.member_ids });
      if (pieces.length !== b.member_ids.length)
        throw new HttpError(404, { error: 'a piece was not found' });
      if (pieces.some((p: PieceView) => p.parent_member_id === null))
        throw new HttpError(409, {
          error: 'this edits perimeter angles only',
          code: 'not_an_angle',
        });
      const views = new Map(
        (await loadMemberViews(db(), projectId, { memberIds: b.member_ids })).map((v) => [v.id, v]),
      );
      const entries: EditEntry[] = [];
      const push = (id: string, field: string, before: unknown, after: unknown) => {
        if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
          entries.push({ memberId: id, field, before, after, status: 'edited' });
      };
      for (const p of pieces) {
        if (profile !== null) {
          // the profile is stored exactly as resolved (a catalog L name or the bent plate name)
          const v = views.get(p.id)!;
          push(p.id, 'profile_raw', v.profile_raw, profile);
          push(p.id, 'profile', v.profile, profile);
        }
        if (b.length_mm !== undefined) push(p.id, 'angle_length', p.angle_length_mm, b.length_mm);
        if (b.start_offset_mm !== undefined)
          push(p.id, 'angle_offset', p.angle_start_offset_mm, b.start_offset_mm);
        if (b.slab_edge_side !== undefined)
          push(p.id, 'slab_edge_side', p.slab_edge_side, b.slab_edge_side);
        if (b.vertical_leg !== undefined)
          push(p.id, 'vertical_leg', p.vertical_leg, b.vertical_leg);
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
              memberId: entries.length === 1 ? entries[0]!.memberId : null,
              action: 'edit',
              who: editor,
              editActionId: id,
              detail: {
                perimeter_angle: true,
                members: pieces.length,
                fields: [...new Set(entries.map((e) => e.field))],
              },
            });
            if (profile !== null)
              await trx
                .updateTable('projects')
                .set({ perimeter_angle_profile: profile } as never)
                .where('id', '=', projectId)
                .execute();
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

  app.post<{
    Params: { projectId: string };
    Body: { who: string; grade: string | null };
  }>(
    '/api/projects/:projectId/perimeter-angles/grade',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'grade'],
          additionalProperties: false,
          properties: {
            who,
            grade: { type: ['string', 'null'], minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const editor = trimWho(request.body.who);
      const project = await loadProject(projectId);
      const grade = request.body.grade === null ? null : request.body.grade.trim();
      if (grade === '') throw new HttpError(400, { error: 'grade must not be blank' });
      await db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .updateTable('projects')
            .set({ perimeter_angle_grade: grade } as never)
            .where('id', '=', projectId)
            .execute();
          await logCountAction(trx, {
            projectId,
            action: 'project',
            who: editor,
            detail: {
              change: 'perimeter_grade',
              from: angleGradeOf(project),
              to: grade ?? angleGradeOf({ perimeter_angle_grade: null }),
            },
          });
        });
      const now = angleGradeOf({ perimeter_angle_grade: grade });
      return { grade: now, grade_is_default: grade === null };
    },
  );
};
