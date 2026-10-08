import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { deriveTestDatabaseUrl, ensureTestDatabase } from '../db/test-database.js';

// Runs once before the test files: make sure the separate test database exists and is migrated.
export default async function setup(): Promise<void> {
  dotenv.config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
  });
  const real = process.env.DATABASE_URL;
  if (!real) throw new Error('DATABASE_URL is not set (see .env.example).');
  await ensureTestDatabase(deriveTestDatabaseUrl(real, process.env.TEST_DATABASE_URL));
}
