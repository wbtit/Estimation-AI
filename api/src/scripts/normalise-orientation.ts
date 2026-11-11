// Phase 0 column capture: preview (and, only with --apply, make) the normalisation of near-axis
// manual orientations (see review/orientation-normalise.ts). The preview cannot write.
//   npm run orientation:normalise -- --project <id> [--page N]            preview (read-only)
//   npm run orientation:normalise -- --project <id> [--page N] --apply --who <name>   one undoable action
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../db/types.js';
import { applyNormalise, planNormalise } from '../review/orientation-normalise.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      page: { type: 'string' },
      who: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.project || (values.apply && !values.who)) {
    console.error(
      'usage: npm run orientation:normalise -- --project <id> [--page N] [--apply --who <name>]',
    );
    return 1;
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ...(values.apply ? {} : { options: '-c default_transaction_read_only=on' }),
    max: 2,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  try {
    const rows = await planNormalise(db, values.project, {
      pageIndex: values.page ? Number(values.page) - 1 : undefined,
    });
    for (const r of rows)
      console.log(
        `page ${r.page} ${r.tag ?? r.id.slice(0, 8)} (${r.family}): ${r.from} -> ${r.to}`,
      );
    console.log(`${rows.length} orientation(s) would change`);
    if (values.apply)
      console.log(`applied ${await applyNormalise(db, values.project, rows, values.who!)}`);
    else
      console.log(
        'preview: nothing written (add --apply --who <name> to make them one undoable action)',
      );
    return 0;
  } finally {
    await db.destroy();
  }
}
main().then(
  (c) => process.exit(c),
  (e: Error) => {
    console.error(e.message);
    process.exit(1);
  },
);
