import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

let pool: pg.Pool | null = null;
let db: Kysely<Database> | null = null;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return url;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getDb(): Kysely<Database> {
  if (!db) {
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: getPool() }) });
  }
  return db;
}

export interface DbCheck {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkDatabaseConnection(): Promise<DbCheck> {
  const start = Date.now();
  try {
    await getPool().query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  // Kysely's destroy() ends the underlying pool.
  if (db) await db.destroy();
  else if (pool) await pool.end();
  db = null;
  pool = null;
}
