// Tag numbering scope of a project (Phase 9). 'job' (default): one running number per kind across all
// sheets of the job, in click order; 'sheet': the number restarts on every sheet (Phase 8). The scope
// is a project setting. Numbers are never reused, so a tag stays stable once seen; a person can edit
// any tag, and the clash check uses the same pool.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { MemberView } from './members.js';
import { loadMemberViews } from '../routes/members.js';

export type TagScope = 'job' | 'sheet';

export async function tagScopeOf(db: Kysely<Database>, projectId: string): Promise<TagScope> {
  const p = await db
    .selectFrom('projects')
    .select('tag_scope')
    .where('id', '=', projectId)
    .executeTakeFirst();
  return p?.tag_scope ?? 'job';
}

/**
 * The members whose tags a new tag must not collide with: every member of the project (job scope) or
 * the members of the sheet (sheet scope).
 */
export async function tagPool(
  db: Kysely<Database>,
  projectId: string,
  sheetMembers: MemberView[],
  scope?: TagScope,
): Promise<MemberView[]> {
  const s = scope ?? (await tagScopeOf(db, projectId));
  return s === 'job' ? loadMemberViews(db, projectId) : sheetMembers;
}
