import type { FastifyPluginAsync } from 'fastify';
import { checkDatabaseConnection, type DbCheck } from '../db/client.js';

export interface HealthRouteOptions {
  checkDb?: () => Promise<DbCheck>;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, options) => {
  const checkDb = options.checkDb ?? checkDatabaseConnection;

  app.get('/health', async (request, reply) => {
    const db = await checkDb();
    const timestamp = new Date().toISOString();
    if (!db.ok) {
      // Details go to the log, not to the client.
      request.log.error({ err: db.error }, 'health: database check failed');
      return reply.status(503).send({ status: 'error', db: 'disconnected', timestamp });
    }
    return { status: 'ok', db: 'connected', latencyMs: db.latencyMs, timestamp };
  });
};
