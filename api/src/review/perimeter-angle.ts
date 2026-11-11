// Phase 0 perimeter angle (edge angle / pour stop / deck support angle): an L-section a person adds
// on the top flange of a beam along the edge of a slab or deck. NOT detected; added by hand.
//
// An angle is a member row of its own (a piece: tag, BOM line, delete / undo like any other) with
// parent_member_id = the beam. Its ends are DERIVED from the parent's current ends (migration 032):
//   offset  angle_start_offset_mm  real distance from the beam's start (default 0)
//   length  angle_length_mm        a typed REAL length; null = follows the beam: to its end
// so the angle follows a moved or edited beam, a typed length stays that real length (capped at the
// beam, never a fraction), and a deleted / ignored parent takes its angles with it (read time, so
// one Undo of the beam's delete brings them back).
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/types.js';
import { defaultCatalogEdition, defaultCatalogLookup } from '../catalog/lookup.js';
import { HttpError } from '../routes/http-error.js';

/** The scope kind of the BOM line: the estimators' own name (the project may override it). */
export const DEFAULT_ANGLE_KIND = 'Deck edge Angle / Bent plate';

/** Shown first in the picker (the estimators' common ones). */
export const COMMON_ANGLES = ['L4X4X1/4', 'L4X4X5/16', 'L6X4X3/8', 'L6X6X3/8'] as const;

/** The grade of angles and bent plates unless the project sets another (confirmed by the
 * estimator; the grade list stays open: a project may type any other grade). */
export const ANGLE_GRADE = 'A36';

/** Bent plate (drawings: PL / BP): a custom-made angle used when no standard L fits. */
export const BENT_PLATE_PREFIX = 'BENT PL';
const BENT_PLATE_COEFF = 3.4; // lb/ft = 3.4 x t x (leg1 + leg2 - t), inches (the estimator's formula)
const KG_PER_LB = 0.45359237;
const M_PER_FT = 0.3048;

export type Pt = [number, number];
export type Pt3 = [number, number, number];

export interface Parent {
  a: Pt | null;
  b: Pt | null;
  start: Pt3 | null;
  end: Pt3 | null;
}

export interface Derived {
  a: Pt | null;
  b: Pt | null;
  start: Pt3 | null;
  end: Pt3 | null;
  length_mm: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const lerp = (p: readonly number[], q: readonly number[], t: number): number[] =>
  p.map((v, i) => v + (q[i]! - v) * t);

/** The 3D length of a parent's stored ends (null when it has none or they coincide). */
export function parentLengthMm(p: Parent): number | null {
  if (!p.start || !p.end) return null;
  const d = Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1], p.end[2] - p.start[2]);
  return d > 0 ? d : null;
}

/** The angle's ends and length on its parent: from `offsetMm` (default 0, kept inside the beam)
 * for `lengthMm` real mm (null = to the end of the beam; a typed length is capped at the beam). */
export function deriveAngle(
  parent: Parent,
  offsetMm: number | null,
  lengthMm: number | null,
): Derived {
  const total = parentLengthMm(parent);
  if (total === null || !parent.start || !parent.end) {
    return { a: parent.a, b: parent.b, start: parent.start, end: parent.end, length_mm: null };
  }
  const off = Math.min(Math.max(offsetMm ?? 0, 0), total);
  const len = Math.min(lengthMm ?? total - off, total - off);
  const t0 = off / total;
  const t1 = (off + len) / total;
  const at = <T extends readonly number[]>(p: T | null, q: T | null, t: number) =>
    p && q ? (lerp(p, q, t) as unknown as T) : null;
  const a = parent.a && parent.b ? (lerp(parent.a, parent.b, t0) as Pt) : parent.a;
  const b = parent.a && parent.b ? (lerp(parent.a, parent.b, t1) as Pt) : parent.b;
  return {
    a,
    b,
    start: at(parent.start, parent.end, t0),
    end: at(parent.start, parent.end, t1),
    length_mm: len > 0 ? r1(len) : null,
  };
}

/** `4`, `1/4`, `1-1/4` as a number of inches, or null. */
export function inchesOf(t: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+)\/(\d+)|(\d+(?:\.\d+)?))$/.exec(t.trim());
  if (!m) return null;
  if (m[4] !== undefined) return Number(m[4]) + (m[1] ? Number(m[1]) : 0);
  const d = Number(m[3]);
  return d === 0 ? null : (m[1] ? Number(m[1]) : 0) + Number(m[2]) / d;
}

/** `L6X4X3/8` -> long leg 6, short leg 4, thickness 0.375 (inches), or null. */
export function angleSize(
  name: string,
): { long_in: number; short_in: number; thickness_in: number } | null {
  const m = /^L(.+?)X(.+?)X(.+)$/i.exec(name.replace(/\s+/g, ''));
  if (!m) return null;
  const [l, s, t] = [inchesOf(m[1]!), inchesOf(m[2]!), inchesOf(m[3]!)];
  return l === null || s === null || t === null
    ? null
    : { long_in: Math.max(l, s), short_in: Math.min(l, s), thickness_in: t };
}

export interface AngleOption {
  name: string;
  long_in: number;
  short_in: number;
  thickness_in: number;
  lb_per_ft: number | null;
  kg_per_m: number;
  common: boolean;
}

/** The L shapes of the default catalog edition (AISC), the common ones first. */
export async function listAngles(
  db: Kysely<Database>,
): Promise<{ edition: string | null; angles: AngleOption[] }> {
  const edition = await defaultCatalogEdition(db);
  if (edition === null) return { edition: null, angles: [] };
  const rows = await db
    .selectFrom('catalog_shapes')
    .select(['shape_name', 'weight_lb_per_ft', 'weight_kg_per_m'])
    .where('edition', '=', edition)
    .where('family', '=', 'L')
    .where(sql<boolean>`weight_kg_per_m > 0`)
    .execute();
  const angles = rows
    .map((r): AngleOption | null => {
      const s = angleSize(r.shape_name);
      if (!s) return null;
      return {
        name: r.shape_name,
        ...s,
        lb_per_ft: r.weight_lb_per_ft === null ? null : Number(r.weight_lb_per_ft),
        kg_per_m: Number(r.weight_kg_per_m),
        common: (COMMON_ANGLES as readonly string[]).includes(r.shape_name.toUpperCase()),
      };
    })
    .filter((a): a is AngleOption => a !== null);
  const rank = (a: AngleOption) =>
    a.common ? (COMMON_ANGLES as readonly string[]).indexOf(a.name.toUpperCase()) : 99;
  return {
    edition,
    angles: angles.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.long_in - a.long_in ||
        b.short_in - a.short_in ||
        a.thickness_in - b.thickness_in,
    ),
  };
}

/** The catalog name of an L profile with a weight above zero; a 400 for anything else (an angle
 * is only valid when it resolves in the AISC catalog, SPEC section 5). */
export async function resolveAngleProfile(db: Kysely<Database>, text: string): Promise<string> {
  const lookup = await defaultCatalogLookup(db);
  const hit = lookup?.find(text);
  if (!hit || !hit.found || hit.shape.family !== 'L' || !(hit.shape.weight_kg_per_m > 0))
    throw new HttpError(400, {
      error: `"${text}" is not an L shape of the AISC catalog (like L4X4X1/4 or L6X4X3/8)`,
      code: 'not_an_angle',
    });
  return hit.shape.shape_name;
}

/** The scope kind name the project's perimeter angles use. */
export function angleKindOf(project: { perimeter_angle_kind: string | null }): string {
  return project.perimeter_angle_kind?.trim() || DEFAULT_ANGLE_KIND;
}

/** A number of inches as the estimators write it: `3/8`, `6`, `1-1/2` (a decimal when no 1/64 fits). */
export function formatInches(v: number): string {
  for (const den of [1, 2, 4, 8, 16, 32, 64]) {
    const n = v * den;
    if (Math.abs(n - Math.round(n)) < 1e-6) {
      const whole = Math.floor(Math.round(n) / den);
      const num = Math.round(n) - whole * den;
      if (num === 0) return String(whole);
      let [x, y] = [num, den];
      while (x % 2 === 0 && y % 2 === 0) [x, y] = [x / 2, y / 2];
      return whole > 0 ? `${whole}-${x}/${y}` : `${x}/${y}`;
    }
  }
  return String(Math.round(v * 1000) / 1000);
}

export interface BentPlate {
  thickness_in: number;
  leg1_in: number;
  leg2_in: number;
}

/** `BENT PL 3/8 x 6 x 4` (thickness x leg 1 x leg 2). */
export function bentPlateName(b: BentPlate): string {
  return `${BENT_PLATE_PREFIX} ${formatInches(b.thickness_in)} x ${formatInches(b.leg1_in)} x ${formatInches(b.leg2_in)}`;
}

/** Thickness above 0, both legs longer than the thickness, nothing above 48 in. */
export function bentPlateValid(b: BentPlate): boolean {
  return (
    b.thickness_in > 0 &&
    b.leg1_in > b.thickness_in &&
    b.leg2_in > b.thickness_in &&
    b.leg1_in <= 48 &&
    b.leg2_in <= 48
  );
}

const BENT_RE = /^BENT\s*(?:PL|BP)\b/i;

/** The sizes of a bent plate name, or null (not a bent plate, or sizes that cannot be made). */
export function parseBentPlate(name: string | null | undefined): BentPlate | null {
  if (!name) return null;
  const m = /^BENT\s*(?:PL|BP)\s+(\S+)\s*[xX]\s*(\S+)\s*[xX]\s*(\S+)$/i.exec(name.trim());
  if (!m) return null;
  const [t, l1, l2] = [inchesOf(m[1]!), inchesOf(m[2]!), inchesOf(m[3]!)];
  if (t === null || l1 === null || l2 === null) return null;
  const b = { thickness_in: t, leg1_in: l1, leg2_in: l2 };
  return bentPlateValid(b) ? b : null;
}

/** lb per ft of a bent plate: 3.4 x t x (leg1 + leg2 - t). */
export function bentPlateLbPerFt(b: BentPlate): number {
  return BENT_PLATE_COEFF * b.thickness_in * (b.leg1_in + b.leg2_in - b.thickness_in);
}

/** kg per m of a bent plate (from the lb/ft formula). */
export function bentPlateKgPerM(b: BentPlate): number {
  return (bentPlateLbPerFt(b) * KG_PER_LB) / M_PER_FT;
}

/** The profile text of an angle or a bent plate: a catalog L shape (400 `not_an_angle` unless it
 * resolves with a weight) or a bent plate made from `bent` / typed as `BENT PL t x l1 x l2`
 * (400 `bad_bent_plate` when the sizes cannot be made). */
export async function resolvePerimeterProfile(
  db: Kysely<Database>,
  input: { profile_text?: string; bent?: BentPlate },
): Promise<{ profile: string; sub_type: 'angle' | 'bent_plate' }> {
  const typed = input.profile_text?.trim() ?? '';
  if (input.bent || BENT_RE.test(typed)) {
    const b = input.bent ?? parseBentPlate(typed);
    if (!b || !bentPlateValid(b))
      throw new HttpError(400, {
        error:
          'a bent plate needs a thickness and two legs in inches (like 3/8, 6, 4), each leg longer than the thickness and not above 48',
        code: 'bad_bent_plate',
      });
    return { profile: bentPlateName(b), sub_type: 'bent_plate' };
  }
  return { profile: await resolveAngleProfile(db, typed), sub_type: 'angle' };
}

/** The grade of a project's angles and bent plates: its own setting, else A36. */
export function angleGradeOf(project: { perimeter_angle_grade: string | null }): string {
  return project.perimeter_angle_grade?.trim() || ANGLE_GRADE;
}
