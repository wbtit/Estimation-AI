import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { logCountAction } from '../review/count-log.js';
import { lastUndoableAction, undoLastAction, redoLastUndo } from '../review/member-ops.js';
import { loadKinds } from '../review/kinds.js';
import { loadMemberViews } from '../review/member-views.js';
import { lastViewChange, undoViewChange } from '../review/view-undo.js';
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
const whoOnly = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: { who: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

export const memberActionRoutes: FastifyPluginAsync<MemberActionOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.get('/api/member-kinds', async () => ({
    kinds: [...(await loadKinds(db())).values()].map((k) => ({
      kind: k.kind,
      scope: k.scope,
      symbol_group: k.symbol_group,
      prefix: k.prefix,
      provisional: k.provisional,
      sort: k.sort,
    })),
  }));

  /** What was changed on this member, by whom and when, with the value before (nothing is hidden). */

  /** How many other pieces share this piece's tag: shown before the "apply to all" click. */

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/undo',
    { schema: { params: projectParams, body: whoOnly } },
    async (request) => {
      const { projectId } = request.params;
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      // the latest of a piece edit and a view change (add, delete, box) is undone
      const view = await lastViewChange(db(), projectId, who);
      if (view) {
        const member = await lastUndoableAction(db(), projectId, who);
        if (!member || new Date(view.created_at as unknown as Date) >= new Date(member.at))
          return { undone: null, rows: 0, view: await undoViewChange(db(), view, who) };
      }
      const result = await undoLastAction(db(), projectId, who, async (id) => {
        const [m] = await loadMemberViews(db(), projectId, { memberIds: [id] });
        return m ?? null;
      });
      if (!result.undone) throw new HttpError(409, { error: 'nothing to undo' });
      await logUndoRedo(projectId, who, 'undo', result.undone, result.undone);
      return result;
    },
  );

  /** Log an undo or redo with the sheet and member of the action it touched. */
  async function logUndoRedo(
    projectId: string,
    who: string,
    action: 'undo' | 'redo',
    editActionId: string,
    touched: string,
  ) {
    const row = await db()
      .selectFrom('member_edits as e')
      .innerJoin('members as m', 'm.id', 'e.member_id')
      .select(['m.id as member_id', 'm.sheet_id'])
      .where('e.action_id', '=', touched)
      .orderBy('e.id')
      .executeTakeFirst();
    await logCountAction(db(), {
      projectId,
      sheetId: row?.sheet_id ?? null,
      memberId: row?.member_id ?? null,
      action,
      who,
      editActionId,
      detail: { of_action: touched },
    });
  }

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/redo',
    { schema: { params: projectParams, body: whoOnly } },
    async (request) => {
      const { projectId } = request.params;
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const result = await redoLastUndo(db(), projectId, who);
      if (!result.redone) throw new HttpError(409, { error: 'nothing to redo' });
      await logUndoRedo(projectId, who, 'redo', result.redone, result.undone_action as string);
      return result;
    },
  );
};
