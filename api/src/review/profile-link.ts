// Phase 0 profile from callout: which size label belongs to a column, in the API (Find similar
// matches, hand-placed columns, the profile search's "Mark all"). The same rules and numbers as
// worker/src/build/profile_labels.py; fixtures/synthetic/profile-link-cases.json keeps them equal.
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;
export type Pt = [number, number];
export type Box = [number, number, number, number];

export const COLUMN_LABEL_MAX_PT = 60;
export const LEADER_COLUMN_PT = 8;
export const TIE_PT = 0.5;
export const HIGH_RIVAL_RATIO = 1.6;
export const MEDIUM_RIVAL_RATIO = 1.25;
export const HIGH_DISTANCE_PT = 36;
export const COLUMN_FAMILIES = ['W', 'HSS', 'HP', 'PIPE', 'S', 'M'];

export interface LabelRow {
  id: string | null;
  canonical: string | null;
  raw: string;
  family: string | null;
  kind: 'profile' | 'joist';
  valid: boolean;
  flags: string[];
  box: Box;
  leaders: Pt[];
}

export interface Link {
  label: LabelRow | null;
  method: 'leader' | 'beside' | 'typical' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reason: string;
  competitor: string | null;
}

const centre = (l: LabelRow): Pt => [(l.box[0] + l.box[2]) / 2, (l.box[1] + l.box[3]) / 2];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const isTyp = (l: LabelRow) => l.flags.includes('typical');
export const isColumnLabel = (l: LabelRow) =>
  l.kind === 'profile' && l.family !== null && COLUMN_FAMILIES.includes(l.family);

function boxDist(p: Pt, b: Box): number {
  const dx = Math.max(b[0] - p[0], 0, p[0] - b[2]);
  const dy = Math.max(b[1] - p[1], 0, p[1] - b[3]);
  return Math.hypot(dx, dy);
}

const none = (reason: string): Link => ({
  label: null,
  method: null,
  confidence: null,
  reason,
  competitor: null,
});

/** A leader that ends at the column wins; else the nearest column label within 60 pt. */
export function linkPoint(point: Pt, box: Box | null, labels: LabelRow[]): Link {
  const cols = labels.filter(isColumnLabel);
  const bx: Box = box ?? [point[0], point[1], point[0], point[1]];
  const hit = cols
    .map((l) => ({ l, d: Math.min(...l.leaders.map((e) => boxDist(e, bx)), Infinity) }))
    .filter((h) => h.d <= LEADER_COLUMN_PT)
    .sort(
      (a, b) => a.d - b.d || centre(a.l)[0] - centre(b.l)[0] || centre(a.l)[1] - centre(b.l)[1],
    );
  if (hit.length) {
    const best = hit[0]!.l;
    const rivals = [
      ...new Set(hit.map((h) => h.l.canonical).filter((c) => c !== best.canonical)),
    ].sort();
    return {
      label: best,
      method: 'leader',
      confidence: rivals.length ? 'medium' : 'high',
      reason: 'a leader line runs from the label to the column',
      competitor: rivals[0] ?? null,
    };
  }
  const near = cols
    .map((l, i) => ({ d: dist(centre(l), point), i }))
    .filter((n) => n.d <= COLUMN_LABEL_MAX_PT)
    .sort((a, b) => a.d - b.d || a.i - b.i);
  if (!near.length) return none('no label near the column');
  const best = cols[near[0]!.i]!;
  const d1 = near[0]!.d;
  const rival = near.slice(1).find((n) => cols[n.i]!.canonical !== best.canonical);
  if (!rival) {
    return {
      label: best,
      method: 'beside',
      confidence: d1 <= HIGH_DISTANCE_PT ? 'high' : 'medium',
      reason: `nearest label, ${d1.toFixed(0)} pt away, no other profile close`,
      competitor: null,
    };
  }
  const ratio = rival.d / Math.max(d1, 0.01);
  const confidence =
    ratio >= HIGH_RIVAL_RATIO && d1 <= HIGH_DISTANCE_PT
      ? 'high'
      : ratio >= MEDIUM_RIVAL_RATIO
        ? 'medium'
        : 'low';
  const other = cols[rival.i]!;
  return {
    label: best,
    method: 'beside',
    confidence,
    reason: `nearest label, ${d1.toFixed(0)} pt away; ${other.canonical} is ${rival.d.toFixed(0)} pt away`,
    competitor: other.canonical,
  };
}

/** The TYP label for a member with no label of its own (scope: the view's labels, the same family
 * group, the nearest wins, an exact tie between different profiles leaves it unset). */
export function typicalFor(
  point: Pt,
  labels: LabelRow[],
  group: 'column' | 'beam' = 'column',
): Link {
  const typ = labels.filter(
    (l) =>
      isTyp(l) &&
      l.kind === 'profile' &&
      (l.family !== null && COLUMN_FAMILIES.includes(l.family)) === (group === 'column'),
  );
  if (!typ.length) return none('no TYP label in the view');
  const ranked = typ.map((l, i) => ({ d: dist(centre(l), point), i })).sort((a, b) => a.d - b.d);
  const best = typ[ranked[0]!.i]!;
  const d1 = ranked[0]!.d;
  const tied = ranked
    .slice(1)
    .find((r) => r.d - d1 <= TIE_PT && typ[r.i]!.canonical !== best.canonical);
  if (tied) return none(`two TYP labels tie (${best.canonical}, ${typ[tied.i]!.canonical})`);
  const others = [
    ...new Set(typ.map((l) => l.canonical).filter((c) => c !== best.canonical)),
  ].sort();
  return {
    label: best,
    method: 'typical',
    confidence: 'medium',
    reason:
      'the nearest TYP label of the view' +
      (typ.length > 1
        ? ` (${typ.length} TYP labels, ${others.length} other profile${others.length === 1 ? '' : 's'})`
        : ''),
    competitor: others[0] ?? null,
  };
}

/** The labels of one view of a sheet (the first view also has rows keyed by its own id). */
export async function loadLabels(
  db: Db,
  sheetId: string,
  viewId: string | null,
): Promise<LabelRow[]> {
  let q = db.selectFrom('page_labels').selectAll().where('sheet_id', '=', sheetId);
  if (viewId) q = q.where('view_id', '=', viewId);
  return (await q.execute()).map((r) => ({
    id: r.id,
    canonical: r.canonical,
    raw: r.raw,
    family: r.family,
    kind: r.kind,
    valid: r.valid,
    flags: r.flags,
    box: [Number(r.x0), Number(r.y0), Number(r.x1), Number(r.y1)],
    leaders: (r.leaders as Pt[]) ?? [],
  }));
}

export interface Resolved {
  profile: string | null;
  profile_raw: string | null;
  source: 'label' | 'typical' | 'example' | null;
  label_id: string | null;
  link: Record<string, unknown> | null;
}

/** The profile of a column at `point`: its own label (green), else a TYP label (amber), else the
 * example's profile (amber). A label that is not in the AISC catalog is never used silently: the
 * example's profile stays and the link says why. Without any labels nothing changes: the example
 * (or nothing, as before). */
export function resolveProfile(
  point: Pt,
  labels: LabelRow[],
  example: { profile: string | null; raw: string | null },
  scope = process.env.PROFILE_TYP_SCOPE ?? 'view_family',
): Resolved {
  const fallback = (note?: Record<string, unknown>): Resolved =>
    example.profile
      ? {
          profile: example.profile,
          profile_raw: example.raw ?? example.profile,
          source: 'example',
          label_id: null,
          link: { reason: "no label for this column: the example's profile", ...note },
        }
      : {
          profile: null,
          profile_raw: null,
          source: null,
          label_id: null,
          link: note ? { reason: 'no usable label', ...note } : null,
        };
  let got = linkPoint(point, null, labels);
  if (!got.label && scope === 'view_family') got = typicalFor(point, labels, 'column');
  if (!got.label) return fallback();
  const lb = got.label;
  const info = {
    method: got.method,
    confidence: got.confidence,
    reason: got.reason,
    competitor: got.competitor,
    existing: lb.flags.includes('existing'),
    valid: lb.valid,
  };
  if (!lb.valid)
    return fallback({ ...info, note: `label ${lb.raw} is not in the AISC catalog: not used` });
  const note =
    example.profile && example.profile !== lb.canonical
      ? { note: `label ${lb.canonical}, example ${example.profile}` }
      : {};
  return {
    profile: lb.canonical,
    profile_raw: lb.raw,
    source: got.method === 'typical' ? 'typical' : 'label',
    label_id: lb.id,
    link: { ...info, ...note },
  };
}
