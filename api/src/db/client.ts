import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://admin:secret@localhost:5432/structural_db';

export const db = new Pool({ connectionString: DATABASE_URL });

db.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});
