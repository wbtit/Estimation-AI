// The badge of a page card in the review UI (Phase 11b). Pure; the order of the checks is the rule:
//   Building          a build of the page is pending or running
//   Scale needed      the page builds but has no scale (Phase 12b: none stored, none from its
//                     dimensions); it is skipped until a person sets one
//   Requesting Build  a setup value changed after the last build attempt (or never built since)
//   Not built         the last build was refused or failed (the reasons are shown with it)
//   Skip              no role (column plan or framing)
//   Reviewed          "Save page" after the last build, setup change and edit of the page
//   Not confirmed     built with at least one system value (a value no person set or saved)
//   Built             built, every value a person's
export type Badge =
  | 'Building'
  | 'Scale needed'
  | 'Requesting Build'
  | 'Not built'
  | 'Skip'
  | 'Reviewed'
  | 'Not confirmed'
  | 'Built';

export interface BadgeInput {
  role: 'column_plan' | 'framing' | null;
  built_at: Date | string | null;
  setup_changed_at: Date | string | null;
  reviewed_at: Date | string | null;
  /** Latest logged edit on the page (not a view or a save). */
  last_edit_at: Date | string | null;
  last_run: { status: string; started_at: Date | string } | null;
  system_values: string[];
  /** Phase 12b: the view builds but has no scale. */
  scale_missing?: boolean;
}

const t = (d: Date | string | null): number => (d === null ? -Infinity : new Date(d).getTime());

/** The setup values of a page that are still system values (no person set or saved them). */
export function systemValues(s: {
  build_role: string | null;
  role_confirmed_by: string | null;
  crop_region: unknown;
  crop_confirmed_by: string | null;
  build_scale_ratio: unknown;
  scale_confirmed_by: string | null;
  pen_class: string | null;
  pen_class_confirmed_by: string | null;
  tos_mm: unknown;
  tos_confirmed_by: string | null;
  column_plan_confirmed_by: string | null;
}): string[] {
  const out: string[] = [];
  if (!s.role_confirmed_by) out.push('role');
  if (s.build_role === null) return out;
  if (s.crop_region !== null && !s.crop_confirmed_by) out.push('crop');
  if (s.build_scale_ratio !== null && !s.scale_confirmed_by) out.push('scale');
  if (s.build_role === 'framing') {
    if (s.pen_class !== null && !s.pen_class_confirmed_by) out.push('pen_class');
    if (!s.column_plan_confirmed_by) out.push('column_plan');
  }
  if (s.tos_mm !== null && !s.tos_confirmed_by) out.push('tos');
  return out;
}

export function pageBadge(p: BadgeInput): Badge {
  if (p.last_run && (p.last_run.status === 'pending' || p.last_run.status === 'running'))
    return 'Building';
  if (p.role !== null && p.scale_missing) return 'Scale needed';
  const lastAttempt = p.last_run ? t(p.last_run.started_at) : -Infinity;
  if (p.role !== null && t(p.setup_changed_at) > lastAttempt) return 'Requesting Build';
  const latest = Math.max(t(p.built_at), t(p.setup_changed_at), t(p.last_edit_at));
  const reviewed = p.reviewed_at !== null && t(p.reviewed_at) >= latest;
  if (p.role === null) return reviewed ? 'Reviewed' : 'Skip';
  if (p.last_run && (p.last_run.status === 'refused' || p.last_run.status === 'failed'))
    return 'Not built';
  if (p.built_at === null) return 'Not built';
  if (reviewed) return 'Reviewed';
  if (p.system_values.length > 0) return 'Not confirmed';
  return 'Built';
}

/** The badge of a page with several views: the first in this order wins, so a page shows the view
 * that needs the most attention. All Skip (or Reviewed with no building view) stays as it is. */
const PAGE_ORDER: Badge[] = [
  'Building',
  'Scale needed',
  'Requesting Build',
  'Not built',
  'Not confirmed',
  'Built',
  'Reviewed',
  'Skip',
];
export function combineBadges(badges: Badge[]): Badge {
  if (badges.length === 0) return 'Skip';
  return PAGE_ORDER.find((b) => badges.includes(b)) ?? badges[0]!;
}
