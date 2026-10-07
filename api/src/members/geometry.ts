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

/**
 * Elevation of a column's base, in mm, or null if it cannot be determined.
 * The base is the lower end: chosen by the resolved z coordinate when both end points are
 * resolved (ties pick the start), otherwise the lower of the two elevations. If that end has no
 * elevation, or the ends cannot be ranked, the base elevation is unknown. Never estimated.
 */
export function columnBaseElevationMm(member: Pick<Member, 'start' | 'end'>): number | null {
  const { start, end } = member;
  const zStart = start.resolved_xyz_mm?.[2];
  const zEnd = end.resolved_xyz_mm?.[2];
  if (zStart !== undefined && zEnd !== undefined) {
    return zStart <= zEnd ? start.elevation_mm : end.elevation_mm;
  }
  if (start.elevation_mm !== null && end.elevation_mm !== null) {
    return Math.min(start.elevation_mm, end.elevation_mm);
  }
  return null;
}
