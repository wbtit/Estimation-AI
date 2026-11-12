// Review 4: the owner's corrected final pieces of ONE page as page-point segments, the truth of a
// double-line measurement (worker/measure/double_line_measure.py --truth).
//   npx tsx src/scripts/export-truth.ts <sheet id prefix> <out json>
// READ-ONLY on the database (default_transaction_read_only). Pieces as the BOM counts them: beams and
// braces that are not deleted, ignored, an excluded kind or a duplicate. Writes {a, b, type, kind}
// per piece in displayed page points; prints ids and counts only.
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
    console.error('usage: tsx src/scripts/export-truth.ts <sheet id prefix> <out json>');
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
        (p.type === 'beam' || p.type === 'brace') &&
        !p.deleted &&
        !p.ignored &&
        !p.excluded_kind &&
        p.duplicate_of === null &&
        p.a !== null &&
        p.b !== null,
    );
    const rows = kept.map((p) => ({
      a: [p.a![0], p.a![1]],
      b: [p.b![0], p.b![1]],
      type: p.type,
      kind: p.kind,
    }));
    fs.writeFileSync(out, JSON.stringify(rows));
    console.log(
      `sheet ${sheet.id.slice(0, 8)}: ${pieces.length} pieces, ${rows.length} beams/braces exported`,
    );
    return 0;
  } finally {
    await db.destroy();
  }
}

process.exit(await main());
