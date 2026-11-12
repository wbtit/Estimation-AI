// Startup check of the database schema version: the migration files of this checkout (db/migrations)
// against the rows of schema_migrations. A process that runs newer code on an older database refuses
// to start with a clear message, instead of failing jobs later with "UndefinedColumn" (Review 3,
// item 7). Read only. A database AHEAD of the code (a row with no file) is not an error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The migration files of this checkout (api/src/db -> repo root / db / migrations). */
export const MIGRATIONS_DIR = path.resolve(here, '../../../db/migrations');

const FILE = /^\d{3}_.+\.sql$/;

export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => FILE.test(f))
        .sort()
    : [];
}

/** The files that are not in `applied`, in order. */
export function missingFrom(files: readonly string[], applied: readonly string[]): string[] {
  const done = new Set(applied);
  return files.filter((f) => !done.has(f));
}

/** "migration 032 missing: run npm run migrate" (several: "migrations 032, 033 missing: ..."). */
export function schemaMessage(missing: readonly string[]): string {
  const nums = missing.map((f) => f.slice(0, 3));
  return `migration${nums.length === 1 ? '' : 's'} ${nums.join(', ')} missing: run npm run migrate`;
}

export async function missingMigrations(
  db: Kysely<Database>,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const files = migrationFiles(dir);
  let applied: string[] = [];
  try {
    const res = await sql<{ version: string }>`SELECT version FROM schema_migrations`.execute(db);
    applied = res.rows.map((r) => r.version);
  } catch {
    // no schema_migrations table at all: nothing is applied
  }
  return missingFrom(files, applied);
}

/** Throws an Error with the clear message when the database lacks a migration of this checkout. */
export async function assertSchemaCurrent(
  db: Kysely<Database>,
  dir: string = MIGRATIONS_DIR,
): Promise<void> {
  const missing = await missingMigrations(db, dir);
  if (missing.length > 0) throw new Error(schemaMessage(missing));
}

/** Development / watch mode (NODE_ENV=development, which `npm run dev` sets): a database that lacks
 * a migration is a loud warning, not a refusal, so a watcher that restarts on every file change
 * (a new migration file appears before `npm run migrate` ran) keeps the API up. Any other start
 * (npm start, production, no NODE_ENV) stays strict. The worker has its own check and stays strict
 * (it writes data). */
export const isDevelopment = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === 'development';

export type StartupSchemaResult =
  | { status: 'current' }
  | { status: 'warned'; missing: string[]; message: string }
  | { status: 'refused'; missing: string[]; message: string };

/** The startup decision: current, warn and continue (development), or refuse (everything else). */
export async function startupSchemaCheck(
  db: Kysely<Database>,
  env: NodeJS.ProcessEnv = process.env,
  dir: string = MIGRATIONS_DIR,
  log: (line: string) => void = (l) => console.error(l),
): Promise<StartupSchemaResult> {
  const missing = await missingMigrations(db, dir);
  if (missing.length === 0) return { status: 'current' };
  const message = schemaMessage(missing);
  if (isDevelopment(env)) {
    const bar = '!'.repeat(78);
    log(
      `${bar}\n!! WARNING (development mode): the database schema is out of date: ${message}\n` +
        `!! The API keeps running; requests that need the new columns or tables will fail until you run it.\n${bar}`,
    );
    return { status: 'warned', missing, message };
  }
  return { status: 'refused', missing, message };
}
