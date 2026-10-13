// Color rules of the review screen. The ONE place that decides green / amber / red for a member.
// Documented in docs/PHASE5_PLAN.md. Pure and table-tested.
//
//   Stage 1 (Phase 6a): colour is the confidence of the IDENTIFICATION (link, profile, mark, kind).
//   Length and scale are NOT part of it (lengths are added in Stage 2); they no longer turn a member
//   amber or red.
//   green = link confidence "high" AND profile parsed AND (mark linked to a legend row OR the
//           profile is given directly on the label) AND the kind is not doubtful
//   amber = confidence "medium", or "high" with a missing piece, or an ambiguous kind, or a kind
//           guessed from weaker evidence than the label's own text line
//   red   = confidence "low" or an ambiguous mark
//   unlinked = a profile label with no candidate line within the rule radius (and no typed length).
//           It is not a red member: it goes to the sheet's list of unlinked labels, out of every total,
//           until a person gives it a line or a length.
//   A member a person confirmed ("looks right"), fixed, or added by hand is green (confirmed) unless
//   a red condition outside the rule's own confidence remains (scale, length, mark, column base).

/** `unlinked` = a profile label with no candidate line and no typed length: not a member yet. */
export type Color = 'green' | 'amber' | 'red' | 'unlinked';
export type LinkConfidence = 'high' | 'medium' | 'low';
export type MarkRefStatus = 'linked' | 'no_legend_row' | 'ambiguous';

export interface StatusInput {
  memberType: string;
  /** The link confidence class the rule proposed (null for members added by hand). */
  linkConfidence: LinkConfidence | null;
  hasLine: boolean;
  /** A person confirmed, edited or added this member. */
  humanConfirmed: boolean;
  profileParsed: boolean;
  /** The member came from a profile label (the profile is on the drawing at the label). */
  profileOnLabel: boolean;
  markStatus: MarkRefStatus | null;
  /** A person typed the length (a label that has no line can still become a member). */
  manualLength?: boolean;
  /**
   * The state of the member kind: `ambiguous` (a person must choose) and `weak` (guessed from
   * nearby text, the legend or the sheet title, not from the label's own line) make the member amber
   * until a person confirms; a missing kind is shown by a grey symbol, not by a colour change here.
   */
  kind?: { state: 'missing' | 'ambiguous' | 'guessed' | 'confirmed'; weak: boolean };
}

export interface Status {
  color: Color;
  /** True when green or amber comes from a person rather than the rule alone. */
  confirmed: boolean;
  reasons: string[];
}

export const REASONS = {
  noLine: 'no candidate line',
  confidenceLow: 'link confidence low',
  confidenceMedium: 'link confidence medium',
  markAmbiguous: 'mark has several legend rows',
  kindAmbiguous: 'kind is ambiguous (a bare brace, rail or ladder): choose the kind',
  kindWeak: 'kind guessed from nearby text, the legend or the sheet title',
  profileNotParsed: 'profile not parsed',
  markNotLinked: 'mark not linked to a legend row',
  sharedLine: 'shares its line with other members (shared_line)',
} as const;

export function statusOf(i: StatusInput): Status {
  const red: string[] = [];
  const amber: string[] = [];
  const isColumn = i.memberType === 'column';

  if (!isColumn && !i.hasLine && !i.manualLength) {
    return { color: 'unlinked', confirmed: false, reasons: [REASONS.noLine] };
  }

  if (!i.humanConfirmed && i.linkConfidence === 'low' && i.hasLine) red.push(REASONS.confidenceLow);
  if (i.markStatus === 'ambiguous') red.push(REASONS.markAmbiguous);

  if (red.length > 0) return { color: 'red', confirmed: i.humanConfirmed, reasons: red };

  if (i.humanConfirmed) return { color: 'green', confirmed: true, reasons: [] };

  if (i.linkConfidence === 'medium') amber.push(REASONS.confidenceMedium);
  if (!i.profileParsed) amber.push(REASONS.profileNotParsed);
  if (!i.profileOnLabel && i.markStatus !== 'linked') amber.push(REASONS.markNotLinked);
  if (i.kind?.state === 'ambiguous') amber.push(REASONS.kindAmbiguous);
  else if (i.kind?.state === 'guessed' && i.kind.weak) amber.push(REASONS.kindWeak);
  if (i.linkConfidence === 'high' && amber.length === 0) {
    return { color: 'green', confirmed: false, reasons: [] };
  }
  return { color: 'amber', confirmed: false, reasons: amber };
}

/**
 * A member that shares its chosen line with other members, and nobody has said yet whether they are
 * separate members, cannot be green: a person's "looks right" does not clear it. Red stays red.
 * Resolving the group ("separate members" or a merge) removes the reason.
 */
export function withSharedLine(status: Status): Status {
  if (status.color === 'red') return status;
  return { ...status, color: 'amber', reasons: [...status.reasons, REASONS.sharedLine] };
}
