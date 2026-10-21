// Projects and PDF upload.
//   POST /api/projects                 create a project (status is set by the server)
//   GET  /api/projects                 list
//   GET  /api/projects/:projectId      get, with the uploaded document and scan progress
//   PATCH /api/projects/:projectId     { stage?, archived?, name?, purpose?, who? } the estimator's
//                                      status (Estimating, Submitted, Won, Lost); archived hides it
//                                      from the list; name and purpose (real, demo, evaluation).
//                                      A rename, purpose change or (un)archive needs `who` and is
//                                      logged (count_actions 'project', migration 026)
//   POST /api/projects/:projectId/opened         a person opened it (last_opened_at; no log row)
//   POST /api/projects/:projectId/duplicate      { who, name? } "Duplicate as demo": queues the
//                                      worker's copy_project job (purpose demo), logged
//   POST /api/projects/:projectId/pdf  upload the project's one PDF (multipart, streamed to disk)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import type { Kysely } from 'kysely';
import { DEFAULT_MAX_UPLOAD_BYTES, resolveUploadDir } from '../config.js';
import { getDb } from '../db/client.js';
import { sql } from 'kysely';
import type { Database, ProjectPurpose, ProjectStage } from '../db/types.js';
import { logCountAction } from '../review/count-log.js';
import {
  cardCounts,
  sortByLastOpened,
  thumbnailSheet,
  type CardSheet,
} from '../review/project-cards.js';
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
export const PROJECT_PURPOSES = ['real', 'demo', 'evaluation'] as const;

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
  properties: {
    stage: { enum: [...PROJECT_STAGES] },
    archived: { type: 'boolean' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    purpose: { enum: [...PROJECT_PURPOSES] },
    who: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

interface PatchBody {
  stage?: ProjectStage;
  archived?: boolean;
  name?: string;
  purpose?: ProjectPurpose;
  who?: string;
}

const duplicateBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
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
    const projects = await db().selectFrom('projects').selectAll().execute();
    const files = await db().selectFrom('project_files').selectAll().execute();
    const byProject = new Map(files.map((f) => [f.project_id, f]));
    // every page with its first view's role behaviour, finished build and review (the card)
    const rows = await db()
      .selectFrom('sheets as s')
      .leftJoin('build_views as v', (j) =>
        j.onRef('v.sheet_id', '=', 's.id').on('v.position', '=', 1),
      )
      .leftJoin('role_names as r', 'r.name', 'v.role_name')
      .select([
        's.id',
        's.project_id',
        's.page_index',
        's.thumbnail_path',
        's.page_type_guess',
        'r.behaviour',
        sql<boolean>`s.reviewed_at IS NOT NULL`.as('reviewed'),
        sql<boolean>`EXISTS (SELECT 1 FROM build_runs b WHERE b.sheet_id = s.id AND b.status = 'done')`.as(
          'built',
        ),
      ])
      .execute();
    const sheetsOf = new Map<string, CardSheet[]>();
    for (const r of rows) {
      const list = sheetsOf.get(r.project_id) ?? [];
      list.push({
        id: r.id,
        page_index: r.page_index,
        thumbnail_path: r.thumbnail_path,
        page_type_guess: r.page_type_guess,
        behaviour: r.behaviour ?? null,
        built: r.built,
        reviewed: r.reviewed,
      });
      sheetsOf.set(r.project_id, list);
    }
    return {
      projects: sortByLastOpened(projects).map((p) => {
        const sheets = sheetsOf.get(p.id) ?? [];
        const thumb = thumbnailSheet(sheets);
        return {
          ...projectView(p, byProject.get(p.id) ?? null),
          thumbnail_url: thumb ? `/api/projects/${p.id}/sheets/${thumb.id}/thumbnail` : null,
          pages: cardCounts(sheets),
        };
      }),
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

  app.patch<{ Params: { projectId: string }; Body: PatchBody }>(
    '/api/projects/:projectId',
    { schema: { params: idParams, body: patchBody } },
    async (request) => {
      const before = await loadProject(request.params.projectId);
      const b = request.body;
      const name = b.name?.trim();
      if (b.name !== undefined && name === '') {
        throw new HttpError(400, { error: 'name must not be blank' });
      }
      // a person's change to the project: who did it is required and it is logged
      const changes: { change: string; from: unknown; to: unknown }[] = [];
      if (name !== undefined && name !== before.name)
        changes.push({ change: 'rename', from: before.name, to: name });
      if (b.purpose !== undefined && b.purpose !== before.purpose)
        changes.push({ change: 'purpose', from: before.purpose, to: b.purpose });
      if (b.archived !== undefined && b.archived !== before.archived)
        changes.push({
          change: b.archived ? 'archive' : 'unarchive',
          from: before.archived,
          to: b.archived,
        });
      const who = b.who?.trim() ?? '';
      if (changes.length > 0 && who === '') {
        throw new HttpError(400, { error: 'who is required to rename, change purpose or archive' });
      }
      if (name !== undefined && name !== before.name) {
        const taken = await db()
          .selectFrom('projects')
          .select('id')
          .where('name', '=', name)
          .executeTakeFirst();
        if (taken) throw new HttpError(409, { error: 'a project with that name already exists' });
      }
      const project = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .updateTable('projects')
            .set({
              ...(b.stage !== undefined && { stage: b.stage }),
              ...(b.archived !== undefined && { archived: b.archived }),
              ...(name !== undefined && { name }),
              ...(b.purpose !== undefined && { purpose: b.purpose }),
            })
            .where('id', '=', request.params.projectId)
            .returningAll()
            .executeTakeFirstOrThrow();
          for (const c of changes) {
            await logCountAction(trx, { projectId: row.id, action: 'project', who, detail: c });
          }
          return row;
        });
      return projectView(project, await loadFile(project.id));
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/opened',
    { schema: { params: idParams } },
    async (request) => {
      await loadProject(request.params.projectId);
      await db()
        .updateTable('projects')
        .set({ last_opened_at: new Date() })
        .where('id', '=', request.params.projectId)
        .execute();
      return { ok: true };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string; name?: string } }>(
    '/api/projects/:projectId/duplicate',
    { schema: { params: idParams, body: duplicateBody } },
    async (request, reply) => {
      const source = await loadProject(request.params.projectId);
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who is required' });
      const name = (request.body.name ?? `${source.name} (demo)`).trim();
      const taken = await db()
        .selectFrom('projects')
        .select('id')
        .where('name', '=', name)
        .executeTakeFirst();
      if (taken) throw new HttpError(409, { error: 'a project with that name already exists' });
      const job = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .insertInto('jobs')
            .values({
              type: 'copy_project',
              payload: JSON.stringify({ project_id: source.id, name, purpose: 'demo' }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await logCountAction(trx, {
            projectId: source.id,
            action: 'project',
            who,
            detail: { change: 'duplicate_as_demo', from: source.id, to: name, job_id: row.id },
          });
          return row;
        });
      return reply.status(202).send({ job_id: job.id, name });
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
