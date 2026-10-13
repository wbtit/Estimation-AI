// Member kinds (the estimators' scope list) as the review screen uses them. The table member_kinds
// is the one list: the 21 main kinds, the 12 misc kinds (reserved) and the 3 excluded kinds. The
// tag prefix of a kind is the owner's abbreviation when it has been loaded, otherwise a provisional
// prefix derived from the kind name (flagged PREFIX_PROVISIONAL). Nothing here is typed per kind.
import type { Kysely } from 'kysely';
import type { Database, KindScope, SymbolGroup } from '../db/types.js';
import type { MemberType } from '../contract/index.js';

export interface KindInfo {
  kind: string;
  scope: KindScope;
  symbol_group: SymbolGroup;
  sort: number;
  /** The tag prefix: the owner's abbreviation, else the provisional one. */
  prefix: string;
  provisional: boolean;
}

export type KindIndex = ReadonlyMap<string, KindInfo>;

export async function loadKinds(db: Kysely<Database>): Promise<KindIndex> {
  const rows = await db.selectFrom('member_kinds').selectAll().orderBy('sort').execute();
  return new Map(
    rows.map((r) => [
      r.kind,
      {
        kind: r.kind,
        scope: r.scope,
        symbol_group: r.symbol_group,
        sort: r.sort,
        prefix: r.abbreviation ?? r.provisional_prefix,
        provisional: r.abbreviation === null,
      } satisfies KindInfo,
    ]),
  );
}

const BRACE_KINDS = new Set(['Horizontal Brace', 'Vertical Brace', 'Kicker/Knee Brace']);

/**
 * `members.type` stays for compatibility and follows the kind where one exists: columns and posts
 * are columns, the brace kinds are braces, a joist is a joist, other linear kinds are beams, the
 * rest is other. Without a kind the stored type is kept.
 */
export function typeOfKind(info: KindInfo | undefined, stored: MemberType): MemberType {
  if (!info) return stored;
  if (info.kind === 'Joist') return 'joist';
  if (info.symbol_group === 'column') return 'column';
  if (BRACE_KINDS.has(info.kind)) return 'brace';
  if (info.symbol_group === 'linear') return 'beam';
  return 'other';
}

/** How the piece is counted: main kinds count; misc is reserved; excluded kinds are listed apart. */
export type Counting = 'counted' | 'misc_reserved' | 'not_counted';

export function countingOf(info: KindInfo | undefined): Counting {
  if (!info) return 'counted'; // no kind yet: a piece to be classified, counted in "no kind"
  return info.scope === 'main'
    ? 'counted'
    : info.scope === 'misc'
      ? 'misc_reserved'
      : 'not_counted';
}

/** Parses a CSV of owner abbreviations: header `kind,abbreviation`, one kind per row. */
export function parseAbbreviationCsv(
  text: string,
  known: ReadonlySet<string>,
): { rows: { kind: string; abbreviation: string }[]; errors: string[] } {
  const errors: string[] = [];
  const rows: { kind: string; abbreviation: string }[] = [];
  const lines = text
    .replace(/^\u{FEFF}/u, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split(',').map((c) => c.trim().toLowerCase());
  if (header[0] !== 'kind' || header[1] !== 'abbreviation') {
    return { rows, errors: ['the first row must be: kind,abbreviation'] };
  }
  const seenKind = new Set<string>();
  const seenAbbr = new Map<string, string>();
  lines.slice(1).forEach((line, i) => {
    const m = /^("([^"]*)"|[^,]*),(.*)$/.exec(line);
    const kind = (m ? (m[2] ?? m[1]) : line).trim();
    const abbreviation = (m ? m[3] : '').trim().replace(/^"|"$/g, '');
    const row = i + 2;
    if (!known.has(kind)) errors.push(`row ${row}: unknown kind "${kind}"`);
    else if (seenKind.has(kind)) errors.push(`row ${row}: kind "${kind}" appears twice`);
    else if (abbreviation === '') errors.push(`row ${row}: empty abbreviation for "${kind}"`);
    else if (!/^[A-Za-z0-9-]{1,8}$/.test(abbreviation))
      errors.push(`row ${row}: abbreviation for "${kind}" must be 1 to 8 letters, digits or -`);
    else if (seenAbbr.has(abbreviation.toUpperCase()))
      errors.push(
        `row ${row}: abbreviation of "${kind}" repeats that of "${seenAbbr.get(abbreviation.toUpperCase())}"`,
      );
    else {
      seenKind.add(kind);
      seenAbbr.set(abbreviation.toUpperCase(), kind);
      rows.push({ kind, abbreviation: abbreviation.toUpperCase() });
    }
  });
  return { rows, errors };
}
