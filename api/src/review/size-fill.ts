// Size autofill of a clicked piece (Phase 8). Deterministic, in this order:
//   1. linked_label  : the label already linked to the line the click snapped to
//   2. nearest_label : the nearest profile label on the sheet within the label radius
//   3. none          : blank (the piece is amber until a person types the size)
// The result says which rule filled it and which label it came from, so the person can check it
// and overwrite it (an overwrite is recorded as size_source = manual).
import { sameLine, type Line, type MemberView } from './members.js';

export interface SizeFill {
  /** The size text to store (as written on the drawing), or null when nothing was found. */
  profile_text: string | null;
  source: 'linked_label' | 'nearest_label' | 'none';
  /** The label the size came from and its distance to the click (null for `none`). */
  evidence: { member_id: string; distance_pt: number } | null;
}

function rectDistance(
  px: number,
  py: number,
  b: { x0: number; y0: number; x1: number; y1: number },
): number {
  const dx = Math.max(b.x0 - px, 0, px - b.x1);
  const dy = Math.max(b.y0 - py, 0, py - b.y1);
  return Math.hypot(dx, dy);
}

/** A profile label of the drawing: an extracted member with a size text, still a live label. */
function isLabel(m: MemberView): boolean {
  return (
    m.origin === 'extracted' &&
    !m.deleted &&
    m.merged_into === null &&
    m.not_member === null &&
    m.bbox !== null &&
    !!m.profile_raw &&
    m.profile_raw.trim() !== ''
  );
}

export function fillSize(
  click: { x: number; y: number },
  snapped: Line | null,
  sheetMembers: readonly MemberView[],
  labelRadius: number,
): SizeFill {
  const labels = sheetMembers.filter(isLabel);
  const dist = (m: MemberView) =>
    rectDistance(click.x, click.y, m.bbox as NonNullable<MemberView['bbox']>);
  const byDistance = (a: MemberView, b: MemberView) =>
    dist(a) - dist(b) || a.id.localeCompare(b.id);
  if (snapped) {
    const linked = labels
      .filter((m) => m.link.line !== null && sameLine(m.link.line, snapped))
      .sort(byDistance);
    const hit = linked[0];
    if (hit) {
      return {
        profile_text: (hit.profile_raw as string).trim(),
        source: 'linked_label',
        evidence: { member_id: hit.id, distance_pt: Math.round(dist(hit) * 10) / 10 },
      };
    }
  }
  const near = labels.filter((m) => dist(m) <= labelRadius).sort(byDistance)[0];
  if (near) {
    return {
      profile_text: (near.profile_raw as string).trim(),
      source: 'nearest_label',
      evidence: { member_id: near.id, distance_pt: Math.round(dist(near) * 10) / 10 },
    };
  }
  return { profile_text: null, source: 'none', evidence: null };
}
