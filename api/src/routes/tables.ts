// Stage 1 tables and their Excel export, computed from the members on every request.
//   GET  /api/projects/:projectId/tables                   page tables, job table, summary by kind, draft label
//   GET  /api/projects/:projectId/tables.xlsx              job sheet, one sheet per page, corrections sheet
//   POST /api/projects/:projectId/rows/kind                { member_ids, kind, who }  set the kind of a table row (one action)
//   POST /api/projects/:projectId/grades/apply-suggested   { who }  one click: set the suggested grade for each shape family of the job that has none
//   POST /api/projects/:projectId/rows/name                { member_ids, name, who }  set the Name of a table row (one action)
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { buildTablesWorkbook, exportFileName, type CorrectionRow } from '../excel/tables.js';
import { draftStatus, loadSheetFlags } from '../review/flags.js';
import { familyOf, loadGrades, setGrade } from '../review/grades.js';
import { loadKinds } from '../review/kinds.js';
import { applyEntries, kindEntries, OpError } from '../review/member-ops.js';
import { loadSheetInclusions } from '../review/takeoff-sheets.js';
import { buildJobTable, buildPageTables, GRADE_SUGGESTION } from '../review/tables.js';
import { HttpError } from './http-error.js';
import { loadMemberViews } from './members.js';

export interface TableRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const params = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const idsSchema = { type: 'array', items: uuid, minItems: 1, maxItems: 500 } as const;

const FIELD_WORD: Record<string, string> = {
  kind: 'kind',
  kind_confirmed: 'kind confirmed',
  tag: 'tag',
  name: 'name',
  profile_raw: 'size text',
  profile: 'size',
  mark: 'mark',
  review_status: 'review',
  link: 'line',
  type: 'type',
  existing: 'existing steel',
  not_member: 'not a member',
  merged_into: 'merged',
  shared_line: 'shared line',
  mark_ref: 'legend row',
  quantity: 'quantity',
  level: 'level',
};

function show(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('reset' in o) return "the system's guess";
    if ('prefix' in o) return `${o.prefix ?? '?'}${o.number ?? ''}`;
    if ('line' in o) return 'a line';
    return JSON.stringify(v);
  }
  return String(v);
}

export const tableRoutes: FastifyPluginAsync<TableRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function compute(projectId: string) {
    const project = await db()
      .selectFrom('projects')
      .select(['id', 'name', 'number'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw new HttpError(404, { error: 'project not found' });
    const inclusions = await loadSheetInclusions(db(), projectId);
    const members = await loadMemberViews(db(), projectId);
    const input = {
      members,
      sheets: inclusions.map((s) => ({
        sheet_id: s.sheet_id,
        page_number: s.page_number,
        sheet_number: s.sheet_number,
        included: s.included,
      })),
      kinds: await loadKinds(db()),
      grades: await loadGrades(db(), projectId),
      nameOf: (m: { name: string | null }) => m.name,
    };
    const flags = await loadSheetFlags(db(), projectId, inclusions);
    return {
      project,
      draft: draftStatus(flags),
      pages: buildPageTables(input),
      job: buildJobTable(input),
      members,
    };
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tables',
    { schema: { params } },
    async (request) => {
      const { project, draft, pages, job } = await compute(request.params.projectId);
      return {
        project: { id: project.id, name: project.name, number: project.number },
        draft,
        stage_note: 'Lengths and Total W are added in Stage 2; those cells are empty on purpose.',
        job,
        pages,
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tables.xlsx',
    { schema: { params } },
    async (request, reply) => {
      const { project, draft, pages, job, members } = await compute(request.params.projectId);
      const byId = new Map(members.map((m) => [m.id, m] as const));
      const pageOf = new Map(
        (await loadSheetInclusions(db(), request.params.projectId)).map(
          (s) => [s.sheet_id, s.page_number] as const,
        ),
      );
      const edits = await db()
        .selectFrom('member_edits as e')
        .innerJoin('members as m', 'm.id', 'e.member_id')
        .select([
          'e.member_id',
          'e.field_name',
          'e.original_value',
          'e.corrected_value',
          'e.reviewer',
          'e.created_at',
          'e.undo_of_action_id',
        ])
        .where('m.project_id', '=', request.params.projectId)
        .where('e.field_name', '!=', '__created__')
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute();
      const corrections: CorrectionRow[] = edits.map((e) => {
        const m = byId.get(e.member_id);
        return {
          when: new Date(e.created_at as unknown as string)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' '),
          who: e.reviewer ?? '',
          page_number: m?.sheet_id ? (pageOf.get(m.sheet_id) ?? null) : null,
          tag: m?.tag.text ?? '',
          profile: m?.profile_raw ?? null,
          field: FIELD_WORD[e.field_name] ?? e.field_name,
          before: show(e.original_value),
          after: show(e.corrected_value),
          is_undo: e.undo_of_action_id !== null,
        };
      });
      const workbook = await buildTablesWorkbook({ draft, job, pages, corrections });
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${exportFileName(project, draft)}"`)
        .send(workbook);
    },
  );

  async function rowAction(
    projectId: string,
    ids: string[],
    who: string,
    build: (
      targets: Awaited<ReturnType<typeof loadMemberViews>>,
      sheet: Awaited<ReturnType<typeof loadMemberViews>>,
    ) => ReturnType<typeof kindEntries>,
  ) {
    const name = who.trim();
    if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
    const targets = await loadMemberViews(db(), projectId, { memberIds: ids });
    if (targets.length !== new Set(ids).size)
      throw new HttpError(404, { error: 'a piece of this row was not found' });
    const sheetIds = [
      ...new Set(targets.map((t) => t.sheet_id).filter((s): s is string => s !== null)),
    ];
    const sheet = (
      await Promise.all(sheetIds.map((sid) => loadMemberViews(db(), projectId, { sheetId: sid })))
    ).flat();
    try {
      const entries = build(targets, sheet);
      const actionId = await applyEntries(db(), name, entries);
      return { action_id: actionId, changed: entries.length };
    } catch (err) {
      if (err instanceof OpError) throw new HttpError(err.status, { error: err.message });
      throw err;
    }
  }

  app.post<{
    Params: { projectId: string };
    Body: { member_ids: string[]; kind: string | null; who: string };
  }>(
    '/api/projects/:projectId/rows/kind',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['member_ids', 'kind', 'who'],
          additionalProperties: false,
          properties: {
            member_ids: idsSchema,
            kind: { type: ['string', 'null'], maxLength: 80 },
            who: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request) => {
      const kinds = await loadKinds(db());
      return rowAction(
        request.params.projectId,
        request.body.member_ids,
        request.body.who,
        (targets, sheet) => kindEntries(targets, sheet, kinds, { kind: request.body.kind }),
      );
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { member_ids: string[]; name: string | null; who: string };
  }>(
    '/api/projects/:projectId/rows/name',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['member_ids', 'name', 'who'],
          additionalProperties: false,
          properties: {
            member_ids: idsSchema,
            name: { type: ['string', 'null'], maxLength: 120 },
            who: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request) =>
      rowAction(request.params.projectId, request.body.member_ids, request.body.who, (targets) => {
        const after = request.body.name?.trim() || null;
        return targets
          .filter((m) => m.name !== after)
          .map((m) => ({
            memberId: m.id,
            field: 'name',
            before: m.name,
            after,
            status: 'edited' as const,
          }));
      }),
  );

  /**
   * "Apply suggested grades": a person presses it, and only then does a grade appear. Nothing is
   * pre-filled. For each shape family of the job's pieces that has a suggestion and no grade yet, the
   * suggestion is saved as that person's grade (the same append-only table as a typed grade).
   */
  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/grades/apply-suggested',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const { projectId } = request.params;
      const project = await db()
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project) throw new HttpError(404, { error: 'project not found' });
      const grades = await loadGrades(db(), projectId);
      const present = new Set(
        (await loadMemberViews(db(), projectId))
          .filter((m) => !m.deleted && m.not_member === null)
          .map((m) => familyOf(m))
          .filter((f): f is NonNullable<ReturnType<typeof familyOf>> => f !== null),
      );
      const applied: { family: string; grade: string }[] = [];
      for (const family of [...present].sort()) {
        const suggestion = GRADE_SUGGESTION[family];
        if (!suggestion || grades.has(family)) continue;
        await setGrade(db(), projectId, family, suggestion, who);
        applied.push({ family, grade: suggestion });
      }
      return { applied };
    },
  );
};
