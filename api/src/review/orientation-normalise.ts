// Phase 0 column capture: columns whose orientation a person set with the rotate handle a degree or
// three off the axes (179, 178, 89, 87: the handle had no snapping) are normalised to the nearest
// of 0 / 90 / 45 within 3 degrees. The plan is a read-only preview; apply writes ONE undoable action
// of orientation edits (the person's own value stays in the edit history). Nothing is applied
// without the person's yes.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from './actions.js';
import { logCountAction } from './count-log.js';
import { loadPieces } from './line-first-pieces.js';
import { snapOrientation } from './orientation.js';

export interface NormaliseRow {
  id: string;
  tag: string | null;
  page: number;
  family: string;
  from: number;
  to: number;
}

export async function planNormalise(
  db: Kysely<Database>,
  projectId: string,
  opts: { pageIndex?: number } = {},
): Promise<NormaliseRow[]> {
  const sheets = await db
    .selectFrom('sheets')
    .select(['id', 'page_index'])
    .where('project_id', '=', projectId)
    .orderBy('page_index')
    .execute();
  const out: NormaliseRow[] = [];
  for (const sh of sheets) {
    if (opts.pageIndex !== undefined && sh.page_index !== opts.pageIndex) continue;
    for (const p of await loadPieces(db, projectId, { sheetId: sh.id })) {
      if (p.type !== 'column' || p.deleted || p.orientation_source !== 'manual') continue;
      if (p.orientation_deg === null) continue;
      const family = p.symbol ?? 'w_shape';
      const to = snapOrientation(p.orientation_deg, family);
      const period = family === 'hss_square' ? 90 : 180;
      const diff = Math.min(
        Math.abs(to - p.orientation_deg),
        period - Math.abs(to - p.orientation_deg),
      );
      // only a value that is a little off an axis (the snap found one within 3 degrees)
      if (diff > 0.05 && diff <= 3)
        out.push({
          id: p.id,
          tag: p.tag,
          page: sh.page_index + 1,
          family,
          from: p.orientation_deg,
          to,
        });
    }
  }
  return out;
}

export async function applyNormalise(
  db: Kysely<Database>,
  projectId: string,
  rows: readonly NormaliseRow[],
  who: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  await db.transaction().execute(async (trx) => {
    const entries: EditEntry[] = rows.map((r) => ({
      memberId: r.id,
      field: 'orientation',
      before: { deg: r.from, state: 'manual', source: 'manual' },
      after: { deg: r.to, state: 'manual', source: 'manual' },
      status: 'edited',
    }));
    const actionId = await recordAction(trx, who, entries);
    await logCountAction(trx, {
      projectId,
      action: 'edit',
      who,
      editActionId: actionId,
      detail: { orientation_normalise: rows.length },
    });
  });
  return rows.length;
}
