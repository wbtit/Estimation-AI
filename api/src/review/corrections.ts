// All human corrections as JSON lines, for later accuracy measurement: one line per member that a
// person touched (confirmed, fixed, added or deleted), with the label, the proposed link, the final
// link, and every edit (before, after, who, when). The AI-free "ground truth" this produces is
// whatever the reviewers decided.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadMemberViews } from '../routes/members.js';
import { sameLine, type Candidate } from './members.js';

export async function correctionLines(db: Kysely<Database>, projectId: string) {
  const touched = await db
    .selectFrom('member_edits as e')
    .innerJoin('members as m', 'm.id', 'e.member_id')
    .select('e.member_id')
    .distinct()
    .where('m.project_id', '=', projectId)
    .execute();
  if (touched.length === 0) return [];
  const ids = touched.map((t) => t.member_id);
  const views = await loadMemberViews(db, projectId, { memberIds: ids });
  const rows = await db
    .selectFrom('members as m')
    .leftJoin('sheets as s', 's.id', 'm.sheet_id')
    .select([
      'm.id',
      'm.label_key',
      'm.origin',
      'm.profile_raw as stored_profile_raw',
      'm.mark as stored_mark',
      'm.source_bbox',
      'm.link_candidates',
      'm.link_confidence',
      'm.link_margin',
      'm.link_rule',
      's.page_index',
    ])
    .where('m.id', 'in', ids)
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const edits = await db
    .selectFrom('member_edits')
    .select([
      'member_id',
      'field_name',
      'original_value',
      'corrected_value',
      'reviewer',
      'created_at',
      'action_id',
      'undo_of_action_id',
    ])
    .where('member_id', 'in', ids)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const editsOf = new Map<string, typeof edits>();
  for (const e of edits) editsOf.set(e.member_id, [...(editsOf.get(e.member_id) ?? []), e]);

  return views.map((v) => {
    const r = byId.get(v.id)!;
    const cands = (r.link_candidates ?? []) as Candidate[];
    const proposed = cands[0] ? { p: cands[0].p, q: cands[0].q } : null;
    const list = editsOf.get(v.id) ?? [];
    const last = list[list.length - 1];
    return {
      member_id: v.member_id,
      origin: v.origin,
      label_key: r.label_key,
      page_number: r.page_index === null ? null : r.page_index + 1,
      label: { text: r.stored_profile_raw ?? r.stored_mark, bbox: r.source_bbox },
      proposed: {
        line: proposed,
        confidence: r.link_confidence,
        margin: r.link_margin === null ? null : Number(r.link_margin),
        rule: r.link_rule,
        candidates: cands,
      },
      final: {
        line: v.link.line,
        source: v.link.source,
        chosen_rank: v.link.chosen_rank,
        profile_raw: v.profile_raw,
        profile: v.profile,
        mark: v.mark,
        type: v.type,
        level: v.level,
        color: v.status.color,
        deleted: v.deleted,
        not_member: v.not_member,
        merged_into: v.merged_into,
        shared_line_resolution: v.shared_resolution,
        confirmed: v.status.confirmed,
      },
      // what the system said before any human action stays next to what the person did
      system: v.system,
      human: v.human,
      link_changed:
        !!v.link.line && !!proposed ? !sameLine(v.link.line, proposed) : v.link.line !== proposed,
      who: last?.reviewer ?? null,
      when: last ? new Date(last.created_at).toISOString() : null,
      edits: list.map((e) => ({
        action_id: e.action_id,
        undo_of_action_id: e.undo_of_action_id,
        field: e.field_name,
        before: e.original_value,
        after: e.corrected_value,
        who: e.reviewer,
        when: new Date(e.created_at).toISOString(),
      })),
    };
  });
}
