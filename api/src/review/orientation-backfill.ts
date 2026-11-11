// Phase 0-column-capture: read the orientation of columns that have none yet (placed before it was
// stored, or by an older build). The plan is read-only; apply fills ONLY an empty orientation_deg of
// a column nobody has edited (a new column: nothing is overwritten) and says so in the action log.
// The reading is lib/orientation.ts on the page's stored lines, in the window of the column family
// (the stored symbol's own box when one is within the snap radius, else a probe box around the
// column): never from a plate / pier around it.
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { SNAP_RADIUS_PT, unknownSquares } from './column-snap.js';
import { loadPieces } from './line-first-pieces.js';
import {
  glyphCentre,
  ownSymbolSize,
  probeBox,
  readOrientation,
  refineCentre,
  type LineRow,
  type Reading,
} from './orientation.js';

export interface BackfillRow {
  id: string;
  sheet_id: string;
  page: number; // 1-based
  tag: string | null;
  a: [number, number];
  family: string;
  profile: string | null;
  scale_ratio: number;
  rotation_deg: number | null;
  orientation_deg: number | null;
  orientation_state: string | null;
  reading: Reading;
  box: [number, number, number, number];
  edited: boolean;
  /** what apply would store: deg and state; null = nothing readable (the marker stays amber) */
  would_store: { deg: number; state: 'clear' | 'unsure' } | null;
}

interface StoredSym {
  family: string;
  solid?: string | null;
  box: number[];
  centre: number[];
  rotation_deg: number;
  real_in: number[];
}

export async function planOrientationBackfill(
  db: Kysely<Database>,
  projectId: string,
  opts: { pageIndex?: number } = {},
): Promise<BackfillRow[]> {
  const sheets = await db
    .selectFrom('sheets')
    .select(['id', 'page_index'])
    .where('project_id', '=', projectId)
    .orderBy('page_index')
    .execute();
  const out: BackfillRow[] = [];
  for (const sh of sheets) {
    if (opts.pageIndex !== undefined && sh.page_index !== opts.pageIndex) continue;
    const pieces = (await loadPieces(db, projectId, { sheetId: sh.id })).filter(
      (p) => p.type === 'column' && !p.deleted && p.a,
    );
    if (pieces.length === 0) continue;
    const lrow = await db
      .selectFrom('sheet_lines')
      .select('lines')
      .where('sheet_id', '=', sh.id)
      .executeTakeFirst();
    const lines = (lrow ? (lrow.lines as unknown as LineRow[]) : []) as LineRow[];
    const srow = await db
      .selectFrom('page_symbols')
      .select('symbols')
      .where('sheet_id', '=', sh.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const symbols = ((srow?.symbols ?? []) as unknown as StoredSym[]) ?? [];
    const squares = unknownSquares(symbols);
    for (const p of pieces) {
      if (p.kind === 'Stud/Post' || !p.scale_ratio) continue;
      const k = 72 / p.scale_ratio;
      const family = p.symbol ?? 'w_shape';
      // the stored symbol under the column, as the click found it (known family, solid, 45 degree square)
      let sym: StoredSym | null = null;
      let best = SNAP_RADIUS_PT;
      symbols.forEach((s, i) => {
        if (s.family === 'unknown' && !s.solid && !squares[i]) return;
        const d = Math.hypot(p.a![0] - s.centre[0]!, p.a![1] - s.centre[1]!);
        if (d <= best) {
          best = d;
          sym = s;
        }
      });
      const s = sym as StoredSym | null;
      const box: [number, number, number, number] = s
        ? (s.box as [number, number, number, number])
        : [p.a![0] - 6 * k, p.a![1] - 6 * k, p.a![0] + 6 * k, p.a![1] + 6 * k];
      // the size hint: the column's OWN stored symbol only (its family, within 5 in). Never a
      // neighbour's size, never the size of a profile the column inherited from its example
      const known = ownSymbolSize(symbols, p.a as [number, number], family, p.scale_ratio);
      // the window is a family-sized square around the column itself (see probeBox)
      const reading = readOrientation({
        lines,
        box: probeBox(p.a as [number, number], p.scale_ratio),
        family,
        ratio: p.scale_ratio,
        sizeIn: known,
      });
      out.push({
        id: p.id,
        sheet_id: sh.id,
        page: sh.page_index + 1,
        tag: p.tag,
        a: p.a as [number, number],
        family,
        profile: p.profile,
        scale_ratio: p.scale_ratio,
        rotation_deg: p.rotation_deg,
        orientation_deg: p.orientation_deg,
        orientation_state: p.orientation_state,
        reading,
        box,
        edited: p.orientation_source === 'manual',
        would_store:
          p.orientation_deg === null && reading.deg !== null && reading.state !== 'none'
            ? { deg: reading.deg, state: reading.state === 'clear' ? 'clear' : 'unsure' }
            : null,
      });
    }
  }
  return out;
}

/** Fills the empty orientation of the planned columns (nothing already set or edited changes). */
export async function applyOrientationBackfill(
  db: Kysely<Database>,
  projectId: string,
  rows: readonly BackfillRow[],
): Promise<number> {
  const todo = rows.filter((r) => r.would_store && !r.edited);
  await db.transaction().execute(async (trx) => {
    for (const r of todo)
      await trx
        .updateTable('members')
        .set({
          orientation_deg: r.would_store!.deg,
          orientation_state: r.would_store!.state,
          orientation_source: 'backfill',
        } as never)
        .where('id', '=', r.id)
        .where('orientation_deg', 'is', null)
        .execute();
    if (todo.length > 0)
      await sql`INSERT INTO count_actions (project_id, action, who, detail)
        VALUES (${projectId}, 'edit', 'orientation-backfill',
          ${JSON.stringify({ orientation_backfill: { read: todo.length, of: rows.length } })}::jsonb)`.execute(
        trx,
      );
  });
  return todo.length;
}

export interface PointRow extends BackfillRow {
  /** where the position was before its centre was refined to the symbol's own centre */
  placed: [number, number];
  /** the real inches it was refined by (null: left where it was) */
  refined_in: number | null;
}

/** Positions on a page read as columns (a DRY RUN: nothing is stored). Each is read in a family-sized
 * window, its centre refined to the symbol's own centre when that is 2.5 to 5 in off (the reading
 * must be clear), exactly as a click and a Find similar match are. Used to make a contact sheet of
 * a page that has no placed columns. */
export async function planOrientationPoints(
  db: Kysely<Database>,
  sheetId: string,
  points: readonly [number, number][],
  ratio: number,
  family = 'w_shape',
): Promise<PointRow[]> {
  const sh = await db
    .selectFrom('sheets')
    .select(['page_index'])
    .where('id', '=', sheetId)
    .executeTakeFirstOrThrow();
  const lrow = await db
    .selectFrom('sheet_lines')
    .select('lines')
    .where('sheet_id', '=', sheetId)
    .executeTakeFirst();
  const lines = (lrow ? (lrow.lines as unknown as LineRow[]) : []) as LineRow[];
  return points.map((pt, i) => {
    const reading = readOrientation({ lines, box: probeBox(pt, ratio), family, ratio });
    const rf = reading.state === 'clear' ? refineCentre(pt, glyphCentre(reading), ratio) : null;
    const a = (rf?.moved ? rf.centre : pt) as [number, number];
    return {
      id: `pt-${i + 1}`,
      sheet_id: sheetId,
      page: sh.page_index + 1,
      tag: null,
      a,
      placed: pt,
      refined_in: rf?.moved ? Math.round(rf.offsetIn * 10) / 10 : null,
      family,
      profile: null,
      scale_ratio: ratio,
      rotation_deg: 0, // what main draws for a new column
      orientation_deg: null,
      orientation_state: null,
      reading,
      box: probeBox(a, ratio),
      edited: false,
      would_store: null,
    };
  });
}
