// The estimators' mark prefix -> kind of the scope-of-work list, per project (Phase 10, owner
// decision 124). Filled by a person (settings) or from the owner's file; empty by default. Used for
// the tag prefix of new count pieces of that kind, and for the kind of imported estimator markups.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { KindIndex } from './kinds.js';
import { logCountAction } from './count-log.js';

export interface PrefixKind {
  prefix: string;
  kind: string;
  set_by: string;
  set_at: string;
}

export const PREFIX_RE = /^[A-Z]{1,6}$/;

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

/**
 * The tag prefix of a kind in this project: the estimators' prefix mapped to it (the shortest, then
 * the first alphabetically, when several map to one kind), else null (the kind list's own prefix).
 */
export function prefixForKind(map: readonly PrefixKind[], kind: string): string | null {
  const mine = map.filter((m) => m.kind === kind).map((m) => m.prefix);
  if (mine.length === 0) return null;
  return [...mine].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] as string;
}

/** The kind of an estimator mark such as `B12` or `HR-3`, or null when its prefix is not mapped. */
export function kindForMark(map: readonly PrefixKind[], mark: string): string | null {
  const m = /^([A-Za-z]{1,6})[-\s]?\d+[A-Za-z]?$/.exec(mark.trim());
  if (!m) return null;
  const prefix = (m[1] as string).toUpperCase();
  return map.find((x) => x.prefix === prefix)?.kind ?? null;
}

export interface ParsedRow {
  line: number;
  prefix: string;
  kind: string;
  problem: string | null;
}

/**
 * The owner's file: a header `prefix,kind` and one row per prefix. Every row is checked (prefix of
 * one to six letters, kind on the list, a prefix only once); nothing is guessed or corrected beyond
 * trimming and upper-casing the prefix.
 */
export function parsePrefixCsv(text: string, kinds: KindIndex): ParsedRow[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const pi = header.indexOf('prefix');
  const ki = header.indexOf('kind');
  if (pi < 0 || ki < 0) throw new Error('the file needs a header with the columns prefix and kind');
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const cells = splitCsv(raw);
    const prefix = (cells[pi] ?? '').trim().toUpperCase();
    const kind = (cells[ki] ?? '').trim();
    let problem: string | null = null;
    if (!PREFIX_RE.test(prefix)) problem = 'prefix must be 1 to 6 letters';
    else if (!kinds.has(kind)) problem = 'kind is not on the scope-of-work list';
    else if (seen.has(prefix)) problem = 'prefix given twice';
    seen.add(prefix);
    out.push({ line: i + 2, prefix, kind, problem });
  });
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface PrefixChange {
  prefix: string;
  before: string | null;
  after: string;
}

/** What the file would change against the current mapping (rows without a problem only). */
export function importChanges(
  rows: readonly ParsedRow[],
  current: readonly PrefixKind[],
): PrefixChange[] {
  return rows
    .filter((r) => r.problem === null)
    .map((r) => ({
      prefix: r.prefix,
      before: current.find((c) => c.prefix === r.prefix)?.kind ?? null,
      after: r.kind,
    }))
    .filter((c) => c.before !== c.after);
}

/** Write the changes (one transaction) and one log row. */
export async function applyPrefixChanges(
  db: Kysely<Database>,
  projectId: string,
  who: string,
  changes: readonly PrefixChange[],
): Promise<void> {
  if (changes.length === 0) return;
  await db.transaction().execute(async (trx) => {
    for (const c of changes) {
      await trx
        .insertInto('project_prefix_kinds')
        .values({ project_id: projectId, prefix: c.prefix, kind: c.after, set_by: who })
        .onConflict((oc) =>
          oc
            .columns(['project_id', 'prefix'])
            .doUpdateSet({ kind: c.after, set_by: who, set_at: new Date() }),
        )
        .execute();
    }
    await logCountAction(trx, {
      projectId,
      action: 'prefix_map',
      who,
      detail: { import: true, changes },
    });
  });
}
