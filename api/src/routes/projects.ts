// Projects and PDF upload.
//   POST /api/projects                 create a project (status is set by the server)
//   GET  /api/projects                 list
//   GET  /api/projects/:projectId      get, with the uploaded document and scan progress
//   PATCH /api/projects/:projectId     { stage?, archived? } the estimator's status (Estimating,
//                                      Submitted, Won, Lost); archived hides it from the list
//   POST /api/projects/:projectId/pdf  upload the project's one PDF (multipart, streamed to disk)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import type { Kysely } from 'kysely';
import { DEFAULT_MAX_UPLOAD_BYTES, resolveUploadDir } from '../config.js';
import { getDb } from '../db/client.js';
import type { Database, ProjectStage } from '../db/types.js';
import { NotPdfError, receivePdf, TooLargeError } from '../uploads/receive.js';
import { sanitizeFilename } from '../uploads/filename.js';
import { projectView } from '../views.js';
import { HttpError } from './http-error.js';

export interface ProjectRouteOptions {
  db?: Kysely<Database>;
  /** Absolute directory for uploads and thumbnails. Default: UPLOAD_DIR or <repo>/uploads. */
  uploadDir?: string;
  /** Default: 500 MB. */
  maxUploadBytes?: number;
}

const idParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const;

export const PROJECT_STAGES = ['Estimating', 'Submitted', 'Won', 'Lost'] as const;

const createBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    number: { type: ['string', 'null'], maxLength: 100 },
    location: { type: ['string', 'null'], maxLength: 200 },
    design_standard: { type: 'string', minLength: 1, maxLength: 50 },
    unit_system: { type: 'string', enum: ['mm'] },
    stage: { enum: [...PROJECT_STAGES] },
  },
} as const;

const patchBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: { stage: { enum: [...PROJECT_STAGES] }, archived: { type: 'boolean' } },
} as const;

interface CreateBody {
  name: string;
  number?: string | null;
  location?: string | null;
  design_standard?: string;
  unit_system?: 'mm';
  stage?: ProjectStage;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();
  const uploadDir = options.uploadDir ?? resolveUploadDir(process.env.UPLOAD_DIR);
  const maxBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  await app.register(multipart, { limits: { fileSize: maxBytes, files: 1, fields: 0 } });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadProject(projectId: string) {
    const project = await db()
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw new HttpError(404, { error: 'project not found' });
    return project;
  }

  async function loadFile(projectId: string) {
    return (
      (await db()
        .selectFrom('project_files')
        .selectAll()
        .where('project_id', '=', projectId)
        .executeTakeFirst()) ?? null
    );
  }

  app.post<{ Body: CreateBody }>(
    '/api/projects',
    { schema: { body: createBody } },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (name === '') throw new HttpError(400, { error: 'name must not be blank' });
      const project = await db()
        .insertInto('projects')
        .values({
          name,
          number: request.body.number?.trim() || null,
          location: request.body.location?.trim() || null,
          status: 'created',
          design_standard: request.body.design_standard?.trim() || 'AISC',
          unit_system: request.body.unit_system ?? 'mm',
          stage: request.body.stage ?? 'Estimating',
          drawing_issue: null,
          grids: '[]',
          levels: '[]',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return reply.status(201).send(projectView(project, null));
    },
  );

  app.get('/api/projects', async () => {
    const projects = await db()
      .selectFrom('projects')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
    const files = await db().selectFrom('project_files').selectAll().execute();
    const byProject = new Map(files.map((f) => [f.project_id, f]));
    // the card picture: the first page's thumbnail
    const firsts = await db()
      .selectFrom('sheets')
      .select(['id', 'project_id'])
      .where('page_index', '=', 0)
      .where('thumbnail_path', 'is not', null)
      .execute();
    const thumbOf = new Map(
      firsts.map((s) => [s.project_id, `/api/projects/${s.project_id}/sheets/${s.id}/thumbnail`]),
    );
    return {
      projects: projects.map((p) => ({
        ...projectView(p, byProject.get(p.id) ?? null),
        thumbnail_url: thumbOf.get(p.id) ?? null,
      })),
    };
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    { schema: { params: idParams } },
    async (request) => {
      const project = await loadProject(request.params.projectId);
      return projectView(project, await loadFile(project.id));
    },
  );

  app.patch<{ Params: { projectId: string }; Body: { stage?: ProjectStage; archived?: boolean } }>(
    '/api/projects/:projectId',
    { schema: { params: idParams, body: patchBody } },
    async (request) => {
      await loadProject(request.params.projectId);
      const project = await db()
        .updateTable('projects')
        .set({
          ...(request.body.stage !== undefined && { stage: request.body.stage }),
          ...(request.body.archived !== undefined && { archived: request.body.archived }),
        })
        .where('id', '=', request.params.projectId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return projectView(project, await loadFile(project.id));
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/pdf',
    { schema: { params: idParams } },
    async (request, reply) => {
      const project = await loadProject(request.params.projectId);
      if (await loadFile(project.id)) {
        throw new HttpError(409, { error: 'this project already has a PDF' });
      }
      if (!request.isMultipart()) {
        throw new HttpError(415, { error: 'expected a multipart/form-data upload with one file' });
      }
      const part = await request.file();
      if (!part) throw new HttpError(400, { error: 'no file in the upload' });

      const storedName = `${randomUUID()}.pdf`;
      const relative = path.join(project.id, storedName);
      const absolute = path.join(uploadDir, relative);

      let received: { sha256: string; sizeBytes: number };
      try {
        received = await receivePdf(part.file, absolute, maxBytes);
        if (part.file.truncated) throw new TooLargeError(maxBytes);
      } catch (err) {
        await fs.promises.rm(absolute, { force: true });
        if (err instanceof NotPdfError) throw new HttpError(415, { error: err.message });
        if (
          err instanceof TooLargeError ||
          (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE'
        ) {
          throw new HttpError(413, { error: `file exceeds the ${maxBytes} byte limit` });
        }
        throw err;
      }

      try {
        const file = await db()
          .transaction()
          .execute(async (trx) => {
            const row = await trx
              .insertInto('project_files')
              .values({
                project_id: project.id,
                original_filename: sanitizeFilename(part.filename),
                stored_path: relative.split(path.sep).join('/'),
                sha256: received.sha256,
                size_bytes: received.sizeBytes,
              })
              .returningAll()
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('jobs')
              .values({
                type: 'scan_pdf',
                payload: JSON.stringify({
                  project_id: project.id,
                  document_id: row.id,
                  auto_run: true,
                }),
              })
              .execute();
            await trx
              .updateTable('projects')
              .set({ status: 'scanning' })
              .where('id', '=', project.id)
              .execute();
            return row;
          });
        const updated = await loadProject(project.id);
        return reply.status(201).send(projectView(updated, file));
      } catch (err) {
        await fs.promises.rm(absolute, { force: true });
        if (isUniqueViolation(err)) {
          throw new HttpError(409, { error: 'this project already has a PDF' });
        }
        throw err;
      }
    },
  );
};
