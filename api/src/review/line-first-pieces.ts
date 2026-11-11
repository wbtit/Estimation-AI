// Built pieces of the line-first build (Phase 11b) with their effective values: what the review UI
// shows, the BOM sums and the system-vs-final report compares. Edits are member_edits rows like any
// other member (the latest row of a field wins; an undo appends the inverse row), so the existing
// undo works on them. Effective values come from loadMemberViews (size, type, kind, tag, quantity,
// deleted) plus the line-first fields kept here:
//   studs, camber_raw   the size label's extras, as a person typed them
//   ignored             on the page, grey, out of the BOM
//   approved            a person confirmed the member as built (it stays approved through later
//                       edits of its size, type, studs, camber or ends; Unapprove or Undo removes it)
//   page_ends           { a: [x, y], b: [x, y] | null } a person moved an end (displayed page points)
//   angle_length / angle_offset / slab_edge_side / vertical_leg   a perimeter angle's own values
//                       (Phase 0 perimeter angle: its ends are derived from its parent beam)
// Length = support-to-support: the 3D distance of the stored plan end points (both ends at the page
// T.O.S., so with no T.O.S. it is the plan length), or after a moved end the page distance x the
// build scale (pt x 25.4/72 x ratio). Deterministic.
import type { Kysely } from 'kysely';
import { markerRotation } from './orientation.js';
import type { Database } from '../db/types.js';
import { loadMemberViews } from './member-views.js';
import type { BuiltPiece } from './line-first-bom.js';
import { deriveAngle } from './perimeter-angle.js';

export const MM_PER_PT = 25.4 / 72;

export type PagePt = [number, number];

export interface PieceView {
  id: string;
  member_id: string;
  sheet_id: string | null;
  type: string;
  kind: string | null;
  tag: string | null;
  quantity: number;
  profile: string | null;
  profile_raw: string | null;
  studs: number | null;
  camber_raw: string | null;
  ignored: boolean;
  /** A person confirmed it (Approve). */
  approved: boolean;
  /** Phase 12b: the column another column-plan page already has (left out of the totals). */
  duplicate_of: string | null;
  /** Phase 12b: a kind outside the steel totals (Joist, Wall, Other trades). */
  excluded_kind: boolean;
  deleted: boolean;
  /** Drawn by a person in the review UI. */
  added: boolean;
  /** Any edit row (a person touched it; a rebuild keeps it as it is). */
  edited: boolean;
  /** Displayed page points; b is null for a column. */
  a: PagePt | null;
  b: PagePt | null;
  ends_moved: boolean;
  length_mm: number | null;
  /** Elevation of both ends (the page T.O.S. when the piece was built), mm. */
  elevation_mm: number | null;
  build_state: BuiltPiece['build_state'];
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  scale_ratio: number | null;
  evidence: unknown;
  build_run_id: string | null;
  /** The view the piece belongs to; null = the page's first view. */
  build_view_id: string | null;
  /** Plan frame end points in mm (x right, y up), z = elevation or 0. */
  start: [number, number, number] | null;
  end: [number, number, number] | null;
  /** Phase 14b: the column symbol family, how it was found, the cross-check reason, the drawn
   * rotation, the symbol's real size [short, long] in and the section's [width, depth] in from
   * the catalog (the marker is drawn from the profile first). */
  symbol: string | null;
  symbol_source: string | null;
  symbol_flag: string | null;
  rotation_deg: number | null;
  /** Phase 0: the column's web direction in degrees, COUNTER-CLOCKWISE on screen from the drawing's +X
   * axis, in the DISPLAYED page frame (after the PDF's /Rotate, y down on screen), normalised to the
   * symbol's symmetry ([0, 180) W / W with cover plates / rectangular HSS, [0, 90) square HSS, null for
   * round HSS or unread). The 3D (Tekla) step reads this. rotation_deg (clockwise, web vertical at 0) is
   * (90 - orientation_deg) mod 180 whenever this is set. */
  orientation_deg: number | null;
  /** clear (read from the symbol), unsure (amber), manual (a person set it), none. */
  orientation_state: 'clear' | 'unsure' | 'manual' | 'none' | null;
  orientation_source: 'click' | 'match' | 'manual' | 'backfill' | null;
  /** Phase 0 count rule: a column is COUNTED in the BOM only on a page whose role counts columns
   * (a role with the behaviour column_plan: Foundation / column plan, Pile plan). On any other
   * page it is shown but is "Reference: counted on the column plan", unless the person ticked
   * "Count this column" (a column that starts at that level: a crane column, a post on a transfer
   * beam). `count_column` is that explicit choice (null = the page's default); `page_counts_columns`
   * is the default; `reference` is the result (a column that is not counted). */
  count_column: boolean | null;
  page_counts_columns: boolean;
  reference: boolean;
  symbol_real_in: [number, number] | null;
  section_in: [number, number] | null;
  /** Phase 0 perimeter angle: the parent beam (null: not an angle), its tag, the typed real length
   * (null = follows the whole beam), the start offset from the beam's start, and the optional 3D
   * hints. The ends, length, deleted and ignored of an angle are those of its parent. */
  parent_member_id: string | null;
  parent_tag: string | null;
  angle_length_mm: number | null;
  angle_start_offset_mm: number | null;
  slab_edge_side: 'left' | 'right' | null;
  vertical_leg: 'long' | 'short' | null;
  /** Review 3 item 4 (columns only): a person's height for this column, its optional top and base
   * elevations (all mm, null = not given), and the resulting height with its source: top - base
   * ('schedule') wins over the column's own height ('column'), which wins over the project's
   * default ('project'); null / null when none is set. Never invented. */
  column_height_mm: number | null;
  column_top_mm: number | null;
  column_base_mm: number | null;
  height_mm: number | null;
  height_source: 'schedule' | 'column' | 'project' | null;
}

/** The height of a column and where it came from: top - base (both set, top above base), else the
 * column's own height, else the project default, else none. */
export function columnHeight(
  topMm: number | null,
  baseMm: number | null,
  ownMm: number | null,
  defaultMm: number | null,
): { height_mm: number | null; height_source: PieceView['height_source'] } {
  if (topMm !== null && baseMm !== null && topMm - baseMm > 0)
    return { height_mm: Math.round((topMm - baseMm) * 10) / 10, height_source: 'schedule' };
  if (ownMm !== null && ownMm > 0) return { height_mm: ownMm, height_source: 'column' };
  if (defaultMm !== null && defaultMm > 0)
    return { height_mm: defaultMm, height_source: 'project' };
  return { height_mm: null, height_source: null };
}

/** [width, depth] in inches of a column section from its catalog properties (W/HP/S/M: bf x d;
 * rectangular HSS: B x Ht; round HSS / PIPE: OD x OD; C / MC: bf x d), or null. */
export function sectionInches(
  family: string | null,
  props: Record<string, unknown> | null,
): [number, number] | null {
  if (!props) return null;
  const n = (k: string) => {
    const v = Number(props[k]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  if (n('OD') !== null) return [n('OD')!, n('OD')!];
  if (family === 'HSS' && n('B') !== null && n('Ht') !== null) return [n('B')!, n('Ht')!];
  if (n('bf') !== null && n('d') !== null) return [n('bf')!, n('d')!];
  return null;
}

/**
 * Colour state of a built piece after a person's edits: a size a person gave makes an undefined
 * piece sized ('person'); the support part is the build's (worker/src/build/pieces.py rules).
 */
export function effectiveState(
  sizeState: string | null,
  supportState: string | null,
  profile: string | null,
): { size_state: string | null; build_state: BuiltPiece['build_state'] } {
  const size = profile && sizeState === 'undefined' ? 'person' : sizeState;
  if (size === 'undefined' || supportState === 'none')
    return { size_state: size, build_state: 'attention' };
  if (size === 'inferred' || supportState === 'one')
    return { size_state: size, build_state: 'needs_review' };
  return { size_state: size, build_state: 'found' };
}

/** Plan frame point in mm of a displayed page point (x right, y up), as the worker writes it. */
export function planMm(p: PagePt, ratio: number): [number, number] {
  const k = MM_PER_PT * ratio;
  return [p[0] * k, -p[1] * k];
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

function isPt(v: unknown): v is PagePt {
  return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && isFinite(x));
}

/** The latest value of each line-first field from a member's edits (oldest first). */
export function lineFirstEdits(
  rows: readonly { field_name: string; corrected_value: unknown }[],
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const r of rows)
    if (
      [
        'studs',
        'camber_raw',
        'ignored',
        'approved',
        'page_ends',
        'orientation',
        'column_count',
        'column_height',
        'column_top',
        'column_base',
        'angle_length',
        'angle_offset',
        'slab_edge_side',
        'vertical_leg',
      ].includes(r.field_name)
    )
      out.set(r.field_name, r.corrected_value);
  return out;
}

export async function loadPieces(
  db: Kysely<Database>,
  projectId: string,
  filter: { sheetId?: string; memberIds?: string[] } = {},
): Promise<PieceView[]> {
  let q = db
    .selectFrom('members')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('build_run_id', 'is not', null);
  if (filter.sheetId) q = q.where('sheet_id', '=', filter.sheetId);
  if (filter.memberIds) {
    if (filter.memberIds.length === 0) return [];
    q = q.where('id', 'in', filter.memberIds);
  }
  let rows = await q.orderBy('member_id').execute();
  if (rows.length === 0) return [];
  // Phase 0 perimeter angle: an angle's ends come from its parent, which may not be in the filter
  const have = new Set(rows.map((r) => r.id));
  const parentIds = [
    ...new Set(
      rows
        .map((r) => r.parent_member_id)
        .filter((id): id is string => id !== null && !have.has(id)),
    ),
  ];
  const extra = new Set<string>();
  if (parentIds.length) {
    const more = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', 'in', parentIds)
      .execute();
    for (const m of more) extra.add(m.id);
    rows = [...rows, ...more];
  }
  const ids = rows.map((r) => r.id);
  // Review 3 item 4: the project's default column height (mm), null when not set
  const projectDefaultMm = num(
    (
      await db
        .selectFrom('projects')
        .select('default_column_height_mm')
        .where('id', '=', projectId)
        .executeTakeFirst()
    )?.default_column_height_mm,
  );
  const views = new Map(
    (await loadMemberViews(db, projectId, { memberIds: ids })).map((v) => [v.id, v]),
  );
  const edits = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'corrected_value'])
    .where('member_id', 'in', ids)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const editsOf = new Map<string, { field_name: string; corrected_value: unknown }[]>();
  for (const e of edits) editsOf.set(e.member_id, [...(editsOf.get(e.member_id) ?? []), e]);
  // Phase 14b: catalog sections of the column profiles (2C / 2MC: twice the channel's width)
  const colProfiles = [
    ...new Set(
      rows
        .filter((r) => r.type === 'column')
        .map((r) => views.get(r.id)?.profile ?? r.profile)
        .filter((p): p is string => !!p)
        .map((p) => p.toUpperCase().replace(/^2(?=M?C)/, '')),
    ),
  ];
  const catalog = new Map(
    colProfiles.length
      ? (
          await db
            .selectFrom('catalog_shapes')
            .select(['shape_name', 'family', 'properties'])
            .where('shape_name', 'in', colProfiles)
            .execute()
        ).map((c) => [c.shape_name.toUpperCase(), c])
      : [],
  );
  const sectionOf = (profile: string | null): [number, number] | null => {
    if (!profile) return null;
    const up = profile.toUpperCase();
    const two = /^2M?C/.test(up);
    const c = catalog.get(two ? up.slice(1) : up);
    const dims = c ? sectionInches(c.family, c.properties as Record<string, unknown>) : null;
    return dims && two ? [dims[0] * 2, dims[1]] : dims;
  };
  // Phase 0 count rule: the behaviour of the role of each piece's view (null view = the first view)
  const sheetIds = [...new Set(rows.map((r) => r.sheet_id).filter((x): x is string => !!x))];
  const viewRows = sheetIds.length
    ? await db
        .selectFrom('build_views')
        .select(['id', 'sheet_id', 'position', 'role_name'])
        .where('sheet_id', 'in', sheetIds)
        .execute()
    : [];
  const behaviours = new Map(
    (await db.selectFrom('role_names').select(['name', 'behaviour']).execute()).map((b) => [
      b.name,
      b.behaviour,
    ]),
  );
  const pageCounts = (sheetId: string | null, viewId: string | null): boolean => {
    const mine = viewRows.filter((v) => v.sheet_id === sheetId);
    const view = viewId
      ? mine.find((v) => v.id === viewId)
      : [...mine].sort((a, b) => Number(a.position) - Number(b.position))[0];
    // no view or role: an old project keeps counting its columns as it always did
    if (!view || !view.role_name) return true;
    return behaviours.get(view.role_name) === 'column_plan';
  };
  const out: PieceView[] = [];
  for (const r of rows) {
    const v = views.get(r.id);
    if (!v) continue;
    const own = editsOf.get(r.id) ?? [];
    const lf = lineFirstEdits(own);
    const ratio = num(r.plan_scale_ratio);
    const elevation = num(r.start_elevation_mm);
    const z = elevation ?? 0;
    const stored: [PagePt | null, PagePt | null] = [
      r.page_x0 === null ? null : [Number(r.page_x0), Number(r.page_y0)],
      r.page_x1 === null ? null : [Number(r.page_x1), Number(r.page_y1)],
    ];
    const moved = lf.get('page_ends') as { a?: unknown; b?: unknown } | null | undefined;
    const endsMoved = !!moved && isPt(moved.a);
    const a = endsMoved ? (moved.a as PagePt) : stored[0];
    const b = endsMoved ? (isPt(moved.b) ? moved.b : null) : stored[1];
    let start: [number, number, number] | null = null;
    let end: [number, number, number] | null = null;
    if (endsMoved && ratio !== null && a) {
      const pa = planMm(a, ratio);
      const pb = b ? planMm(b, ratio) : pa;
      start = [pa[0], pa[1], z];
      end = [pb[0], pb[1], z];
    } else {
      const sx = num(r.start_x_mm);
      const sy = num(r.start_y_mm);
      const ex = num(r.end_x_mm);
      const ey = num(r.end_y_mm);
      if (sx !== null && sy !== null) start = [sx, sy, num(r.start_z_mm) ?? z];
      if (ex !== null && ey !== null) end = [ex, ey, num(r.end_z_mm) ?? z];
    }
    const length =
      v.type !== 'column' && start && end
        ? Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
        : null;
    // Phase 0 count rule: the page's default, and the person's tick (an undoable edit)
    const pageCounts0 = pageCounts(r.sheet_id, r.build_view_id);
    const tick = lf.get('column_count');
    const countColumn = typeof tick === 'boolean' ? tick : null;
    // Phase 0: a person's edit (field 'orientation') overrides the stored reading
    // (an undo restores the earlier value, which carries its own state and source)
    const oriEdit = lf.get('orientation') as
      { deg?: number | null; state?: string; source?: string } | null | undefined;
    const effOri: {
      deg: number | null;
      state: PieceView['orientation_state'];
      source: PieceView['orientation_source'];
    } = oriEdit
      ? {
          deg: typeof oriEdit.deg === 'number' ? oriEdit.deg : null,
          state: (oriEdit.state ?? 'manual') as PieceView['orientation_state'],
          source: (oriEdit.source ?? 'manual') as PieceView['orientation_source'],
        }
      : {
          deg: num(r.orientation_deg),
          state: r.orientation_state ?? null,
          source: r.orientation_source ?? null,
        };
    const studs = lf.has('studs') ? (lf.get('studs') as number | null) : r.studs;
    const camber = lf.has('camber_raw') ? (lf.get('camber_raw') as string | null) : r.camber_raw;
    out.push({
      id: r.id,
      member_id: r.member_id,
      sheet_id: r.sheet_id,
      type: v.type,
      kind: v.kind.name ?? r.kind,
      tag: v.tag.text || null,
      quantity: v.quantity,
      profile: v.profile,
      profile_raw: v.profile_raw,
      studs: studs ?? null,
      camber_raw: camber ?? null,
      ignored: lf.has('ignored') ? lf.get('ignored') === true : r.ignored,
      approved: lf.get('approved') === true,
      duplicate_of:
        typeof (r.kind_evidence as Record<string, unknown> | null)?.duplicate_of === 'string'
          ? ((r.kind_evidence as Record<string, unknown>).duplicate_of as string)
          : null,
      excluded_kind: v.counting === 'not_counted',
      deleted: v.deleted,
      added: r.added_by !== null,
      edited: own.length > 0,
      a,
      b,
      ends_moved: endsMoved,
      length_mm: length && length > 0 ? Math.round(length * 10) / 10 : null,
      elevation_mm: elevation,
      ...effectiveState(r.size_state, r.support_state, v.profile),
      support_state: r.support_state,
      piece_index: r.piece_index,
      scale_ratio: ratio,
      evidence: r.label_evidence,
      build_run_id: r.build_run_id,
      build_view_id: r.build_view_id,
      start,
      end,
      symbol: r.symbol ?? null,
      symbol_source: r.symbol_source ?? null,
      symbol_flag: r.symbol_flag ?? null,
      // the stored rotation stays authoritative; only a person's orientation edit derives it
      rotation_deg:
        oriEdit && effOri.deg !== null && v.type === 'column'
          ? markerRotation(effOri.deg)
          : num(r.rotation_deg),
      orientation_deg: effOri.deg,
      orientation_state: effOri.state,
      orientation_source: effOri.source,
      count_column: countColumn,
      page_counts_columns: pageCounts0,
      reference: v.type === 'column' && !(countColumn ?? pageCounts0),
      symbol_real_in: (r.symbol_real_in as [number, number] | null) ?? null,
      section_in: v.type === 'column' ? sectionOf(v.profile) : null,
      parent_member_id: r.parent_member_id ?? null,
      parent_tag: null,
      angle_length_mm: lf.has('angle_length')
        ? (lf.get('angle_length') as number | null)
        : num(r.angle_length_mm),
      angle_start_offset_mm: lf.has('angle_offset')
        ? (lf.get('angle_offset') as number | null)
        : num(r.angle_start_offset_mm),
      slab_edge_side: (lf.has('slab_edge_side')
        ? lf.get('slab_edge_side')
        : (r.slab_edge_side ?? null)) as 'left' | 'right' | null,
      vertical_leg: (lf.has('vertical_leg') ? lf.get('vertical_leg') : (r.vertical_leg ?? null)) as
        'long' | 'short' | null,
      column_height_mm: v.type === 'column' ? num(lf.get('column_height') as number | null) : null,
      column_top_mm: v.type === 'column' ? num(lf.get('column_top') as number | null) : null,
      column_base_mm: v.type === 'column' ? num(lf.get('column_base') as number | null) : null,
      ...(v.type === 'column'
        ? columnHeight(
            num(lf.get('column_top') as number | null),
            num(lf.get('column_base') as number | null),
            num(lf.get('column_height') as number | null),
            // the project's default is a floor height: it never applies to piles (their own length)
            r.kind === 'Piles' ? null : projectDefaultMm,
          )
        : { height_mm: null, height_source: null }),
    });
  }
  // a perimeter angle sits on its parent: ends, length, deleted / ignored / excluded follow it
  const byId = new Map(out.map((p) => [p.id, p]));
  for (const p of out) {
    const parent = p.parent_member_id ? byId.get(p.parent_member_id) : undefined;
    if (!parent) continue;
    const d = deriveAngle(parent, p.angle_start_offset_mm, p.angle_length_mm);
    p.a = d.a;
    p.b = d.b;
    p.start = d.start;
    p.end = d.end;
    p.length_mm = d.length_mm;
    p.ends_moved = false;
    p.elevation_mm = parent.elevation_mm;
    p.scale_ratio = parent.scale_ratio;
    p.parent_tag = parent.tag;
    p.deleted = p.deleted || parent.deleted;
    p.ignored = p.ignored || parent.ignored;
    p.excluded_kind = p.excluded_kind || parent.excluded_kind;
    p.duplicate_of = p.duplicate_of ?? parent.duplicate_of;
    p.reference = p.reference || parent.reference; // never counted when its beam is a Reference
  }
  return out.filter((p) => !extra.has(p.id));
}

/** Pieces that count: not deleted, not ignored. */
export function counted(p: PieceView): boolean {
  return !p.deleted && !p.ignored;
}

/** The BOM's input for a piece (lineFirstBom). */
export function toBuiltPiece(p: PieceView): BuiltPiece {
  return {
    id: p.id,
    member_id: p.member_id,
    sheet_id: p.sheet_id,
    type: p.type,
    kind: p.kind,
    tag: p.tag,
    quantity: p.quantity,
    profile: p.profile,
    profile_raw: p.profile_raw,
    start: p.type === 'column' ? null : p.start,
    end: p.type === 'column' ? null : p.end,
    build_state: p.build_state,
    size_state: p.size_state,
    support_state: p.support_state,
    piece_index: p.piece_index,
    approved: p.approved,
    duplicate_of: p.duplicate_of,
    excluded_kind: p.excluded_kind,
    reference: p.reference,
    parent_member_id: p.parent_member_id,
    height_mm: p.type === 'column' ? p.height_mm : undefined,
    height_source: p.type === 'column' ? p.height_source : undefined,
  };
}
