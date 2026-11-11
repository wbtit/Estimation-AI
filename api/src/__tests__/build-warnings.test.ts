// Phase 14f: a framing page whose named column plan is not built is queued (not refused); the
// worker's warnings (built without column supports) are shown on the pages list (SYNTHETIC rows).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { BUILD_WARNINGS, buildWarnings } from '../review/page-badge.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

describe('build warnings (pure)', () => {
  it('reads the warning codes of a finished run only', () => {
    const notes = ['no_column_plan', 'warning:column_plan_not_built', 'warning:unknown'];
    expect(buildWarnings({ status: 'done', notes })).toEqual([
      BUILD_WARNINGS['warning:column_plan_not_built'],
    ]);
    expect(buildWarnings({ status: 'refused', notes })).toEqual([]);
    expect(buildWarnings(null)).toEqual([]);
    expect(BUILD_WARNINGS['warning:no_placed_columns']).toBe(
      'Built without column supports: no columns are placed on the column plan page',
    );
  });
});

describe('Build with a column plan that is not built (test database)', () => {
  let projectId: string;
  let planId: string;
  let framingId: string;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });

  beforeAll(async () => {
    projectId = await insertProject(db);
    planId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    framingId = await insertSheet(db, projectId, { page_index: 1, width_pt: 1000, height_pt: 800 });
    await db
      .insertInto('project_files')
      .values({
        project_id: projectId,
        original_filename: 'synthetic.pdf',
        stored_path: `${projectId}/x.pdf`,
        sha256: '0'.repeat(64),
        size_bytes: 1,
        scan_status: 'done',
      })
      .execute();
    const box = JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 });
    const planView = await setFirstView(db, planId, {
      role_name: 'Foundation / column plan',
      box,
      scale_ratio: 96,
    });
    await setFirstView(
      db,
      framingId,
      {
        role_name: 'Framing plan',
        box,
        scale_ratio: 96,
        // a person named the column plan page, which is not built
        column_plan_view_id: planView,
        column_plan_confirmed_by: WHO,
        column_plan_confirmed_at: new Date(),
      },
      [{ pen_class: '0.5-1|black|solid', source: 'person', confirmed_by: WHO }],
    );
  });

  afterAll(async () => {
    await db
      .deleteFrom('jobs')
      .where(
        'id',
        'in',
        db.selectFrom('build_runs').select('job_id').where('project_id', '=', projectId) as never,
      )
      .execute();
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('queues the Build (no refusal) with the named plan in the run inputs', async () => {
    const res = await post(`/sheets/${framingId}/build`, { who: WHO, allow_system_values: true });
    expect(res.statusCode).toBe(202);
    const run = await db
      .selectFrom('build_runs')
      .select(['status', 'inputs'])
      .where('id', '=', res.json().build_run_id)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe('pending');
    expect((run.inputs as Record<string, unknown>).column_plan_view_id).toBeTruthy();
  });

  it('shows the warnings of the finished run on the page card', async () => {
    // the worker's result, as job.py stores it
    await db
      .updateTable('build_runs')
      .set({
        status: 'done',
        finished_at: new Date(),
        notes: ['no_column_plan', 'warning:column_plan_not_built'] as never,
      })
      .where('sheet_id', '=', framingId)
      .execute();
    await db
      .updateTable('build_views')
      .set({ built_at: new Date() })
      .where('sheet_id', '=', framingId)
      .execute();
    const pages = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pages` })
    ).json().pages as { id: string; warnings: string[]; views: { warnings: string[] }[] }[];
    const f = pages.find((p) => p.id === framingId)!;
    const text = BUILD_WARNINGS['warning:column_plan_not_built'];
    expect(f.warnings).toEqual([text]);
    expect(f.views[0]!.warnings).toEqual([text]);
    expect(pages.find((p) => p.id === planId)!.warnings).toEqual([]);
  });
});
