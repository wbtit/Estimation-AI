// Phase 0-column-capture: read the orientation of existing columns (see review/orientation-backfill.ts).
//   npm run orientation:backfill -- --project <id> [--page N] [--json out.json]            dry run (read-only)
//   npm run orientation:backfill -- --project <id> [--page N] --apply                      fill empty values
// The dry run cannot write. Prints ids and counts only (no names).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../db/types.js';
import {
  applyOrientationBackfill,
  planOrientationBackfill,
  planOrientationPoints,
} from '../review/orientation-backfill.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      page: { type: 'string' },
      json: { type: 'string' },
      // a dry run on positions of a page with no placed columns: --points <json {points}> --sheet <id> --ratio <n>
      points: { type: 'string' },
      sheet: { type: 'string' },
      ratio: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (values.points) {
    if (!values.sheet || !values.ratio) {
      console.error('--points needs --sheet <id> and --ratio <n>');
      return 1;
    }
    const pool0 = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      options: '-c default_transaction_read_only=on',
      max: 1,
    });
    const db0 = new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool0 }) });
    try {
      const pts = (
        JSON.parse(fs.readFileSync(values.points, 'utf8')) as { points: [number, number][] }
      ).points;
      const rows = await planOrientationPoints(db0, values.sheet, pts, Number(values.ratio));
      const n = (st: string) => rows.filter((r) => r.reading.state === st).length;
      console.log(
        `positions ${rows.length} | clear ${n('clear')} | unsure ${n('unsure')} | none ${n('none')} | refined ${rows.filter((r) => r.refined_in !== null).length}`,
      );
      if (values.json) fs.writeFileSync(values.json, JSON.stringify(rows, null, 1));
      return 0;
    } finally {
      await db0.destroy();
    }
  }
  if (!values.project) {
    console.error(
      'usage: npm run orientation:backfill -- --project <id> [--page N] [--json out] [--apply]',
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
    const t0 = Date.now();
    const rows = await planOrientationBackfill(db, values.project, {
      pageIndex: values.page ? Number(values.page) - 1 : undefined,
    });
    const ms = Date.now() - t0;
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
    console.log(
      `columns ${rows.length} | already set ${count((r) => r.orientation_deg !== null)} | read clear ${count((r) => r.reading.state === 'clear')} | unsure ${count((r) => r.reading.state === 'unsure')} | none ${count((r) => r.reading.deg === null)} | plan took ${ms} ms`,
    );
    if (values.json) fs.writeFileSync(values.json, JSON.stringify(rows, null, 1));
    if (values.apply)
      console.log(`filled ${await applyOrientationBackfill(db, values.project, rows)} columns`);
    else console.log('dry run: nothing written (add --apply to fill the empty orientations)');
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
