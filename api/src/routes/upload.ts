import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { db } from '../db/client.js';
import { drawingQueue } from '../workers/drawingWorker.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), '..', 'jobs');

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/api/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }
    if (!data.filename.toLowerCase().endsWith('.pdf')) {
      data.file.resume();
      return reply.code(400).send({ error: 'Only PDF files are accepted' });
    }

    const jobId   = randomUUID();
    const jobDir  = path.join(UPLOAD_DIR, jobId);
    const filePath = path.join(jobDir, 'upload.pdf');

    fs.mkdirSync(jobDir, { recursive: true });
    await pipeline(data.file, fs.createWriteStream(filePath));

    await db.query(
      `INSERT INTO jobs (id, filename, file_path, status)
       VALUES ($1, $2, $3, 'queued')`,
      [jobId, data.filename, filePath],
    );

    await drawingQueue.add('process', { jobId, pdfPath: filePath }, { jobId });

    return reply.code(202).send({
      jobId,
      status:   'queued',
      filename: data.filename,
    });
  });
}
