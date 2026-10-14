// Effective members for the review screen: the stored (extracted) row with the latest human edit of
// each field applied. The stored row is never changed by a person; edits are member_edits rows.
import type { Selectable } from 'kysely';
import type {
  CountSource,
  CountState,
  MembersTable,
  ReviewStatus,
  SizeSource,
  ViewBox,
} from '../db/types.js';
import { mmToFeetInches } from '../units/index.js';
import { MM_PER_PT } from './geometry.js';
import { parseJoist } from './joist.js';
import type { SharedLine } from './shared-line.js';
import { countingOf, typeOfKind, type Counting, type KindIndex } from './kinds.js';
import type { CatalogLookup } from '../catalog/lookup.js';
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

/** What a person has done with a member. */
/**
 * Phase 8: the count state of a piece and the evidence of a click. `suggested` = the system found it
 * and nobody decided; `confirmed` = a person clicked it or accepted the suggestion; `rejected` = a
 * person turned the suggestion down (kept, out of every total).
 */
export interface CountView {
  state: CountState;
  source: CountSource | null;
  click: { x: number; y: number; at: string } | null;
  snapped: boolean | null;
  snapped_line: {
    id: number;
    p: [number, number];
    q: [number, number];
    class: string | null;
    version: string | null;
  } | null;
  snapped_distance_pt: number | null;
  size_source: SizeSource | null;
  size_evidence: { member_id: string; distance_pt: number } | null;
}

export type HumanState =
  'unreviewed' | 'confirmed' | 'edited' | 'existing' | 'not_member' | 'deleted';

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
  /** The two-click measurement this length came from (Phase 8 Part C), or null. */
  length_measurement: string | null;
  base_elevation_mm: number | null;
  top_elevation_mm: number | null;
  status: Status;
  /**
   * What the system alone said (the rule's confidence and the checks, before any human action), kept
   * beside the current status. A person's "looks right" or fix never hides it. Null for a member a
   * person added by hand (there is no system result).
   */
  system: Status | null;
  /** The human state: what a person has done with this member. */
  human: HumanState;
  /** Joist (K, LH, DLH series) designation parsed from the profile text; a joist is never matched to AISC. */
  joist_series: {
    series: 'K' | 'LH' | 'DLH';
    canonical: string;
    depth: string;
    number: string;
  } | null;
  /** Set by annotateSharedLines: members that share a chosen line. */
  shared_line: SharedLine | null;
  /** The length is the whole line it shares with other members: not trusted, left out of length totals. */
  length_shared: boolean;
  /** The person's own answer for this member's shared line (an edit). */
  shared_resolution: 'separate' | null;
  /** A person merged this member into another one (it leaves the takeoff). */
  merged_into: string | null;
  /** A person said this is not a member (see item 5b). */
  not_member: { reason: string } | null;
  /** A person said this is EXISTING steel: it keeps its profile and length but is not counted. */
  existing: boolean;
  plan_point: { x_mm: number | null; y_mm: number | null } | null;
  /** Phase 6a: the kind (the estimators' scope list), how it was found, and the tag. */
  kind: KindState;
  tag: Tag;
  /** Symbol shape group from the kind (linear, column, plate, other); none for excluded kinds. */
  symbol_group: 'linear' | 'column' | 'plate' | 'other' | 'none';
  /** Symbol colour: the confidence colour, or grey for a piece with no kind yet. */
  symbol_color: 'green' | 'amber' | 'red' | 'grey' | 'unlinked';
  counting: Counting;
  /** Catalog result for the profile (Stage 1: SHAPE and Unit W come only from the catalog). */
  catalog: CatalogView | null;
  /** Flags with a code, a severity and a text; every unconfirmed guess is one. */
  flags: MemberFlag[];
  /** When the system or a person last changed this member (the stored row or the latest edit). */
  changed_at: string;
  /** The Name a person typed for the table row (an edit), or null for the system wording. */
  name: string | null;
  /** Phase 8: count state, click evidence, how the size was filled. */
  count: CountView;
}

export interface KindState {
  name: string | null;
  scope: 'main' | 'misc' | 'excluded' | null;
  /** missing = no keyword found; ambiguous = a bare brace, rail or ladder; guessed = found by a rule; confirmed = a person set or confirmed it. */
  state: 'missing' | 'ambiguous' | 'guessed' | 'confirmed';
  source: 'keyword' | 'legend' | 'sheet_context' | 'person' | null;
  evidence: {
    keyword: string | null;
    where: string | null;
    candidates: string[];
  } | null;
  /** A kind word seen only in nearby text or the sheet title: a grey hint, the kind stays empty. */
  hint: { kind: string; keyword: string; where: string } | null;
}

export interface Tag {
  prefix: string | null;
  number: number | null;
  /** Prefix and number as drawn on the symbol; a piece without a kind shows "?" for the prefix. */
  text: string;
  provisional: boolean;
}

export interface CatalogView {
  found: boolean;
  shape_name: string | null;
  /** The catalog type (W, HSS, L, ...): the workbook's SHAPE. */
  shape: string | null;
  unit_w_lb_ft: number | null;
  via: 'exact' | 'numeric' | null;
  reason: string | null;
}

export type FlagCode =
  | 'KIND_MISSING'
  | 'KIND_GUESSED'
  | 'KIND_AMBIGUOUS'
  | 'PREFIX_PROVISIONAL'
  | 'PROFILE_NOT_IN_CATALOG';

export interface MemberFlag {
  code: FlagCode;
  severity: 'grey' | 'amber' | 'info';
  text: string;
}

/** Everything the member view needs besides the row: kinds and the catalog (both optional). */
export interface ViewLookups {
  kinds?: KindIndex;
  catalog?: CatalogLookup | null;
  /** Effective tags of the other members of the sheet, to number a person's kind change. */
  tagOverrides?: Map<string, { prefix: string | null; number: number | null }>;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

function symbolGroupOfType(type: string): MemberView['symbol_group'] {
  return type === 'column'
    ? 'column'
    : type === 'joist'
      ? 'none'
      : type === 'other'
        ? 'other'
        : 'linear';
}

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
  lookups: ViewLookups = {},
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
  // Phase 6a: the effective kind (a person's edit over the stored guess) and the type it implies
  const kindRaw = e.get('kind') as string | { reset: true } | null | undefined;
  const kindEdited = e.has('kind') && !(typeof kindRaw === 'object' && kindRaw !== null);
  const kindName = kindEdited ? ((kindRaw as string | null) ?? null) : row.kind;
  const kindInfo = kindName ? lookups.kinds?.get(kindName) : undefined;
  const evidence = (row.kind_evidence ?? null) as {
    status?: string;
    keyword?: string | null;
    where?: string | null;
    candidates?: string[];
    hint?: { kind: string; keyword: string; where: string } | null;
  } | null;
  const kindState: KindState['state'] =
    kindEdited ||
    e.get('kind_confirmed') === true ||
    (!e.has('kind_confirmed') && row.kind_confirmed)
      ? kindName
        ? 'confirmed'
        : 'missing'
      : row.kind
        ? 'guessed'
        : evidence?.status === 'ambiguous'
          ? 'ambiguous'
          : 'missing';
  const kindSource = kindEdited
    ? kindName
      ? ('person' as const)
      : null
    : kindState === 'confirmed' && !row.kind_source
      ? ('person' as const)
      : row.kind_source;
  const strongSource =
    kindSource === 'keyword' &&
    (evidence?.where === 'same_line' || evidence?.where === 'designation');
  const type = typeOfKind(kindInfo, pick('type', row.type));
  const baseElev = pick('start_elevation_mm', num(row.start_elevation_mm));
  const topElev = pick('end_elevation_mm', num(row.end_elevation_mm));
  const typedLength =
    type === 'column' ? null : ((e.get('length_mm') as number | null | undefined) ?? null);
  let lengthMm: number | null = null;
  let lengthSource: string | null = row.length_source;
  const measurementId = (e.get('length_measurement') as string | null | undefined) ?? null;
  if (type === 'column') {
    if (baseElev !== null && topElev !== null) {
      lengthMm = Math.abs(topElev - baseElev);
      lengthSource = 'manual';
    }
  } else if (typedLength !== null) {
    lengthMm = typedLength;
    // a length that came from a two-click measurement keeps that evidence (Phase 8 Part C)
    lengthSource = measurementId ? 'measured_manual' : 'manual';
  } else if (line && ratio) {
    lengthMm = lineLengthMm(line, ratio);
    lengthSource = 'plan_geometry';
  }

  const reviewStatus = pick<ReviewStatus>('review_status', row.review_status);
  const markRef = e.has('mark_ref')
    ? (e.get('mark_ref') as { status: MarkRefStatus | null; legend_row_id: string | null })
    : { status: row.mark_ref_status, legend_row_id: row.legend_row_id };
  const profile = pick('profile', row.profile);
  const rawProfile = pick('profile_raw', row.profile_raw);
  const joist = type === 'joist' && rawProfile ? parseJoist(rawProfile) : null;
  const mark = pick('mark', row.mark);
  // a person accepted the suggestion or clicked the piece: that is a person's confirmation (a low
  // link confidence no longer turns it red; red keeps its other meanings)
  const countConfirmed = pick<CountState>('count_state', row.count_state) === 'confirmed';
  const humanConfirmed =
    row.origin === 'manual' ||
    countConfirmed ||
    reviewStatus === 'approved' ||
    reviewStatus === 'edited' ||
    linkEdit !== undefined ||
    typedLength !== null;
  const profileOnLabel = row.mark === null && row.origin !== 'manual';
  const baseStatus = statusOf({
    memberType: type,
    linkConfidence: row.link_confidence,
    hasLine: line !== null,
    manualLength: typedLength !== null,
    humanConfirmed,
    // a column's length comes from its elevations, so its view scale does not matter
    kind: { state: kindState, weak: !strongSource },
    profileParsed: type === 'joist' ? joist !== null : profile !== null,
    profileOnLabel: profileOnLabel || (row.origin === 'manual' && row.mark === null),
    markStatus: markRef.status,
  });

  // a clicked piece with no size is amber: the size must be typed (or taken from a label)
  const countSource = pick<CountSource | null>('count_source', row.count_source);
  const clickedNoSize =
    row.count_source === 'human_click' && type !== 'joist' && !profile && !rawProfile;
  const status: Status = clickedNoSize
    ? {
        color: baseStatus.color === 'red' ? 'red' : 'amber',
        confirmed: false,
        reasons: [...baseStatus.reasons, 'size missing: type the size'],
      }
    : baseStatus;

  // the system's own result: the stored row alone, no edits
  const storedKindInfo = row.kind ? lookups.kinds?.get(row.kind) : undefined;
  const storedType = typeOfKind(storedKindInfo, row.type);
  const storedLine = candidates.length > 0 ? { p: candidates[0].p, q: candidates[0].q } : null;
  const storedBase = num(row.start_elevation_mm);
  const storedTop = num(row.end_elevation_mm);
  const system: Status | null =
    row.origin === 'manual'
      ? null
      : statusOf({
          memberType: storedType,
          linkConfidence: row.link_confidence,
          hasLine: storedLine !== null,
          humanConfirmed: false,
          kind: {
            state: row.kind
              ? 'guessed'
              : evidence?.status === 'ambiguous'
                ? 'ambiguous'
                : 'missing',
            weak: !(
              row.kind_source === 'keyword' &&
              (evidence?.where === 'same_line' || evidence?.where === 'designation')
            ),
          },
          profileParsed:
            storedType === 'joist'
              ? !!row.profile_raw && parseJoist(row.profile_raw) !== null
              : row.profile !== null,
          profileOnLabel,
          markStatus: row.mark_ref_status,
        });
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fieldEdited = (field: string, stored: unknown) =>
    e.has(field) && !same(e.get(field), stored);
  const edited =
    row.origin === 'manual' ||
    (linkEdit !== undefined && linkEdit !== null) ||
    typedLength !== null ||
    fieldEdited('profile_raw', row.profile_raw) ||
    fieldEdited('profile', row.profile) ||
    fieldEdited('mark', row.mark) ||
    fieldEdited('type', row.type) ||
    fieldEdited('quantity', row.quantity) ||
    fieldEdited('level', null) ||
    fieldEdited('mark_ref', { status: row.mark_ref_status, legend_row_id: row.legend_row_id }) ||
    fieldEdited('start_elevation_mm', storedBase) ||
    fieldEdited('end_elevation_mm', storedTop) ||
    fieldEdited('shared_line', null) ||
    fieldEdited('merged_into', null);
  const notMember = (e.get('not_member') as { reason: string } | null | undefined) ?? null;
  const existing = e.get('existing') === true;
  const human: HumanState =
    reviewStatus === 'rejected'
      ? 'deleted'
      : notMember !== null
        ? 'not_member'
        : existing
          ? 'existing'
          : edited
            ? 'edited'
            : reviewStatus === 'approved' || countConfirmed
              ? 'confirmed'
              : 'unreviewed';

  const tagEdit = e.has('tag')
    ? (e.get('tag') as { prefix: string | null; number: number | null })
    : { prefix: row.tag_prefix, number: row.tag_number };
  const tagKind = lookups.kinds
    ? [...lookups.kinds.values()].find((k) => k.prefix === tagEdit.prefix)
    : undefined;
  const tag: Tag = {
    prefix: tagEdit.prefix,
    number: tagEdit.number,
    text: tagEdit.number === null ? '' : `${tagEdit.prefix ?? '?'}${tagEdit.number}`,
    provisional: tagEdit.prefix !== null && (tagKind?.provisional ?? true),
  };
  const iso = (d: Date | string) => new Date(d as string).toISOString();
  const changedAt = [row.updated_at, ...edits.map((x) => x.created_at)]
    .map(iso)
    .reduce((a, b) => (a > b ? a : b));
  const lookup = type !== 'joist' && profile ? lookups.catalog?.find(profile) : undefined;
  const catalog: CatalogView | null = lookup
    ? lookup.found
      ? {
          found: true,
          shape_name: lookup.shape.shape_name,
          shape: lookup.shape.family,
          unit_w_lb_ft: lookup.shape.weight_lb_per_ft,
          via: lookup.via,
          reason: null,
        }
      : {
          found: false,
          shape_name: null,
          shape: null,
          unit_w_lb_ft: null,
          via: null,
          reason: lookup.reason,
        }
    : null;
  const flags: MemberFlag[] = [];
  if (type !== 'joist' && kindState === 'missing') {
    flags.push({ code: 'KIND_MISSING', severity: 'grey', text: 'kind not found: choose the kind' });
  }
  if (kindState === 'ambiguous') {
    flags.push({
      code: 'KIND_AMBIGUOUS',
      severity: 'amber',
      text: 'kind is ambiguous: choose between ' + (evidence?.candidates ?? []).join(', '),
    });
  }
  if (kindState === 'guessed') {
    flags.push({
      code: 'KIND_GUESSED',
      severity: 'amber',
      text: `kind guessed from ${evidence?.where?.replace('_', ' ') ?? 'the text'}, not confirmed`,
    });
  }
  if (tag.provisional) {
    flags.push({
      code: 'PREFIX_PROVISIONAL',
      severity: 'info',
      text: 'provisional prefix (the owner list of abbreviations is not loaded)',
    });
  }
  if (catalog && !catalog.found) {
    flags.push({
      code: 'PROFILE_NOT_IN_CATALOG',
      severity: 'amber',
      text: `profile not in the catalog (${catalog.reason}): Unit W is left empty`,
    });
  }

  return {
    id: row.id,
    member_id: row.member_id,
    sheet_id: row.sheet_id,
    view_id: row.view_id,
    origin: row.origin,
    type,
    mark,
    profile_raw: rawProfile,
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
    length_measurement: lengthMm !== null && typedLength !== null ? measurementId : null,
    base_elevation_mm: baseElev,
    top_elevation_mm: topElev,
    status,
    system,
    human,
    joist_series: joist
      ? {
          series: joist.series,
          canonical: joist.canonical,
          depth: joist.depth,
          number: joist.number,
        }
      : null,
    shared_line: null,
    length_shared: false,
    shared_resolution: (e.get('shared_line') as 'separate' | null | undefined) ?? null,
    merged_into: (e.get('merged_into') as string | null | undefined) ?? null,
    not_member: (e.get('not_member') as { reason: string } | null | undefined) ?? null,
    existing,
    plan_point:
      row.origin === 'manual' && row.plan_start_x_mm !== null
        ? { x_mm: num(row.plan_start_x_mm), y_mm: num(row.plan_start_y_mm) }
        : null,
    kind: {
      name: kindName,
      scope: kindInfo?.scope ?? null,
      state: kindState,
      source: kindSource,
      evidence:
        kindState === 'confirmed' && kindEdited
          ? null
          : evidence
            ? {
                keyword: evidence.keyword ?? null,
                where: evidence.where ?? null,
                candidates: evidence.candidates ?? [],
              }
            : null,
      hint: kindName === null ? (evidence?.hint ?? null) : null,
    },
    tag,
    symbol_group: kindInfo?.symbol_group ?? symbolGroupOfType(type),
    symbol_color:
      kindName === null && (status.color === 'green' || status.color === 'amber')
        ? 'grey'
        : status.color,
    counting: countingOf(kindInfo),
    catalog,
    flags,
    changed_at: changedAt,
    name: pick<string | null>('name', null),
    count: {
      state: pick<CountState>('count_state', row.count_state),
      source: countSource,
      click:
        row.click_x !== null && row.click_y !== null && row.click_at !== null
          ? { x: Number(row.click_x), y: Number(row.click_y), at: iso(row.click_at) }
          : null,
      snapped: row.snapped,
      snapped_line: (row.snapped_line ?? null) as CountView['snapped_line'],
      snapped_distance_pt: num(row.snapped_distance_pt),
      size_source: pick<SizeSource | null>('size_source', row.size_source),
      size_evidence: (row.size_evidence ?? null) as CountView['size_evidence'],
    },
  };
}
