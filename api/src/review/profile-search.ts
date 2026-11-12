// Phase 0 profile from callout: the profile search (Bluebeam condition 1) and the proposals for
// members that already exist. Pure database reads except `applyEdits` (one recorded action).
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { loadMemberViews } from './member-views.js';
import { numberValue, parseProfile } from './profile.js';
import { linkPoint, loadLabels, type LabelRow, type Link, type Pt } from './profile-link.js';
import { viewsOf } from './build-views.js';
import { firstId } from '../routes/build.js';
import { recordAction } from './actions.js';

type Db = Kysely<Database> | Transaction<Database>;

/** One profile, however it is written: family plus the numbers (a fraction and its decimal are
 * the same number): HSS12X12X3/8 and HSS12X12X0.375 give one key. */
export function equivKey(canonical: string): string {
  const m = /^([A-Z]+)(.*)$/.exec(canonical.trim().toUpperCase());
  if (!m) return canonical;
  const parts = m[2]!.split('X').map((t) => {
    const v = numberValue(t);
    return v === null ? t : String(Math.round(v * 1e6) / 1e6);
  });
  return `${m[1]}:${parts.join('|')}`;
}

/** The normalised search: parsed profile, or null when the text is not a profile. */
export function searchKey(q: string): { canonical: string; family: string; key: string } | null {
  const p = parseProfile(q);
  return p ? { canonical: p.canonical, family: p.family, key: equivKey(p.canonical) } : null;
}

export interface Occurrence {
  label_id: string;
  sheet_id: string;
  view_id: string;
  text: string;
  raw: string;
  canonical: string | null;
  valid: boolean;
  flags: string[];
  box: [number, number, number, number];
}

export async function searchProject(db: Db, projectId: string, key: string, family: string) {
  const rows = await db
    .selectFrom('page_labels as l')
    .innerJoin('sheets as s', 's.id', 'l.sheet_id')
    .select([
      'l.id',
      'l.sheet_id',
      'l.view_id',
      'l.text',
      'l.raw',
      'l.canonical',
      'l.valid',
      'l.flags',
      'l.kind',
      'l.x0',
      'l.y0',
      'l.x1',
      'l.y1',
      's.page_index',
      's.sheet_number',
    ])
    .where('s.project_id', '=', projectId)
    .where('l.family', '=', family)
    .execute();
  return rows
    .filter((r) => r.kind === 'profile' && r.canonical !== null && equivKey(r.canonical) === key)
    .map((r) => ({
      occurrence: {
        label_id: r.id,
        sheet_id: r.sheet_id,
        view_id: r.view_id,
        text: r.text,
        raw: r.raw,
        canonical: r.canonical,
        valid: r.valid,
        flags: r.flags,
        box: [Number(r.x0), Number(r.y0), Number(r.x1), Number(r.y1)] as Occurrence['box'],
      },
      page_number: r.page_index + 1,
      sheet_number: r.sheet_number,
    }));
}

export interface Candidate {
  member_id: string;
  tag: string | null;
  point: Pt;
  link: Link;
  current_profile: string | null;
  current_source: string | null;
  existing: boolean;
}

/** The columns of a sheet, each with the label it links to (the same rule Find similar uses). */
export async function columnLinks(db: Db, projectId: string, sheetId: string) {
  const views = await viewsOf(db as Kysely<Database>, sheetId);
  const first = firstId(views);
  const labelsOf = new Map<string, LabelRow[]>();
  for (const v of views) labelsOf.set(v.row.id, await loadLabels(db, sheetId, v.row.id));
  const rows = await db
    .selectFrom('members')
    .select(['id', 'member_id', 'tag_prefix', 'tag_number', 'page_x0', 'page_y0', 'build_view_id'])
    .where('sheet_id', '=', sheetId)
    .where('type', '=', 'column')
    .where('page_x0', 'is not', null)
    .where('review_status', '<>', 'rejected')
    .execute();
  // a page with no columns has nothing to load (an empty `id IN ()` is an SQL error: a 500)
  if (rows.length === 0) return [];
  const eff = new Map(
    (
      await loadMemberViews(db as Kysely<Database>, projectId, {
        memberIds: rows.map((r) => r.id),
      })
    ).map((m) => [m.id, m]),
  );
  const out: Candidate[] = [];
  for (const r of rows) {
    const m = eff.get(r.id);
    if (!m || m.human === 'deleted' || m.human === 'not_member') continue;
    const point: Pt = [Number(r.page_x0), Number(r.page_y0)];
    const labels = labelsOf.get(r.build_view_id ?? first ?? '') ?? [];
    out.push({
      member_id: r.id,
      tag: r.tag_prefix ? `${r.tag_prefix}${r.tag_number ?? ''}` : null,
      point,
      link: linkPoint(point, null, labels),
      current_profile: m.profile,
      current_source: m.profile_source,
      existing: m.existing,
    });
  }
  return out;
}

export interface Proposal {
  member_id: string;
  tag: string | null;
  current: string | null;
  proposed: string;
  source: 'label';
  confidence: string | null;
  reason: string;
  set_existing: boolean;
  label_id: string | null;
}

/** Changes to members that already exist: an own label (leader / beside, valid, in the catalog)
 * that disagrees with the member's profile. Members whose profile a person typed are left alone. */
export async function proposeProfiles(db: Db, projectId: string, sheetId: string) {
  const out: Proposal[] = [];
  for (const c of await columnLinks(db, projectId, sheetId)) {
    const lb = c.link.label;
    if (!lb || !lb.valid || c.current_source === 'person') continue;
    const differs = c.current_profile !== lb.canonical;
    const setExisting = lb.flags.includes('existing') && !c.existing;
    if (!differs && !setExisting) continue;
    out.push({
      member_id: c.member_id,
      tag: c.tag,
      current: c.current_profile,
      proposed: lb.canonical!,
      source: 'label',
      confidence: c.link.confidence,
      reason: c.link.reason,
      set_existing: setExisting,
      label_id: lb.id,
    });
  }
  return out;
}

/** Apply proposals as ONE recorded action (Undo takes all of it back). */
export async function applyProposals(
  db: Db,
  projectId: string,
  who: string,
  rows: {
    member_id: string;
    proposed: string;
    raw?: string | null;
    set_existing: boolean;
    confidence: string | null;
    reason: string;
    label_id: string | null;
    before: { profile: string | null; profile_raw: string | null; source: string | null };
  }[],
): Promise<string | null> {
  if (!rows.length) return null;
  const entries = rows.flatMap((r) => {
    const link = { method: 'label', confidence: r.confidence, reason: r.reason, applied: true };
    const e: { memberId: string; field: string; before: unknown; after: unknown }[] = [
      {
        memberId: r.member_id,
        field: 'profile_raw',
        before: r.before.profile_raw,
        after: r.raw ?? r.proposed,
      },
      { memberId: r.member_id, field: 'profile', before: r.before.profile, after: r.proposed },
      { memberId: r.member_id, field: 'profile_source', before: r.before.source, after: 'label' },
      { memberId: r.member_id, field: 'profile_link', before: null, after: link },
    ];
    if (r.set_existing)
      e.push({ memberId: r.member_id, field: 'existing', before: false, after: true });
    return e;
  });
  void projectId;
  return recordAction(
    db,
    who,
    entries.map((e) => ({ ...e, status: 'edited' as const })),
  );
}
