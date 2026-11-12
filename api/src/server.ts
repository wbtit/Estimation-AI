// Explicit entry point for the API: `npm run dev` or `npm start` in api/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { resolveMaxUploadBytes, resolveUploadDir } from './config.js';
import { closeDatabaseConnection, getDb } from './db/client.js';
import { assertSchemaCurrent } from './db/schema-check.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp({
  logger: true,
  uploadDir: resolveUploadDir(process.env.UPLOAD_DIR),
  maxUploadBytes: resolveMaxUploadBytes(process.env.MAX_UPLOAD_BYTES),
});

async function shutdown(): Promise<void> {
  await app.close();
  await closeDatabaseConnection();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// refuse to run newer code on an older database (migration files vs schema_migrations)
try {
  await assertSchemaCurrent(getDb());
} catch (err) {
  console.error(`The database schema is out of date: ${(err as Error).message}`);
  await closeDatabaseConnection();
  process.exit(1);
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
