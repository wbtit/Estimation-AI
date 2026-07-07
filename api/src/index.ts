// Fallback .env loader for Node < 20.6 (no dotenv dep needed)
import { readFileSync } from 'fs';
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([^#\s][^=]*)=(.*)$/);
    if (m) (process.env as Record<string,string>)[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* .env is optional */ }

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { uploadRoutes } from './routes/upload.js';
import { jobRoutes }    from './routes/jobs.js';
import './workers/drawingWorker.js';  // starts the BullMQ worker in the same process

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = Fastify({ logger: { level: 'info' } });

await app.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024,  // 500 MB
  },
});

await app.register(uploadRoutes);
await app.register(jobRoutes);

app.get('/health', async () => ({ status: 'ok' }));

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[api] listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
