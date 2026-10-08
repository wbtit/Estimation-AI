// Test database isolation. Tests never use the real database: the URL is derived from
// DATABASE_URL by appending "_test" to the database name (or taken from TEST_DATABASE_URL), the
// name must end with "_test", and the API's database client refuses any other name under vitest.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const TEST_SUFFIX = '_test';

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function isTestDatabaseUrl(url: string): boolean {
  return databaseName(url).endsWith(TEST_SUFFIX);
}

/** Throws unless the database name ends with "_test". The message never contains the URL. */
export function assertTestDatabaseUrl(url: string): void {
  if (!isTestDatabaseUrl(url)) {
    throw new Error(
      `refusing to run tests against database "${databaseName(url)}": a test database name must end with "${TEST_SUFFIX}". ` +
        'Run `make test-db` and let the test setup derive the URL (do not point DATABASE_URL at the real database).',
    );
  }
}

/** The test URL for a real database URL: same server and user, database name + "_test". */
export function deriveTestDatabaseUrl(realUrl: string, explicit?: string): string {
  if (explicit && explicit !== '') {
    assertTestDatabaseUrl(explicit);
    return explicit;
  }
  if (isTestDatabaseUrl(realUrl)) return realUrl;
  const u = new URL(realUrl);
  u.pathname = `/${databaseName(realUrl)}${TEST_SUFFIX}`;
  return u.toString();
}

/** Creates the test database if it is missing and applies all migrations to it. */
export async function ensureTestDatabase(testUrl: string): Promise<void> {
  assertTestDatabaseUrl(testUrl);
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const name = databaseName(testUrl);
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const run = spawnSync('npx', ['tsx', 'db/migrate.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error(
      `migrating the test database failed: ${(run.stderr || run.stdout).slice(0, 400)}`,
    );
  }
}
