// Loads the owner's estimator mark prefixes -> kinds for ONE project (Phase 10, decision 124).
//   npm run prefixes:load -- --project <id> [--file <path.csv>] [--who <name>] [--apply]
// Default file: fixtures/private/review/prefix_meanings.csv (header: prefix,kind). Without --apply it
// is a preview (counts only, nothing written). The whole file is refused if any row has a problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { loadKinds } from '../review/kinds.js';
import {
  applyPrefixChanges,
  importChanges,
  loadPrefixKinds,
  parsePrefixCsv,
} from '../review/prefix-kinds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      file: { type: 'string' },
      who: { type: 'string' },
      apply: { type: 'boolean' },
    },
  });
  if (!values.project) {
    console.error('usage: npm run prefixes:load -- --project <id> [--file <csv>] [--apply]');
    return 1;
  }
  const file = values.file ?? path.join(root, 'fixtures/private/review/prefix_meanings.csv');
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ skipped: true, reason: 'prefix file not found' }));
    return 0;
  }
  const db = getDb();
  const rows = parsePrefixCsv(fs.readFileSync(file, 'utf8'), await loadKinds(db));
  const problems = rows.filter((r) => r.problem !== null);
  const changes = importChanges(rows, await loadPrefixKinds(db, values.project));
  const summary = {
    rows: rows.length,
    problems: problems.map((p) => ({ line: p.line, problem: p.problem })),
    changes: changes.length,
    applied: false,
  };
  if (values.apply && problems.length === 0) {
    await applyPrefixChanges(db, values.project, values.who ?? 'owner file', changes);
    summary.applied = true;
  }
  console.log(JSON.stringify(summary));
  return problems.length > 0 && values.apply ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDatabaseConnection();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabaseConnection();
    process.exit(1);
  });
