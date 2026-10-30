// Phase 14d: Find similar through the worker's image search (job type 'find_similar'; worker
// src/build/similar_job.py runs src/build/col_image.find_similar, the function the measurement
// runs; docs/PHASE14D_PREREGISTRATION.md). The preview queues one job and waits for it; Accept
// reuses that job's result, so what was previewed is exactly what is created.
import { getDb } from '../db/client.js';
import { HttpError } from '../routes/http-error.js';

export const JOB_TYPE = 'find_similar';
/** How long a preview waits for the worker before answering 504. */
export const WAIT_MS = 20_000;
const POLL_MS = 100;

export interface ImageResult {
  example: {
    source: 'vector' | 'ink';
    family: string;
    solid: string | null;
    box: [number, number, number, number];
    centre: [number, number];
    real_in: [number, number];
  } | null;
  note: string | null;
  vector: number;
  image: number;
  combined: { centre: [number, number]; source: 'vector' | 'image'; rotation: number }[];
  runtime_s: number;
  settings: Record<string, unknown>;
}

export interface Match {
  centre: [number, number];
  symbol: string | null;
  rotation_deg: number;
  real_in: [number, number];
  source: 'vector' | 'image';
}

export interface ImageRun {
  run_id: string;
  runtime_s: number;
  vector: number;
  image: number;
  settings: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The finished image-search job: the one named by `runId` (Accept after a preview; it must be
 * this column's), else a new job queued and waited for. */
export async function imageJob(p: {
  projectId: string;
  sheetId: string;
  memberId: string;
  click: [number, number];
  buildRunId: string;
  runId?: string;
  waitMs?: number;
}): Promise<{ id: string; result: ImageResult }> {
  const db = getDb();
  let id = p.runId;
  if (id) {
    const old = await db
      .selectFrom('jobs')
      .select(['type', 'payload'])
      .where('id', '=', id)
      .executeTakeFirst();
    const pl = (old?.payload ?? {}) as Record<string, unknown>;
    if (!old || old.type !== JOB_TYPE || pl.member_id !== p.memberId)
      throw new HttpError(400, { error: 'run_id is not a Find similar preview of this column' });
  } else {
    const row = await db
      .insertInto('jobs')
      .values({
        type: JOB_TYPE,
        max_attempts: 1,
        payload: JSON.stringify({
          project_id: p.projectId,
          sheet_id: p.sheetId,
          member_id: p.memberId,
          build_run_id: p.buildRunId,
          click: p.click,
        }) as never,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    id = row.id;
  }
  const until = Date.now() + (p.waitMs ?? WAIT_MS);
  for (;;) {
    const job = await db
      .selectFrom('jobs')
      .select(['status', 'result', 'error'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    if (job.status === 'completed') return { id, result: job.result as unknown as ImageResult };
    if (job.status === 'failed')
      throw new HttpError(409, { error: `the image search failed: ${job.error ?? 'unknown'}` });
    if (Date.now() > until)
      throw new HttpError(504, {
        error: 'the image search did not finish in time (is the worker running?)',
        run_id: id,
      });
    await sleep(POLL_MS);
  }
}
