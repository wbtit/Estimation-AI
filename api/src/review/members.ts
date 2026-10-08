// Effective members for the review screen: the stored (extracted) row with the latest human edit of
// each field applied. The stored row is never changed by a person; edits are member_edits rows.
import type { Selectable } from 'kysely';
import type { MembersTable, ReviewStatus, ViewBox } from '../db/types.js';
import { mmToFeetInches } from '../units/index.js';
import { MM_PER_PT } from './geometry.js';
import type { SharedLine } from './shared-line.js';
import { statusOf, type LinkConfidence, type MarkRefStatus, type Status } from './status.js';

export type MemberRow = Selectable<MembersTable>;

export interface EditRow {
  field_name: string;
  corrected_value: unknown;
  created_at: Date | string;
}

export interface Candidate {
  rank: number;
  p: [number, number];
  q: [number, number];
  score: number;
  dist: number;
  rel_angle: number;
  klass?: string;
}

export interface Line {
  p: [number, number];
  q: [number, number];
}

export interface LinkEdit {
  line: Line | null;
  /** The candidate rank the person picked, or null when they clicked another line. */
  rank: number | null;
}

/** An edit value that puts the link back to the rule's proposal (what an undo of a first link edit writes). */
export interface LinkReset {
  reset: true;
}

export interface ViewContext {
  id: string;
  box: ViewBox;
  scaleRatio: number | null;
  scaleConfirmed: boolean;
}

export interface MemberView {
  id: string;
  member_id: string;
  sheet_id: string | null;
  view_id: string | null;
  origin: string;
  type: string;
  mark: string | null;
  profile_raw: string | null;
  profile: string | null;
  quantity: number;
  level: string | null;
  deleted: boolean;
  review_status: ReviewStatus;
  bbox: ViewBox | null;
  mark_ref: { status: MarkRefStatus | null; legend_row_id: string | null };
  link: {
    source: 'rule' | 'person' | 'none';
    confidence: LinkConfidence | null;
    margin: number | null;
    line: Line | null;
    chosen_rank: number | null;
    candidates: (Candidate & { length_mm: number | null })[];
  };
  length_mm: number | null;
  length_ft_in: string | null;
  length_source: string | null;
  base_elevation_mm: number | null;
  top_elevation_mm: number | null;
  status: Status;
  /** Set by annotateSharedLines: members that share a chosen line. */
  shared_line: SharedLine | null;
  /** The person's own answer for this member's shared line (an edit). */
  shared_resolution: 'separate' | null;
  /** A person merged this member into another one (it leaves the takeoff). */
  merged_into: string | null;
  /** A person said this is not a member (see item 5b). */
  not_member: { reason: string } | null;
  plan_point: { x_mm: number | null; y_mm: number | null } | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Latest corrected value of each field (edits arrive oldest first). */
export function latestEdits(edits: EditRow[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const e of edits) out.set(e.field_name, e.corrected_value);
  return out;
}

export function sameLine(a: Line, b: Line, tol = 0.6): boolean {
  const close = (x: [number, number], y: [number, number]) =>
    Math.abs(x[0] - y[0]) <= tol && Math.abs(x[1] - y[1]) <= tol;
  return (close(a.p, b.p) && close(a.q, b.q)) || (close(a.p, b.q) && close(a.q, b.p));
}

function lineLengthMm(line: Line, ratio: number): number {
  return Math.hypot(line.q[0] - line.p[0], line.q[1] - line.p[1]) * MM_PER_PT * ratio;
}

export function memberView(
  row: MemberRow,
  edits: EditRow[],
  view: ViewContext | null,
  sheetLevel: string | null,
): MemberView {
  const e = latestEdits(edits);
  const pick = <T>(field: string, base: T): T => (e.has(field) ? (e.get(field) as T) : base);

  const candidates = ((row.link_candidates ?? []) as Candidate[]).slice(0, 3);
  let linkEdit = e.has('link') ? (e.get('link') as LinkEdit | LinkReset | null) : undefined;
  if (linkEdit && 'reset' in linkEdit) linkEdit = undefined;
  const person = linkEdit as LinkEdit | null | undefined;
  let line: Line | null;
  let source: 'rule' | 'person' | 'none';
  let chosenRank: number | null;
  if (linkEdit !== undefined) {
    line = person?.line ?? null;
    source = line ? 'person' : 'none';
    chosenRank = line ? (candidates.find((c) => sameLine(c, line as Line))?.rank ?? null) : null;
  } else if (candidates.length > 0) {
    line = { p: candidates[0].p, q: candidates[0].q };
    source = 'rule';
    chosenRank = 1;
  } else {
    line = null;
    source = 'none';
    chosenRank = null;
  }

  const ratio = view?.scaleConfirmed ? view.scaleRatio : null;
  const type = pick('type', row.type);
  const baseElev = pick('start_elevation_mm', num(row.start_elevation_mm));
  const topElev = pick('end_elevation_mm', num(row.end_elevation_mm));
  const typedLength =
    type === 'column' ? null : ((e.get('length_mm') as number | null | undefined) ?? null);
  let lengthMm: number | null = null;
  let lengthSource = row.length_source;
  if (type === 'column') {
    if (baseElev !== null && topElev !== null) {
      lengthMm = Math.abs(topElev - baseElev);
      lengthSource = 'manual';
    }
  } else if (typedLength !== null) {
    lengthMm = typedLength;
    lengthSource = 'manual';
  } else if (line && ratio) {
    lengthMm = lineLengthMm(line, ratio);
    lengthSource = 'plan_geometry';
  }

  const reviewStatus = pick<ReviewStatus>('review_status', row.review_status);
  const markRef = e.has('mark_ref')
    ? (e.get('mark_ref') as { status: MarkRefStatus | null; legend_row_id: string | null })
    : { status: row.mark_ref_status, legend_row_id: row.legend_row_id };
  const profile = pick('profile', row.profile);
  const mark = pick('mark', row.mark);
  const humanConfirmed =
    row.origin === 'manual' ||
    reviewStatus === 'approved' ||
    reviewStatus === 'edited' ||
    linkEdit !== undefined ||
    typedLength !== null;
  const profileOnLabel = row.mark === null && row.origin !== 'manual';
  const status = statusOf({
    memberType: type,
    linkConfidence: row.link_confidence,
    hasLine: line !== null,
    manualLength: typedLength !== null,
    humanConfirmed,
    // a column's length comes from its elevations, so its view scale does not matter
    scaleConfirmed:
      type === 'column' || typedLength !== null ? true : (view?.scaleConfirmed ?? false),
    lengthMm,
    profileParsed: profile !== null,
    profileOnLabel: profileOnLabel || (row.origin === 'manual' && row.mark === null),
    markStatus: markRef.status,
    columnBaseKnown: baseElev !== null && topElev !== null,
  });

  return {
    id: row.id,
    member_id: row.member_id,
    sheet_id: row.sheet_id,
    view_id: row.view_id,
    origin: row.origin,
    type,
    mark,
    profile_raw: pick('profile_raw', row.profile_raw),
    profile,
    quantity: pick('quantity', row.quantity),
    level: pick<string | null>('level', null) ?? sheetLevel,
    deleted: reviewStatus === 'rejected',
    review_status: reviewStatus,
    bbox: (row.source_bbox as ViewBox | null) ?? null,
    mark_ref: markRef,
    link: {
      source,
      confidence: row.link_confidence,
      margin: num(row.link_margin),
      line,
      chosen_rank: chosenRank,
      candidates: candidates.map((c) => ({
        ...c,
        length_mm: ratio ? lineLengthMm(c, ratio) : null,
      })),
    },
    length_mm: lengthMm,
    length_ft_in: lengthMm === null ? null : mmToFeetInches(lengthMm),
    length_source: lengthMm === null ? null : lengthSource,
    base_elevation_mm: baseElev,
    top_elevation_mm: topElev,
    status,
    shared_line: null,
    shared_resolution: (e.get('shared_line') as 'separate' | null | undefined) ?? null,
    merged_into: (e.get('merged_into') as string | null | undefined) ?? null,
    not_member: (e.get('not_member') as { reason: string } | null | undefined) ?? null,
    plan_point:
      row.origin === 'manual' && row.plan_start_x_mm !== null
        ? { x_mm: num(row.plan_start_x_mm), y_mm: num(row.plan_start_y_mm) }
        : null,
  };
}
