import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const drawingQueue = new Queue('drawing-pipeline', { connection });

async function queueBatch1() {
  const jobs = [
    { id: 'a2b1cd51-bf47-4dbf-88ca-60dabf23dbf0', filename: 'THOREAU.pdf' },
    { id: '9f85d00c-84f1-4e08-b827-64e578319d28', filename: 'VA MEDICAL CENTER.pdf' },
    { id: '35b90421-926d-40d5-9382-6795e0df6399', filename: 'STS RAPHAEL.pdf' }
  ];
  
  for (const job of jobs) {
    const file_path = `/home/user/swe/steel-platform/jobs/${job.id}/upload.pdf`;
    await db.query(`UPDATE jobs SET status = 'queued' WHERE id = $1`, [job.id]);
    await drawingQueue.add('process', { jobId: job.id, pdfPath: file_path }, { jobId: job.id + "-" + Date.now() });
    console.log(`Queued ${job.filename}`);
  }
  process.exit(0);
}
queueBatch1().catch(console.error);
