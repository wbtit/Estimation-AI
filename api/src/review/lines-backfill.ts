// Phase 14f: one-off backfill of page lines (sheet_lines) for projects created before auto mode made
// them. Only projects whose purpose is 'real' are accepted (never evaluation or demo projects); a
// page is queued when it is a vector page with no lines and no open sheet_lines job, and its
// project's PDF scan is done. The plan is read-only; apply queues the jobs and wakes the worker.
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { JOBS_CHANNEL } from './image-similar.js';

export interface BackfillProject {
  id: string;
  vector_pages: number;
  with_lines: number;
  open_jobs: number;
  /** Sheet ids to queue. */
  to_queue: string[];
}

export interface BackfillPlan {
  projects: BackfillProject[];
  /** Project ids refused, with why (not found, not a real project, scan not done). */
  refused: { id: string; reason: string }[];
}

export async function planBackfill(
  db: Kysely<Database>,
  projectIds: readonly string[],
): Promise<BackfillPlan> {
  const out: BackfillPlan = { projects: [], refused: [] };
  for (const id of projectIds) {
    const p = await db
      .selectFrom('projects')
      .select(['id', 'purpose'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!p) {
      out.refused.push({ id, reason: 'project not found' });
      continue;
    }
    if (p.purpose !== 'real') {
      out.refused.push({ id, reason: `purpose is ${p.purpose}, not real` });
      continue;
    }
    const file = await db
      .selectFrom('project_files')
      .select('scan_status')
      .where('project_id', '=', id)
      .executeTakeFirst();
    if (!file || file.scan_status !== 'done') {
      out.refused.push({ id, reason: 'the PDF scan is not finished' });
      continue;
    }
    const rows = await sql<{ id: string; has_lines: boolean; open_job: boolean }>`
      SELECT s.id,
        EXISTS (SELECT 1 FROM sheet_lines l WHERE l.sheet_id = s.id) AS has_lines,
        EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'sheet_lines'
          AND j.status IN ('pending', 'processing') AND j.payload->>'sheet_id' = s.id::text) AS open_job
      FROM sheets s WHERE s.project_id = ${id} AND s.page_kind = 'vector'
      ORDER BY s.page_index`.execute(db);
    out.projects.push({
      id,
      vector_pages: rows.rows.length,
      with_lines: rows.rows.filter((r) => r.has_lines).length,
      open_jobs: rows.rows.filter((r) => !r.has_lines && r.open_job).length,
      to_queue: rows.rows.filter((r) => !r.has_lines && !r.open_job).map((r) => r.id),
    });
  }
  return out;
}

/** Queue the planned sheet_lines jobs (one transaction) and wake the worker; returns the job ids. */
export async function applyBackfill(db: Kysely<Database>, plan: BackfillPlan): Promise<string[]> {
  const sheets = plan.projects.flatMap((p) => p.to_queue);
  if (sheets.length === 0) return [];
  const ids = await db.transaction().execute(async (trx) => {
    const rows = await trx
      .insertInto('jobs')
      .values(
        sheets.map((sheetId) => ({
          type: 'sheet_lines',
          payload: JSON.stringify({ sheet_id: sheetId }),
        })),
      )
      .returning('id')
      .execute();
    return rows.map((r) => r.id);
  });
  await sql`SELECT pg_notify(${JOBS_CHANNEL}, ${ids[0]!})`.execute(db);
  return ids;
}
