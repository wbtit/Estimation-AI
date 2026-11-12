import Fastify, { type FastifyInstance } from 'fastify';
import { countRoutes } from './routes/count.js';
import { buildRoutes } from './routes/build.js';
import { buildViewRoutes } from './routes/build-views.js';
import { perimeterAngleRoutes } from './routes/perimeter-angle.js';
import { columnHeightRoutes } from './routes/column-height.js';
import { reviewUiRoutes } from './routes/review-ui.js';
import { healthRoutes, type HealthRouteOptions } from './routes/health.js';
import { memberActionRoutes } from './routes/member-actions.js';
import { profileSearchRoutes } from './routes/profile-search.js';
import { projectDetailsRoutes } from './routes/project-details.js';
import { projectRoutes } from './routes/projects.js';
import { sessionRoutes } from './routes/sessions.js';
import { sheetRoutes } from './routes/sheets.js';
import { viewRoutes } from './routes/views.js';

export interface AppOptions {
  logger?: boolean;
  healthOptions?: HealthRouteOptions;
  /** Absolute upload directory (default: UPLOAD_DIR or <repo>/uploads). */
  uploadDir?: string;
  /** Upload size limit in bytes (default: 500 MB). */
  maxUploadBytes?: number;
}

// Builds the app without listening; server.ts is the only entry point that starts it.
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.register(healthRoutes, options.healthOptions ?? {});
  app.register(projectRoutes, {
    uploadDir: options.uploadDir,
    maxUploadBytes: options.maxUploadBytes,
  });
  app.register(sheetRoutes, { uploadDir: options.uploadDir });
  app.register(viewRoutes, { uploadDir: options.uploadDir });
  app.register(memberActionRoutes, {});
  app.register(profileSearchRoutes, {});
  app.register(projectDetailsRoutes, {});
  app.register(countRoutes, {});
  app.register(buildRoutes, {});
  app.register(buildViewRoutes, {});
  app.register(reviewUiRoutes, {});
  app.register(perimeterAngleRoutes, {});
  app.register(columnHeightRoutes, {});
  app.register(sessionRoutes, {});
  return app;
}
