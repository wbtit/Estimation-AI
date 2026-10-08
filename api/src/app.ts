import Fastify, { type FastifyInstance } from 'fastify';
import { bomRoutes, type BomRouteOptions } from './routes/bom.js';
import { healthRoutes, type HealthRouteOptions } from './routes/health.js';
import { memberActionRoutes } from './routes/member-actions.js';
import { memberRoutes } from './routes/members.js';
import { projectRoutes } from './routes/projects.js';
import { reviewRoutes } from './routes/review.js';
import { sheetRoutes } from './routes/sheets.js';
import { textItemRoutes } from './routes/text-items.js';
import { viewRoutes } from './routes/views.js';

export interface AppOptions {
  logger?: boolean;
  healthOptions?: HealthRouteOptions;
  bomOptions?: BomRouteOptions;
  /** Absolute upload directory (default: UPLOAD_DIR or <repo>/uploads). */
  uploadDir?: string;
  /** Upload size limit in bytes (default: 500 MB). */
  maxUploadBytes?: number;
}

// Builds the app without listening; server.ts is the only entry point that starts it.
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.register(healthRoutes, options.healthOptions ?? {});
  app.register(bomRoutes, options.bomOptions ?? {});
  app.register(projectRoutes, {
    uploadDir: options.uploadDir,
    maxUploadBytes: options.maxUploadBytes,
  });
  app.register(sheetRoutes, { uploadDir: options.uploadDir });
  app.register(textItemRoutes, {});
  app.register(viewRoutes, { uploadDir: options.uploadDir });
  app.register(reviewRoutes, {});
  app.register(memberRoutes, {});
  app.register(memberActionRoutes, {});
  return app;
}
