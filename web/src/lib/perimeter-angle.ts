// Phase 0 perimeter angle (manual, never detected): an L-section on the top flange of a perimeter
// beam. The types of the API (api/src/routes/perimeter-angle.ts) and the small pure logic of the
// panel. An angle is a piece of its own whose parent_member_id is its beam; its ends and length
// come from the beam on the server.
import { parseFtIn } from "./ftin";
import { type Piece } from "./lf";

export interface AngleOption {
  name: string;
  long_in: number;
  short_in: number;
  thickness_in: number;
  lb_per_ft: number | null;
  kg_per_m: number;
  common: boolean;
}

export interface AngleOptions {
  edition: string | null;
  angles: AngleOption[];
  last_profile: string | null;
  /** The scope kind of the BOM line (the estimators' name; the project may rename it). */
  kind: string;
  /** The grade of angles and bent plates: the project's own, else the confirmed default A36. */
  grade: string;
  grade_is_default: boolean;
}

/** A bent plate (a custom-made angle, drawings: PL / BP); sizes in inches. */
export interface Bent {
  thickness_in: number;
  leg1_in: number;
  leg2_in: number;
}

/** What the "Add perimeter angle" form sends: only what the person gave. */
export interface AngleForm {
  /** An AISC L shape... */
  profile_text?: string;
  /** ...or a bent plate (one of the two). */
  bent?: Bent;
  /** Real length in mm; absent = follows the whole beam. */
  length_mm?: number;
  start_offset_mm?: number;
  slab_edge_side?: "left" | "right";
  vertical_leg?: "long" | "short";
}

export interface AnglePatch {
  profile_text?: string;
  bent?: Bent;
  length_mm?: number | null;
  start_offset_mm?: number | null;
  slab_edge_side?: "left" | "right" | null;
  vertical_leg?: "long" | "short" | null;
}

export const isAngle = (p: Piece): boolean => !!p.parent_member_id;

/** The angles on a beam (not deleted), in tag order. */
export function anglesOf(pieces: readonly Piece[], beamId: string): Piece[] {
  return pieces
    .filter((p) => p.parent_member_id === beamId && !p.deleted)
    .sort((a, b) =>
      (a.tag ?? "").localeCompare(b.tag ?? "", undefined, { numeric: true }),
    );
}

/** The action is for beams: at least one piece, every one a beam with two ends that is not an
 * angle, not a column and not deleted. */
export function canAddAngle(selected: readonly Piece[]): boolean {
  return (
    selected.length > 0 &&
    selected.every(
      (p) =>
        !p.deleted &&
        p.type !== "column" &&
        !p.parent_member_id &&
        p.a !== null &&
        p.b !== null,
    )
  );
}

/** A typed length: empty = null (follows the whole beam); feet-inches (13'-3 1/2") or millimetres
 * with "mm"; anything else is undefined (refused, nothing sent). */
export function parseAngleLength(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const mm = /^(\d+(?:\.\d+)?)\s*mm$/i.exec(t);
  if (mm) return Number(mm[1]) > 0 ? Number(mm[1]) : undefined;
  const v = parseFtIn(t);
  return v !== null && v > 0 ? v : undefined;
}

/** "L4X4X1/4 · 6.6 lb/ft" */
export function angleLabel(o: AngleOption): string {
  return o.lb_per_ft === null ? o.name : `${o.name} · ${o.lb_per_ft} lb/ft`;
}

/** The picker order: the common ones first (as the server sent them), then the rest. */
export function angleGroups(angles: readonly AngleOption[]): {
  common: AngleOption[];
  rest: AngleOption[];
} {
  return {
    common: angles.filter((a) => a.common),
    rest: angles.filter((a) => !a.common),
  };
}

/** The profile the picker starts on: the project's last one when it is in the list, else the first. */
export function startProfile(o: AngleOptions): string {
  return o.angles.some((a) => a.name === o.last_profile)
    ? (o.last_profile as string)
    : (o.angles[0]?.name ?? "");
}

/** Page points the angle's drawn line sits off its beam (screen pixels), to the slab-edge side. */
export const ANGLE_OFFSET_PX = 4;

/** The unit normal (page frame, y down) on the left / right of the direction a -> b. */
export function sideNormal(
  a: readonly number[],
  b: readonly number[],
  side: "left" | "right" | null,
): [number, number] {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const len = Math.hypot(dx, dy) || 1;
  // y points down on the page: the left of a direction (dx, dy) is (dy, -dx)
  const left: [number, number] = [dy / len, -dx / len];
  return side === "right" ? [-left[0], -left[1]] : left;
}

/** `3/8`, `6`, `1-1/2`, `1 1/2`, `0.375` as inches; null for anything else or not above 0. */
export function parseInches(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "-");
  const m = /^(?:(\d+)-)?(?:(\d+)\/(\d+)|(\d+(?:\.\d+)?))$/.exec(t);
  if (!m) return null;
  let v: number;
  if (m[4] !== undefined) v = Number(m[4]) + (m[1] ? Number(m[1]) : 0);
  else {
    const d = Number(m[3]);
    if (d === 0) return null;
    v = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / d;
  }
  return v > 0 ? v : null;
}

/** Inches as the estimators write them (3/8, 6, 1-1/2), a decimal when no 1/64 fits. */
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

/** The sizes can be made: legs longer than the thickness, nothing above 48 in. */
export function bentValid(b: Bent): boolean {
  return (
    b.thickness_in > 0 &&
    b.leg1_in > b.thickness_in &&
    b.leg2_in > b.thickness_in &&
    b.leg1_in <= 48 &&
    b.leg2_in <= 48
  );
}

/** "BENT PL 3/8 x 6 x 4" (thickness x leg 1 x leg 2): the same name the server stores. */
export const bentName = (b: Bent): string =>
  `BENT PL ${formatInches(b.thickness_in)} x ${formatInches(b.leg1_in)} x ${formatInches(b.leg2_in)}`;

/** The sizes of a bent plate name, or null (an L shape, or not a bent plate). */
export function parseBent(name: string | null | undefined): Bent | null {
  const m = /^BENT\s*(?:PL|BP)\s+(\S+)\s*[xX]\s*(\S+)\s*[xX]\s*(\S+)$/i.exec(
    (name ?? "").trim(),
  );
  if (!m) return null;
  const [t, l1, l2] = [
    parseInches(m[1]!),
    parseInches(m[2]!),
    parseInches(m[3]!),
  ];
  if (t === null || l1 === null || l2 === null) return null;
  const b = { thickness_in: t, leg1_in: l1, leg2_in: l2 };
  return bentValid(b) ? b : null;
}

/** lb per ft of a bent plate: 3.4 x t x (leg1 + leg2 - t) (shown as a preview; the BOM uses the
 * server's number, the same formula). */
export const bentLbPerFt = (b: Bent): number =>
  3.4 * b.thickness_in * (b.leg1_in + b.leg2_in - b.thickness_in);

export const isBentPlate = (p: Piece): boolean => parseBent(p.profile) !== null;
