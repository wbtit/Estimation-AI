// The estimators' mark prefix -> kind of the scope-of-work list, per project (Phase 10, owner
// decision 124). Filled by a person (settings) or from the owner's file; empty by default. Used for
// the tag prefix of new count pieces of that kind, and for the kind of imported estimator markups.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export interface PrefixKind {
  prefix: string;
  kind: string;
  set_by: string;
  set_at: string;
}

export async function loadPrefixKinds(
  db: Kysely<Database>,
  projectId: string,
): Promise<PrefixKind[]> {
  const rows = await db
    .selectFrom('project_prefix_kinds')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('prefix')
    .execute();
  return rows.map((r) => ({
    prefix: r.prefix,
    kind: r.kind,
    set_by: r.set_by,
    set_at: new Date(r.set_at as unknown as string).toISOString(),
  }));
}
