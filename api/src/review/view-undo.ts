// View changes on the Undo stack (Phase 11c polish round, docs/PHASE11C_PLAN.md P2). Adding a view,
// deleting a view and changing a view's box each write a view_undo row with the state before the
// change; POST /undo puts the latest one back when it is newer than the person's last piece edit.
// Deleting a view removes its untouched pieces and moves pieces a person edited or drew to the
// first view; the snapshot keeps every removed row, so an undo restores the view with its pieces.
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/types.js';
import { logCountAction } from './count-log.js';

type Db = Kysely<Database> | Transaction<Database>;
type Row = Record<string, unknown>;

export type ViewUndoKind = 'add' | 'delete' | 'box';

export interface DeleteResult {
  pieces_removed: number;
  pieces_kept: number;
}

/** The fields of a view a box change sets (and its undo puts back). */
const BOX_FIELDS = ['box', 'box_confirmed_by', 'box_confirmed_at'] as const;

export async function recordViewUndo(
  db: Db,
  e: {
    projectId: string;
    sheetId: string;
    viewId: string;
    kind: ViewUndoKind;
    who: string;
    snapshot?: Row;
  },
): Promise<void> {
  await db
    .insertInto('view_undo')
    .values({
      project_id: e.projectId,
      sheet_id: e.sheetId,
      view_id: e.viewId,
      kind: e.kind,
      who: e.who,
      snapshot: JSON.stringify(e.snapshot ?? {}),
    })
    .execute();
}

/** The box fields of a view before a box change (the snapshot of a 'box' row). */
export function boxSnapshot(row: Row): Row {
  return Object.fromEntries(BOX_FIELDS.map((k) => [k, row[k] ?? null]));
}

/** Pieces of a view, split into untouched (a rebuild may replace them) and touched by a person. */
export async function viewPieces(
  db: Db,
  viewId: string,
): Promise<{ untouched: string[]; touched: string[] }> {
  const rows = await db
    .selectFrom('members as m')
    .select([
      'm.id',
      'm.review_status',
      'm.count_state',
      'm.added_by',
      (eb) =>
        eb
          .exists(
            eb.selectFrom('member_edits as e').select('e.id').whereRef('e.member_id', '=', 'm.id'),
          )
          .as('has_edit'),
    ])
    .where('m.build_view_id', '=', viewId)
    .orderBy('m.id')
    .execute();
  const isTouched = (p: (typeof rows)[number]) =>
    Boolean(p.has_edit) ||
    p.review_status !== 'unreviewed' ||
    p.count_state !== 'suggested' ||
    p.added_by !== null;
  return {
    untouched: rows.filter((p) => !isTouched(p)).map((p) => p.id),
    touched: rows.filter(isTouched).map((p) => p.id),
  };
}

/** Delete a view (never the first; the caller checks). Returns the counts and the snapshot that
 * puts it all back. */
export async function deleteView(
  trx: Transaction<Database>,
  viewId: string,
): Promise<DeleteResult & { snapshot: Row }> {
  const view = await trx
    .selectFrom('build_views')
    .selectAll()
    .where('id', '=', viewId)
    .executeTakeFirstOrThrow();
  const { untouched, touched } = await viewPieces(trx, viewId);
  const members = untouched.length
    ? await trx.selectFrom('members').selectAll().where('id', 'in', untouched).execute()
    : [];
  const nodes = untouched.length
    ? await trx
        .selectFrom('support_nodes')
        .select(['id', 'column_member_id'])
        .where('column_member_id', 'in', untouched)
        .execute()
    : [];
  const snapshot: Row = {
    view,
    pens: await trx.selectFrom('view_pens').selectAll().where('view_id', '=', viewId).execute(),
    exclusions: await trx
      .selectFrom('view_exclusions')
      .selectAll()
      .where('view_id', '=', viewId)
      .execute(),
    deselections: await trx
      .selectFrom('view_deselections')
      .selectAll()
      .where('view_id', '=', viewId)
      .execute(),
    members,
    nodes,
    kept: touched,
    runs: (
      await trx.selectFrom('build_runs').select('id').where('view_id', '=', viewId).execute()
    ).map((r) => r.id),
    plan_links: (
      await trx
        .selectFrom('build_views')
        .select('id')
        .where('column_plan_view_id', '=', viewId)
        .execute()
    ).map((r) => r.id),
  };
  if (touched.length)
    await trx
      .updateTable('members')
      .set({ build_view_id: null })
      .where('id', 'in', touched)
      .execute();
  if (untouched.length) await trx.deleteFrom('members').where('id', 'in', untouched).execute();
  await trx.deleteFrom('build_views').where('id', '=', viewId).execute();
  return { pieces_removed: untouched.length, pieces_kept: touched.length, snapshot };
}

/** Insert rows read earlier (snapshot JSON) back into a table, with their ids: JSON columns are
 * written as JSON text, generated columns are left out. */
async function restoreRows(trx: Transaction<Database>, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = await sql<{ column_name: string; data_type: string; is_generated: string }>`
    SELECT column_name, data_type, is_generated FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}`.execute(trx);
  const json = new Set(
    cols.rows
      .filter((c) => c.data_type === 'jsonb' || c.data_type === 'json')
      .map((c) => c.column_name),
  );
  const known = new Set(
    cols.rows.filter((c) => c.is_generated !== 'ALWAYS').map((c) => c.column_name),
  );
  const values = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r)
        .filter(([k]) => known.has(k))
        .map(([k, v]) => [k, json.has(k) && v !== null ? JSON.stringify(v) : v]),
    ),
  );
  await trx
    .insertInto(table as never)
    .values(values as never)
    .execute();
}

/** Put a deleted view back from its snapshot: the view, its pens, exclude boxes and deselections,
 * its untouched pieces (same ids) and their support-node links, the edited pieces moved to the
 * first view, its build runs and the column-plan links to it. */
async function restoreView(trx: Transaction<Database>, snap: Row): Promise<number> {
  const view = snap.view as Row;
  await restoreRows(trx, 'build_views', [view]);
  await restoreRows(trx, 'view_pens', snap.pens as Row[]);
  await restoreRows(trx, 'view_exclusions', snap.exclusions as Row[]);
  await restoreRows(trx, 'view_deselections', snap.deselections as Row[]);
  const members = snap.members as Row[];
  await restoreRows(trx, 'members', members);
  const id = view.id as string;
  for (const n of snap.nodes as { id: string; column_member_id: string }[])
    await trx
      .updateTable('support_nodes')
      .set({ column_member_id: n.column_member_id })
      .where('id', '=', n.id)
      .where('column_member_id', 'is', null)
      .execute();
  const kept = snap.kept as string[];
  if (kept.length)
    await trx
      .updateTable('members')
      .set({ build_view_id: id })
      .where('id', 'in', kept)
      .where('build_view_id', 'is', null)
      .execute();
  const runs = snap.runs as string[];
  if (runs.length)
    await trx
      .updateTable('build_runs')
      .set({ view_id: id })
      .where('id', 'in', runs)
      .where('view_id', 'is', null)
      .execute();
  const links = snap.plan_links as string[];
  if (links.length)
    await trx
      .updateTable('build_views')
      .set({ column_plan_view_id: id })
      .where('id', 'in', links)
      .where('column_plan_view_id', 'is', null)
      .execute();
  return members.length;
}

/** This person's latest view change that is not undone, or null. */
export async function lastViewChange(db: Db, projectId: string, who: string) {
  return (
    (await db
      .selectFrom('view_undo')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('who', '=', who)
      .where('undone_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst()) ?? null
  );
}

export interface ViewUndoResult {
  undone_view_change: string;
  kind: ViewUndoKind;
  view_id: string;
  sheet_id: string;
  /** Pieces restored (undo of a delete) or removed / kept (undo of an add). */
  pieces_restored: number;
  pieces_removed: number;
  pieces_kept: number;
  /** False when the view was already gone or back (another person): nothing changed. */
  applied: boolean;
}

/** Undo one view change and log it ('undo', ids and counts only). */
export async function undoViewChange(
  db: Kysely<Database>,
  row: {
    id: string;
    project_id: string;
    sheet_id: string;
    view_id: string;
    kind: ViewUndoKind;
    snapshot: unknown;
  },
  who: string,
): Promise<ViewUndoResult> {
  return db.transaction().execute(async (trx) => {
    const out: ViewUndoResult = {
      undone_view_change: row.id,
      kind: row.kind,
      view_id: row.view_id,
      sheet_id: row.sheet_id,
      pieces_restored: 0,
      pieces_removed: 0,
      pieces_kept: 0,
      applied: false,
    };
    const exists = await trx
      .selectFrom('build_views')
      .select(['id', 'position', 'box'])
      .where('id', '=', row.view_id)
      .executeTakeFirst();
    const snap = (row.snapshot ?? {}) as Row;
    if (row.kind === 'add' && exists && exists.position !== 1) {
      const r = await deleteView(trx, row.view_id);
      out.pieces_removed = r.pieces_removed;
      out.pieces_kept = r.pieces_kept;
      out.applied = true;
    } else if (row.kind === 'delete' && !exists) {
      out.pieces_restored = await restoreView(trx, snap);
      out.applied = true;
    } else if (row.kind === 'box' && exists) {
      await trx
        .updateTable('build_views')
        .set({
          box: snap.box === null ? null : JSON.stringify(snap.box),
          box_confirmed_by: (snap.box_confirmed_by as string | null) ?? null,
          box_confirmed_at: (snap.box_confirmed_at as string | null) ?? null,
          setup_changed_at: new Date(),
        } as never)
        .where('id', '=', row.view_id)
        .execute();
      await trx
        .insertInto('sheet_edits')
        .values({
          sheet_id: row.sheet_id,
          field_name: exists.position === 1 ? 'crop_region' : `view${exists.position}.crop_region`,
          original_value: JSON.stringify(exists.box ?? null),
          corrected_value: JSON.stringify(snap.box ?? null),
          editor: who,
          reason: 'undo',
        } as never)
        .execute();
      out.applied = true;
    }
    await trx
      .updateTable('view_undo')
      .set({ undone_at: new Date(), undone_by: who })
      .where('id', '=', row.id)
      .execute();
    await logCountAction(trx, {
      projectId: row.project_id,
      sheetId: row.sheet_id,
      action: 'undo',
      who,
      detail: {
        view_change: row.kind,
        view_id: row.view_id,
        applied: out.applied,
        pieces_restored: out.pieces_restored,
        pieces_removed: out.pieces_removed,
        pieces_kept: out.pieces_kept,
      },
    });
    return out;
  });
}
