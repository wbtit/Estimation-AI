import Fastify, { type FastifyInstance } from 'fastify';
import { bomRoutes, type BomRouteOptions } from './routes/bom.js';
import { healthRoutes, type HealthRouteOptions } from './routes/health.js';

export interface AppOptions {
  logger?: boolean;
  healthOptions?: HealthRouteOptions;
  bomOptions?: BomRouteOptions;
}

// Builds the app without listening; server.ts is the only entry point that starts it.
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.register(healthRoutes, options.healthOptions ?? {});
  app.register(bomRoutes, options.bomOptions ?? {});
  return app;
}
