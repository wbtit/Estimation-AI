// Phase 0 profile from callout: the profile search, "Mark all", and the profile proposals for
// members that already exist.
//   GET  /api/projects/:projectId/profile-search?q=&sheet_id=      occurrences, counts per sheet / project
//   GET  /api/projects/:projectId/profile-counts?sheet_id=         profiles on a sheet / in the project
//   POST /api/projects/:projectId/sheets/:sheetId/profile-labels/read   queue a read of the labels
//   POST /api/projects/:projectId/sheets/:sheetId/profile-search/mark   { q, who, accept?, unticked? }
//   GET  /api/projects/:projectId/sheets/:sheetId/profile-proposals     members whose own label disagrees
//   POST /api/projects/:projectId/sheets/:sheetId/profile-proposals/apply  { who, member_ids? } one action
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { logCountAction } from '../review/count-log.js';
import { asSheet, pickView, viewsOf } from '../review/build-views.js';
import { loadKinds } from '../review/kinds.js';
import { loadLabels } from '../review/profile-link.js';
import {
  applyProposals,
  columnLinks,
  equivKey,
  proposeProfiles,
  searchKey,
  searchProject,
} from '../review/profile-search.js';
import { recordAction } from '../review/actions.js';
import { takeTagNumbers } from '../review/tag-counter.js';
import { drawnValues } from './review-ui.js';
import { HttpError } from './http-error.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
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

const trim = (v: string) => {
  const w = v.trim();
  if (!w) throw new HttpError(400, { error: 'who must not be blank' });
  return w;
};

type MarkProposal =
  | { kind: 'invalid'; label_id: string; text: string; ticked: boolean; reason: string }
  | {
      kind: 'set';
      label_id: string;
      member_id: string;
      tag: string | null;
      current: string | null;
      proposed: string | null;
      change: boolean;
      confidence: string | null;
      reason: string;
      ticked: boolean;
    }
  | {
      kind: 'new';
      label_id: string;
      text: string;
      proposed: string | null;
      at: [number, number];
      position: string;
      can_create: boolean;
      ticked: boolean;
      reason: string;
    };

export const profileSearchRoutes: FastifyPluginAsync<{ db?: Kysely<Database> }> = async (
  app,
  options,
) => {
  const db = () => options.db ?? getDb();
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function sheetOf(projectId: string, sheetId: string) {
    const s = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'sheet not found' });
    return s;
  }

  /** How far the labels are read: sheets read, sheets with no text layer, sheets not read yet. */
  async function readState(projectId: string) {
    const rows = await db()
      .selectFrom('sheets')
      .select(['id', 'labels_read_at', 'labels_text_lines'])
      .where('project_id', '=', projectId)
      .execute();
    return {
      sheets: rows.length,
      read: rows.filter((r) => r.labels_read_at !== null).length,
      no_text: rows.filter((r) => r.labels_read_at !== null && r.labels_text_lines === 0).length,
    };
  }

  app.get<{ Params: { projectId: string }; Querystring: { q: string; sheet_id?: string } }>(
    '/api/projects/:projectId/profile-search',
    {
      schema: {
        params: projectParams,
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', minLength: 1, maxLength: 80 }, sheet_id: uuid },
        },
      },
    },
    async (request) => {
      const t0 = performance.now();
      const { projectId } = request.params;
      const k = searchKey(request.query.q);
      if (!k)
        throw new HttpError(400, {
          error: 'not a profile: type one like W12X26 or HSS12X12X3/8',
          code: 'not_a_profile',
        });
      const hits = await searchProject(db(), projectId, k.key, k.family);
      const perSheet = new Map<
        string,
        { sheet_id: string; page_number: number; sheet_number: string | null; count: number }
      >();
      for (const h of hits) {
        const cur = perSheet.get(h.occurrence.sheet_id);
        if (cur) cur.count += 1;
        else
          perSheet.set(h.occurrence.sheet_id, {
            sheet_id: h.occurrence.sheet_id,
            page_number: h.page_number,
            sheet_number: h.sheet_number,
            count: 1,
          });
      }
      return {
        query: request.query.q,
        canonical: k.canonical,
        total: hits.length,
        per_sheet: [...perSheet.values()].sort((a, b) => a.page_number - b.page_number),
        occurrences: request.query.sheet_id
          ? hits
              .filter((h) => h.occurrence.sheet_id === request.query.sheet_id)
              .map((h) => h.occurrence)
          : [],
        labels: await readState(projectId),
        ms: Math.round(performance.now() - t0),
      };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { sheet_id?: string } }>(
    '/api/projects/:projectId/profile-counts',
    {
      schema: {
        params: projectParams,
        querystring: { type: 'object', properties: { sheet_id: uuid } },
      },
    },
    async (request) => {
      const rows = await db()
        .selectFrom('page_labels as l')
        .innerJoin('sheets as s', 's.id', 'l.sheet_id')
        .select(['l.sheet_id', 'l.canonical', 'l.family', 'l.valid', 'l.flags', 'l.kind'])
        .where('s.project_id', '=', request.params.projectId)
        .execute();
      const by = new Map<
        string,
        { profile: string; project: number; sheet: number; valid: boolean; existing: number }
      >();
      let joists = 0;
      let joistsSheet = 0;
      for (const r of rows) {
        const here = r.sheet_id === request.query.sheet_id;
        if (r.kind === 'joist') {
          joists += 1;
          if (here) joistsSheet += 1;
          continue;
        }
        if (!r.canonical) continue;
        const key = equivKey(r.canonical);
        const cur = by.get(key) ?? {
          profile: r.canonical,
          project: 0,
          sheet: 0,
          valid: r.valid,
          existing: 0,
        };
        cur.project += 1;
        if (here) cur.sheet += 1;
        if (r.flags.includes('existing')) cur.existing += 1;
        by.set(key, cur);
      }
      return {
        profiles: [...by.values()].sort((a, b) => b.project - a.project),
        joists: { project: joists, sheet: joistsSheet },
        labels: await readState(request.params.projectId),
      };
    },
  );

  // every size label of a sheet (a click on one picks it as the search)
  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/profile-labels',
    { schema: { params: sheetParams } },
    async (request) => {
      await sheetOf(request.params.projectId, request.params.sheetId);
      const rows = await db()
        .selectFrom('page_labels')
        .select([
          'id',
          'text',
          'raw',
          'canonical',
          'valid',
          'flags',
          'kind',
          'x0',
          'y0',
          'x1',
          'y1',
        ])
        .where('sheet_id', '=', request.params.sheetId)
        .execute();
      return {
        labels: rows
          .filter((r) => r.kind === 'profile' && r.canonical)
          .map((r) => ({
            label_id: r.id,
            text: r.text,
            canonical: r.canonical,
            valid: r.valid,
            flags: r.flags,
            box: [Number(r.x0), Number(r.y0), Number(r.x1), Number(r.y1)],
          })),
      };
    },
  );

  app.post<{ Params: { projectId: string; sheetId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/profile-labels/read',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who },
        },
      },
    },
    async (request, reply) => {
      const s = await sheetOf(request.params.projectId, request.params.sheetId);
      const open = await db()
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'read_labels')
        .where('status', 'in', ['pending', 'processing'])
        .where((eb) => eb(eb.ref('payload', '->>').key('sheet_id'), '=', s.id))
        .executeTakeFirst();
      if (open) return reply.status(202).send({ job_id: open.id, queued: false });
      const job = await db()
        .insertInto('jobs')
        .values({ type: 'read_labels', payload: JSON.stringify({ sheet_id: s.id }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, queued: true });
    },
  );

  // Mark all: every occurrence on the sheet -> the member at its target, or a proposed new column
  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { q: string; who: string; accept?: boolean; unticked?: string[] };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/profile-search/mark',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['q', 'who'],
          additionalProperties: false,
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 80 },
            who,
            accept: { type: 'boolean' },
            unticked: { type: 'array', items: uuid, maxItems: 5000 },
          },
        },
      },
    },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const editor = trim(request.body.who);
      const page = await sheetOf(projectId, sheetId);
      const k = searchKey(request.body.q);
      if (!k) throw new HttpError(400, { error: 'not a profile', code: 'not_a_profile' });
      const hits = (await searchProject(db(), projectId, k.key, k.family)).filter(
        (h) => h.occurrence.sheet_id === sheetId,
      );
      const links = await columnLinks(db(), projectId, sheetId);
      const columnFamily = ['W', 'HSS', 'HP', 'PIPE', 'S', 'M'].includes(k.family);
      const rows = hits.map((h) => {
        const o = h.occurrence;
        const label = { ...o };
        const linked = links.filter(
          (c) => c.link.label?.id === o.label_id && c.link.method !== 'typical',
        );
        const leader = o.box && columnFamily ? true : false;
        void leader;
        return { label, linked };
      });
      // the proposals: set a linked member's profile, or a new member at the label's leader
      const labelRows = new Map<string, Awaited<ReturnType<typeof loadLabels>>[number]>();
      for (const v of await viewsOf(db(), sheetId))
        for (const l of await loadLabels(db(), sheetId, v.row.id)) if (l.id) labelRows.set(l.id, l);
      const unticked = new Set(request.body.unticked ?? []);
      const proposals: MarkProposal[] = rows.flatMap(({ label, linked }): MarkProposal[] => {
        const lb = labelRows.get(label.label_id);
        const ticked = !unticked.has(label.label_id);
        if (!label.valid)
          return [
            {
              kind: 'invalid' as const,
              label_id: label.label_id,
              text: label.text,
              ticked: false,
              reason: 'not in the AISC catalog: not marked',
            },
          ];
        if (linked.length)
          return linked.map((c) => ({
            kind: 'set' as const,
            label_id: label.label_id,
            member_id: c.member_id,
            tag: c.tag,
            current: c.current_profile,
            proposed: label.canonical,
            change: c.current_profile !== label.canonical,
            confidence: c.link.confidence,
            reason: c.link.reason,
            ticked,
          }));
        const at = lb?.leaders[0] ?? null;
        return [
          {
            kind: 'new' as const,
            label_id: label.label_id,
            text: label.text,
            proposed: label.canonical,
            at: at ?? [(label.box[0] + label.box[2]) / 2, (label.box[1] + label.box[3]) / 2],
            position: at ? 'leader end' : 'label centre (no leader line)',
            can_create: columnFamily,
            ticked: ticked && columnFamily,
            reason: columnFamily
              ? 'no column of the page is linked to this label'
              : 'no beam is linked to this label (a beam is not created from a label)',
          },
        ];
      });
      const preview = {
        query: request.body.q,
        canonical: k.canonical,
        occurrences: hits.length,
        proposals,
        accepted: false,
        created: 0,
        updated: 0,
        action_id: null as string | null,
      };
      if (!request.body.accept) return preview;
      const chosen = proposals.filter((p) => p.ticked);
      const sets = chosen.filter((p) => p.kind === 'set' && p.change);
      const news = chosen.filter((p) => p.kind === 'new' && p.can_create);
      const views = await viewsOf(db(), sheetId);
      const info = (await loadKinds(db())).get('Column');
      if (news.length && !info)
        throw new HttpError(400, { error: 'the Column kind is not in the list' });
      const made = await db()
        .transaction()
        .execute(async (trx) => {
          const entries: Parameters<typeof recordAction>[2] = [];
          for (const p of sets) {
            if (p.kind !== 'set') continue;
            const c = links.find((x) => x.member_id === p.member_id)!;
            const link = {
              method: 'label',
              confidence: p.confidence,
              reason: p.reason,
              applied: true,
            };
            entries.push(
              {
                memberId: p.member_id,
                field: 'profile_raw',
                before: c.current_profile,
                after: p.proposed,
              },
              {
                memberId: p.member_id,
                field: 'profile',
                before: c.current_profile,
                after: p.proposed,
              },
              {
                memberId: p.member_id,
                field: 'profile_source',
                before: c.current_source,
                after: 'label',
              },
              { memberId: p.member_id, field: 'profile_link', before: null, after: link },
            );
          }
          const ids: string[] = [];
          for (const p of news) {
            if (p.kind !== 'new') continue;
            const lb = labelRows.get(p.label_id)!;
            const view = pickView(
              views,
              hits.find((h) => h.occurrence.label_id === p.label_id)!.occurrence.view_id,
            );
            if (!view) continue;
            const run = await trx
              .selectFrom('build_runs')
              .select('id')
              .where('sheet_id', '=', sheetId)
              .where('status', '=', 'done')
              .orderBy('finished_at', 'desc')
              .executeTakeFirst();
            const ratio = Number(asSheet(page, view).build_scale_ratio);
            if (!run || !Number.isFinite(ratio)) continue; // the page has no finished Build or scale
            const number = await takeTagNumbers(trx, projectId, sheetId, info!.prefix);
            const row = await trx
              .insertInto('members')
              .values(
                drawnValues({
                  projectId,
                  sheetId,
                  runId: run.id,
                  viewId: view.row.position === 1 ? null : view.row.id,
                  editor,
                  kind: info!.kind,
                  prefix: info!.prefix,
                  number,
                  type: 'column',
                  text: lb.raw,
                  profile: lb.canonical,
                  profileSource: 'label',
                  profileLabelId: lb.id,
                  profileLink: {
                    method: 'search',
                    confidence: 'low',
                    reason: `marked from the search; position from the ${p.position}`,
                    valid: true,
                  },
                  a: p.at as [number, number],
                  b: null,
                  ratio,
                  tos: null,
                  symbol: null,
                  symbolSource: null,
                  rotation: null,
                  realIn: null,
                }) as never,
              )
              .returning('id')
              .executeTakeFirstOrThrow();
            ids.push(row.id);
            entries.push({
              memberId: row.id,
              field: '__created__',
              before: null,
              after: { type: 'column', kind: info!.kind, profile: lb.canonical },
            });
          }
          if (!entries.length) return { actionId: null as string | null, ids };
          const actionId = await recordAction(trx, editor, entries);
          await logCountAction(trx, {
            projectId,
            sheetId,
            action: 'profile_mark',
            who: editor,
            editActionId: actionId,
            detail: {
              profile: k.canonical,
              updated: sets.length,
              created: ids.length,
              member_ids: ids,
              unticked: [...unticked],
            },
          });
          return { actionId, ids };
        });
      return {
        ...preview,
        accepted: true,
        created: made.ids.length,
        updated: sets.length,
        action_id: made.actionId,
      };
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/profile-proposals',
    { schema: { params: sheetParams } },
    async (request) => {
      await sheetOf(request.params.projectId, request.params.sheetId);
      return {
        proposals: await proposeProfiles(db(), request.params.projectId, request.params.sheetId),
      };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { who: string; member_ids?: string[] };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/profile-proposals/apply',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who, member_ids: { type: 'array', items: uuid, maxItems: 5000 } },
        },
      },
    },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const editor = trim(request.body.who);
      await sheetOf(projectId, sheetId);
      const all = await proposeProfiles(db(), projectId, sheetId);
      const only = request.body.member_ids ? new Set(request.body.member_ids) : null;
      const chosen = all.filter((p) => !only || only.has(p.member_id));
      const links = await columnLinks(db(), projectId, sheetId);
      const actionId = await db()
        .transaction()
        .execute(async (trx) => {
          const id = await applyProposals(
            trx,
            projectId,
            editor,
            chosen.map((p) => {
              const c = links.find((x) => x.member_id === p.member_id)!;
              return {
                member_id: p.member_id,
                proposed: p.proposed,
                set_existing: p.set_existing,
                confidence: p.confidence,
                reason: p.reason,
                label_id: p.label_id,
                before: {
                  profile: c.current_profile,
                  profile_raw: c.current_profile,
                  source: c.current_source,
                },
              };
            }),
          );
          if (id)
            await logCountAction(trx, {
              projectId,
              sheetId,
              action: 'profile_apply',
              who: editor,
              editActionId: id,
              detail: { applied: chosen.length, member_ids: chosen.map((p) => p.member_id) },
            });
          return id;
        });
      return { applied: chosen.length, action_id: actionId };
    },
  );
};
