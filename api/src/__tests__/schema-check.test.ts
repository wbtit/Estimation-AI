// Startup schema check (pure parts, and against the test database, which tests migrate).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import {
  assertSchemaCurrent,
  isDevelopment,
  startupSchemaCheck,
  migrationFiles,
  missingFrom,
  missingMigrations,
  schemaMessage,
} from '../db/schema-check.js';

afterAll(async () => {
  await closeDatabaseConnection();
});

describe('schema check', () => {
  it('names the missing migrations and the command to run', () => {
    expect(schemaMessage(['032_perimeter_angle.sql'])).toBe(
      'migration 032 missing: run npm run migrate',
    );
    expect(schemaMessage(['032_a.sql', '033_b.sql'])).toBe(
      'migrations 032, 033 missing: run npm run migrate',
    );
  });

  it('missing = the files without a schema_migrations row, in order; a database ahead is fine', () => {
    const files = ['030_a.sql', '031_b.sql', '032_c.sql'];
    expect(missingFrom(files, ['030_a.sql'])).toEqual(['031_b.sql', '032_c.sql']);
    expect(missingFrom(files, [...files, '099_future.sql'])).toEqual([]);
  });

  it('reads the migration files of a folder (only NNN_name.sql)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of ['002_b.sql', '001_a.sql', 'README.md', 'x.sql'])
      fs.writeFileSync(path.join(dir, f), '');
    expect(migrationFiles(dir)).toEqual(['001_a.sql', '002_b.sql']);
    fs.rmSync(dir, { recursive: true });
    expect(migrationFiles(dir)).toEqual([]); // no folder: nothing to check
  });

  it('the test database has every migration of this checkout; a fake newer file is refused', async () => {
    expect(await missingMigrations(getDb())).toEqual([]);
    await assertSchemaCurrent(getDb());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '999_not_applied.sql'), '');
    await expect(assertSchemaCurrent(getDb(), dir)).rejects.toThrow(
      'migration 999 missing: run npm run migrate',
    );
    fs.rmSync(dir, { recursive: true });
  });
});

describe('startup decision: warn in development, refuse otherwise', () => {
  // a folder whose newest migration file the database lacks (the watcher saw a new file)
  const ahead = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '001_initial_schema.sql'), '');
    fs.writeFileSync(path.join(dir, '999_not_applied_yet.sql'), '');
    return dir;
  };

  it('only NODE_ENV=development counts as development', () => {
    expect(isDevelopment({ NODE_ENV: 'development' })).toBe(true);
    expect(isDevelopment({ NODE_ENV: 'production' })).toBe(false);
    expect(isDevelopment({})).toBe(false);
  });

  it('development: a loud warning, no refusal', async () => {
    const dir = ahead();
    const lines: string[] = [];
    const r = await startupSchemaCheck(getDb(), { NODE_ENV: 'development' }, dir, (l) =>
      lines.push(l),
    );
    expect(r.status).toBe('warned');
    expect(r).toMatchObject({ missing: ['999_not_applied_yet.sql'] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WARNING');
    expect(lines[0]).toContain('migration 999 missing: run npm run migrate');
    fs.rmSync(dir, { recursive: true });
  });

  it('a normal or production start refuses (same message, nothing logged here)', async () => {
    const dir = ahead();
    for (const env of [{}, { NODE_ENV: 'production' }]) {
      const lines: string[] = [];
      const r = await startupSchemaCheck(getDb(), env, dir, (l) => lines.push(l));
      expect(r.status).toBe('refused');
      expect(r).toMatchObject({ message: 'migration 999 missing: run npm run migrate' });
      expect(lines).toHaveLength(0);
    }
    fs.rmSync(dir, { recursive: true });
  });

  it('a current database is current in both modes; assertSchemaCurrent itself stays strict', async () => {
    for (const env of [{}, { NODE_ENV: 'development' }])
      expect((await startupSchemaCheck(getDb(), env)).status).toBe('current');
    const dir = ahead();
    await expect(assertSchemaCurrent(getDb(), dir)).rejects.toThrow(/migration 999 missing/);
    fs.rmSync(dir, { recursive: true });
  });
});
