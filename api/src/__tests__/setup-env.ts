import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assertTestDatabaseUrl, deriveTestDatabaseUrl } from '../db/test-database.js';

// Runs in every test file before anything else: point DATABASE_URL at the TEST database only.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});
const real = process.env.DATABASE_URL;
if (real) {
  const test = deriveTestDatabaseUrl(real, process.env.TEST_DATABASE_URL);
  assertTestDatabaseUrl(test);
  process.env.DATABASE_URL = test;
}
