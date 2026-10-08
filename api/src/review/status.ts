// Color rules of the review screen. The ONE place that decides green / amber / red for a member.
// Documented in docs/PHASE5_PLAN.md. Pure and table-tested.
//
//   green = link confidence "high" AND profile parsed AND (mark linked to a legend row OR the
//           profile is given directly on the label)
//   amber = confidence "medium", or "high" with a missing piece
//   red   = confidence "low", no candidate line, ambiguous mark, scale not confirmed, no length,
//           or a column whose base elevation cannot be determined
//   A member a person confirmed ("looks right"), fixed, or added by hand is green (confirmed) unless
//   a red condition outside the rule's own confidence remains (scale, length, mark, column base).

export type Color = 'green' | 'amber' | 'red';
export type LinkConfidence = 'high' | 'medium' | 'low';
export type MarkRefStatus = 'linked' | 'no_legend_row' | 'ambiguous';

export interface StatusInput {
  memberType: string;
  /** The link confidence class the rule proposed (null for members added by hand). */
  linkConfidence: LinkConfidence | null;
  hasLine: boolean;
  /** A person confirmed, edited or added this member. */
  humanConfirmed: boolean;
  scaleConfirmed: boolean;
  lengthMm: number | null;
  profileParsed: boolean;
  /** The member came from a profile label (the profile is on the drawing at the label). */
  profileOnLabel: boolean;
  markStatus: MarkRefStatus | null;
  /** Columns need both end elevations (base known) to have a length. */
  columnBaseKnown: boolean;
}

export interface Status {
  color: Color;
  /** True when green or amber comes from a person rather than the rule alone. */
  confirmed: boolean;
  reasons: string[];
}

export const REASONS = {
  scaleNotConfirmed: 'scale of the view is not confirmed',
  noLine: 'no candidate line',
  confidenceLow: 'link confidence low',
  confidenceMedium: 'link confidence medium',
  markAmbiguous: 'mark has several legend rows',
  noLength: 'length cannot be measured',
  columnBase: 'column base elevation unknown',
  profileNotParsed: 'profile not parsed',
  markNotLinked: 'mark not linked to a legend row',
} as const;

export function statusOf(i: StatusInput): Status {
  const red: string[] = [];
  const amber: string[] = [];
  const isColumn = i.memberType === 'column';

  if (!i.scaleConfirmed) red.push(REASONS.scaleNotConfirmed);
  if (!isColumn && !i.hasLine) red.push(REASONS.noLine);
  if (!i.humanConfirmed && i.linkConfidence === 'low' && i.hasLine) red.push(REASONS.confidenceLow);
  if (i.markStatus === 'ambiguous') red.push(REASONS.markAmbiguous);
  if (isColumn && !i.columnBaseKnown) red.push(REASONS.columnBase);
  else if (i.scaleConfirmed && (i.hasLine || isColumn) && i.lengthMm === null)
    red.push(REASONS.noLength);

  if (red.length > 0) return { color: 'red', confirmed: i.humanConfirmed, reasons: red };

  if (i.humanConfirmed) return { color: 'green', confirmed: true, reasons: [] };

  if (i.linkConfidence === 'medium') amber.push(REASONS.confidenceMedium);
  if (!i.profileParsed) amber.push(REASONS.profileNotParsed);
  if (!i.profileOnLabel && i.markStatus !== 'linked') amber.push(REASONS.markNotLinked);
  if (i.linkConfidence === 'high' && amber.length === 0) {
    return { color: 'green', confirmed: false, reasons: [] };
  }
  return { color: 'amber', confirmed: false, reasons: amber };
}
