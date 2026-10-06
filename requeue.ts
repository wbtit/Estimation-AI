import { db } from './api/src/db/client.js';
import { drawingQueue } from './api/src/workers/drawingWorker.js';

async function requeue() {
  const result = await db.query("SELECT id, file_path FROM jobs WHERE status = 'queued'");
  for (const row of result.rows) {
    console.log(`Re-queuing ${row.id}`);
    await drawingQueue.add('process', { jobId: row.id, pdfPath: row.file_path }, { jobId: row.id + '-retry' });
  }
  process.exit(0);
}

requeue().catch(console.error);
