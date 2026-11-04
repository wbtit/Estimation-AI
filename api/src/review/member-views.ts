// Members with their effective values (latest edits applied), view context, level, kinds, catalog
// and shared-line flags. The loader of every live piece read (moved from routes/members.ts).
import type { Kysely } from 'kysely';
import { defaultCatalogLookup } from '../catalog/lookup.js';
import type { Database, ViewBox } from '../db/types.js';
import { loadKinds } from './kinds.js';
import { memberView, type EditRow, type ViewContext } from './members.js';
import { loadSheetOverrides } from './overrides.js';
import { loadPrefixKinds } from './prefix-kinds.js';
import { annotateSharedLines } from './shared-line.js';

export async function loadMemberViews(
  db: Kysely<Database>,
  projectId: string,
  filter: { sheetId?: string; viewId?: string; memberIds?: string[] } = {},
) {
  let q = db.selectFrom('members').selectAll().where('project_id', '=', projectId);
  // Phase 11: pieces of the line-first build are not part of the label-first screens and totals;
  // they are loaded only when asked for by id (an edit to a built piece goes through here too)
  if (!filter.memberIds) q = q.where('build_run_id', 'is', null);
  if (filter.sheetId) q = q.where('sheet_id', '=', filter.sheetId);
  if (filter.viewId) q = q.where('view_id', '=', filter.viewId);
  if (filter.memberIds) q = q.where('id', 'in', filter.memberIds);
  const requested = await q.orderBy('created_at').orderBy('id').execute();
  if (requested.length === 0) return [];
  // shared lines are decided against every member of the sheet, so a single member is loaded with
  // its sheet's other members and only the requested ones are returned
  let rows = requested;
  const wanted = new Set(requested.map((r) => r.id));
  const sheetOf = [
    ...new Set(requested.map((r) => r.sheet_id).filter((s): s is string => s !== null)),
  ];
  if (sheetOf.length > 0 && (filter.memberIds || filter.viewId)) {
    const siblings = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('sheet_id', 'in', sheetOf)
      .where('build_run_id', 'is', null)
      .where('id', 'not in', [...wanted])
      .execute();
    rows = [...requested, ...siblings].sort(
      (a, b) => +a.created_at - +b.created_at || a.id.localeCompare(b.id),
    );
  }
  const edits = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'corrected_value', 'created_at'])
    .where(
      'member_id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const editsOf = new Map<string, EditRow[]>();
  for (const e of edits) {
    const list = editsOf.get(e.member_id) ?? [];
    list.push(e);
    editsOf.set(e.member_id, list);
  }
  const viewIds = [...new Set(rows.map((r) => r.view_id).filter((v): v is string => v !== null))];
  const views = viewIds.length
    ? await db.selectFrom('sheet_views').selectAll().where('id', 'in', viewIds).execute()
    : [];
  const ctx = new Map<string, ViewContext>(
    views.map((v) => [
      v.id,
      {
        id: v.id,
        box: v.box as ViewBox,
        scaleRatio: v.scale_ratio === null ? null : Number(v.scale_ratio),
        scaleConfirmed: v.scale_confirmed,
      },
    ]),
  );
  const sheetIds = [...new Set(rows.map((r) => r.sheet_id).filter((s): s is string => s !== null))];
  const sheets = sheetIds.length
    ? await db
        .selectFrom('sheets')
        .select(['id', 'level_guess'])
        .where('id', 'in', sheetIds)
        .execute()
    : [];
  const overrides = await loadSheetOverrides(db, sheetIds);
  const levelOf = new Map(
    sheets.map((s) => [s.id, overrides.get(s.id)?.level ?? s.level_guess ?? null] as const),
  );
  const lookups = {
    kinds: await loadKinds(db),
    catalog: await defaultCatalogLookup(db),
    mappedPrefixes: new Set((await loadPrefixKinds(db, projectId)).map((p) => p.prefix)),
  };
  const out = rows.map((r) =>
    memberView(
      r,
      editsOf.get(r.id) ?? [],
      r.view_id ? (ctx.get(r.view_id) ?? null) : null,
      r.sheet_id ? (levelOf.get(r.sheet_id) ?? null) : null,
      lookups,
    ),
  );
  return annotateSharedLines(out).filter((m) => wanted.has(m.id));
}
