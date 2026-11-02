// Phase 14f: one-off backfill of page lines for projects created before auto mode made them.
//   npm run lines:backfill -- --project <id> [--project <id> ...]           dry run (read-only)
//   npm run lines:backfill -- --project <id> [--project <id> ...] --apply   queue the jobs
// Only projects whose purpose is 'real' are accepted. Prints ids and counts only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../db/types.js';
import { applyBackfill, planBackfill } from '../review/lines-backfill.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string', multiple: true },
      apply: { type: 'boolean', default: false },
    },
  });
  const ids = values.project ?? [];
  if (ids.length === 0) {
    console.error('usage: npm run lines:backfill -- --project <id> [--project <id> ...] [--apply]');
    return 1;
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // the dry run cannot write
    ...(values.apply ? {} : { options: '-c default_transaction_read_only=on' }),
    max: 2,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  try {
    const plan = await planBackfill(db, ids);
    for (const r of plan.refused) console.log(`refused ${r.id}: ${r.reason}`);
    for (const p of plan.projects)
      console.log(
        `project ${p.id}: ${p.vector_pages} vector pages, ${p.with_lines} with lines,` +
          ` ${p.open_jobs} already queued, ${p.to_queue.length} to queue`,
      );
    const total = plan.projects.reduce((n, p) => n + p.to_queue.length, 0);
    if (!values.apply) {
      console.log(`dry run: ${total} sheet_lines jobs would be queued (nothing written)`);
      return plan.refused.length ? 2 : 0;
    }
    if (plan.refused.length) {
      console.error('not applied: a project was refused');
      return 2;
    }
    const jobs = await applyBackfill(db, plan);
    console.log(`applied: ${jobs.length} sheet_lines jobs queued`);
    return 0;
  } finally {
    await db.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
