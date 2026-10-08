import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabaseConnection, databaseUrl, getDb } from '../db/client.js';
import {
  assertTestDatabaseUrl,
  databaseName,
  deriveTestDatabaseUrl,
  isTestDatabaseUrl,
} from '../db/test-database.js';
import { sql } from 'kysely';

const REAL = 'postgresql://someone@localhost:5432/estimation_ai'; // no password: a URL with one trips the secret scanner

describe('test database isolation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives a separate test database from the real one', () => {
    const test = deriveTestDatabaseUrl(REAL);
    expect(databaseName(test)).toBe('estimation_ai_test');
    expect(databaseName(REAL)).toBe('estimation_ai');
    expect(new URL(test).host).toBe(new URL(REAL).host);
    expect(deriveTestDatabaseUrl(test)).toBe(test); // idempotent
  });

  it('refuses a URL that is not a test database', () => {
    expect(isTestDatabaseUrl(REAL)).toBe(false);
    expect(() => assertTestDatabaseUrl(REAL)).toThrow(/must end with "_test"/);
    expect(() => deriveTestDatabaseUrl(REAL, REAL)).toThrow(/must end with "_test"/);
  });

  it('the error message never contains the connection URL', () => {
    try {
      assertTestDatabaseUrl(REAL);
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('someone');
      expect(String((err as Error).message)).not.toContain('postgresql://');
    }
  });

  it('the database client fails loudly if DATABASE_URL points at the real database', () => {
    vi.stubEnv('DATABASE_URL', REAL);
    expect(() => databaseUrl()).toThrow(/refusing to run tests against database "estimation_ai"/);
  });

  it('the tests really run against the test database', async () => {
    const res = await sql<{ name: string }>`SELECT current_database() AS name`.execute(getDb());
    expect(res.rows[0].name.endsWith('_test')).toBe(true);
    await closeDatabaseConnection();
  });
});
