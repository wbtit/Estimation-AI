// Profile from callout: the owner's corrected final profiles of ONE page, the truth of the
// profile measurement (worker/measure/profile_measure.py --truth).
//   npx tsx src/scripts/export-profiles.ts <sheet id prefix> <out json>
// READ-ONLY on the database (default_transaction_read_only). Final pieces (columns, beams, braces
// that are not deleted, ignored, an excluded kind or a duplicate) with the person-corrected
// profile (`profile`), the profile the system first stored (`stored_profile`: for a Find similar
// match that is the example's profile) and its position in displayed page points. Prints ids and
// counts only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from '../db/types.js';
import { loadPieces } from '../review/line-first-pieces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const [prefix, out] = process.argv.slice(2);
  if (!prefix || !out) {
    console.error('usage: tsx src/scripts/export-profiles.ts <sheet id prefix> <out json>');
    return 1;
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c default_transaction_read_only=on',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  try {
    const sheet = await db
      .selectFrom('sheets')
      .select(['id', 'project_id'])
      .where(sql<boolean>`id::text LIKE ${prefix + '%'}`)
      .executeTakeFirstOrThrow();
    const pieces = await loadPieces(db, sheet.project_id, { sheetId: sheet.id });
    const kept = pieces.filter(
      (p) =>
        ['column', 'beam', 'brace'].includes(p.type) &&
        !p.deleted &&
        !p.ignored &&
        !p.excluded_kind &&
        p.duplicate_of === null &&
        p.a !== null,
    );
    const stored = new Map(
      (
        await db
          .selectFrom('members')
          .select(['id', 'profile', 'origin', 'symbol_source'])
          .where('sheet_id', '=', sheet.id)
          .execute()
      ).map((r) => [r.id, r]),
    );
    const rows = kept.map((p) => ({
      id: p.id.slice(0, 8),
      type: p.type,
      a: [p.a![0], p.a![1]],
      b: p.b ? [p.b[0], p.b[1]] : null,
      profile: p.profile,
      stored_profile: stored.get(p.id)?.profile ?? null,
      origin: stored.get(p.id)?.origin ?? null,
      symbol_source: stored.get(p.id)?.symbol_source ?? null,
      view: p.build_view_id,
    }));
    fs.writeFileSync(out, JSON.stringify(rows));
    const by = (t: string) => rows.filter((r) => r.type === t).length;
    console.log(
      `sheet ${sheet.id.slice(0, 8)}: ${pieces.length} pieces, ${rows.length} exported ` +
        `(${by('column')} columns, ${by('beam')} beams, ${by('brace')} braces)`,
    );
    return 0;
  } finally {
    await db.destroy();
  }
}

main().then((c) => process.exit(c));
