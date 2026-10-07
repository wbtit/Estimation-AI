// Applies numbered plain-SQL migrations from db/migrations in filename order.
// Each file runs in its own transaction and is recorded in schema_migrations.
// Run explicitly: `npm run migrate` (reads DATABASE_URL from the root .env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');
const MIGRATION_LOCK_ID = 7_420_001; // advisory lock so two runs cannot interleave

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d{3}_.+\.sql$/.test(f))
      .sort();
    const done = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );

    for (const file of files) {
      if (done.has(file)) {
        console.log(`skip    ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      console.log(`applied ${file}`);
    }
    console.log(`migrations done: ${applied.length} applied, ${files.length} total`);
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ path: path.join(here, '..', '.env') });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  runMigrations(url).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
