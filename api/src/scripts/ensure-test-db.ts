// Creates (if missing) and migrates the separate test database. Run: npm run test-db
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { databaseName, deriveTestDatabaseUrl, ensureTestDatabase } from '../db/test-database.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const real = process.env.DATABASE_URL;
if (!real) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const test = deriveTestDatabaseUrl(real, process.env.TEST_DATABASE_URL);
ensureTestDatabase(test)
  .then(() => console.log(`test database ready: ${databaseName(test)}`))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
