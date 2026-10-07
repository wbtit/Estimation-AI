import type { Member } from '../contract/index.js';

/**
 * Member length in mm: the 3D distance between the two resolved end points (so sloped
 * members are handled). Returns null when either end point is unresolved; it is never
 * estimated from grid labels.
 */
export function memberLengthMm(member: Pick<Member, 'start' | 'end'>): number | null {
  const a = member.start.resolved_xyz_mm;
  const b = member.end.resolved_xyz_mm;
  if (!a || !b) return null;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
