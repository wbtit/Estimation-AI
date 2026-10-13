// Loads the owner's tag abbreviations into member_kinds from a CSV (header: kind,abbreviation).
//   npm run kinds:load-abbreviations -- --file <path.csv>
// No migration: the abbreviation column is filled in place. The whole file is refused if any row is
// wrong. A kind that is not in the file keeps its provisional prefix. Existing tags are not renamed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { parseAbbreviationCsv } from '../review/kinds.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) {
    console.error('usage: npm run kinds:load-abbreviations -- --file <path.csv>');
    return 1;
  }
  const db = getDb();
  const kinds = new Set(
    (await db.selectFrom('member_kinds').select('kind').execute()).map((k) => k.kind),
  );
  const { rows, errors } = parseAbbreviationCsv(fs.readFileSync(values.file, 'utf8'), kinds);
  if (errors.length > 0) {
    console.error(`refusing to load: ${errors.length} problem(s)`);
    for (const e of errors.slice(0, 50)) console.error(`  ${e}`);
    return 1;
  }
  // the tag prefixes of all kinds (loaded or provisional) must stay different from each other
  const all = await db
    .selectFrom('member_kinds')
    .select(['kind', 'abbreviation', 'provisional_prefix'])
    .execute();
  const loaded = new Map(rows.map((r) => [r.kind, r.abbreviation]));
  const owner = new Map<string, string>();
  for (const k of all) {
    const prefix = loaded.get(k.kind) ?? k.abbreviation ?? k.provisional_prefix;
    const other = owner.get(prefix);
    if (other) {
      console.error(`refusing to load: "${k.kind}" and "${other}" would share one tag prefix`);
      return 1;
    }
    owner.set(prefix, k.kind);
  }
  await db.transaction().execute(async (trx) => {
    for (const r of rows) {
      await trx
        .updateTable('member_kinds')
        .set({ abbreviation: r.abbreviation })
        .where('kind', '=', r.kind)
        .execute();
    }
  });
  console.log(`loaded ${rows.length} abbreviation(s)`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
