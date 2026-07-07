import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

export async function jobRoutes(app: FastifyInstance) {
  // GET /api/job/:id — status + progress
  app.get<{ Params: { id: string } }>('/api/job/:id', async (req, reply) => {
    const { id } = req.params;

    const jobRes = await db.query(
      `SELECT id, filename, status, progress, current_stage, error, page_count, created_at, updated_at
       FROM jobs WHERE id = $1`,
      [id],
    );
    if (!jobRes.rows.length) return reply.code(404).send({ error: 'Job not found' });

    const job = jobRes.rows[0];

    const summaryRes = await db.query(
      `SELECT
         COUNT(*)                                      AS total_members,
         COUNT(*) FILTER (WHERE needs_review = true)  AS needs_review,
         COUNT(*) FILTER (WHERE needs_review = false) AS clean
       FROM detections
       WHERE job_id = $1 AND element_type = 'member_callout'`,
      [id],
    );
    const summary = summaryRes.rows[0];

    const missingRes = await db.query(
      `SELECT referenced_sheet FROM missing_sheets WHERE job_id = $1`,
      [id],
    );

    return {
      jobId:        job.id,
      filename:     job.filename,
      status:       job.status,
      progress:     job.progress,
      currentStage: job.current_stage,
      pageCount:    job.page_count,
      error:        job.error ?? null,
      createdAt:    job.created_at,
      updatedAt:    job.updated_at,
      summary: {
        totalMembers:     parseInt(summary.total_members, 10),
        needsReview:      parseInt(summary.needs_review,  10),
        clean:            parseInt(summary.clean,         10),
        reviewPercentage:
          summary.total_members > 0
            ? Math.round((summary.needs_review / summary.total_members) * 100)
            : 0,
        missingSheets: missingRes.rows.map((r) => r.referenced_sheet),
      },
    };
  });

  // GET /api/job/:id/detections — paginated, optional ?needsReview=true
  app.get<{
    Params:      { id: string };
    Querystring: { needsReview?: string; page?: string; limit?: string };
  }>('/api/job/:id/detections', async (req, reply) => {
    const { id }            = req.params;
    const { needsReview, page = '1', limit = '50' } = req.query;

    const pageNum  = Math.max(1, parseInt(page,  10));
    const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const offset   = (pageNum - 1) * pageSize;

    const conditions: string[] = ['job_id = $1'];
    const values: unknown[]    = [id];

    if (needsReview !== undefined) {
      values.push(needsReview === 'true');
      conditions.push(`needs_review = $${values.length}`);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      db.query(
        `SELECT * FROM detections WHERE ${where}
         ORDER BY confidence_score ASC NULLS LAST, created_at ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, offset],
      ),
      db.query(`SELECT COUNT(*) FROM detections WHERE ${where}`, values),
    ]);

    const total        = parseInt(countRes.rows[0].count, 10);
    const flaggedCount = needsReview
      ? total
      : (
          await db.query(
            `SELECT COUNT(*) FROM detections WHERE job_id = $1 AND needs_review = true`,
            [id],
          )
        ).rows[0].count;

    return {
      detections:  dataRes.rows,
      total,
      flaggedCount: parseInt(flaggedCount, 10),
      page:        pageNum,
      limit:       pageSize,
    };
  });

  // PATCH /api/detection/:id — human correction
  app.patch<{
    Params: { id: string };
    Body: {
      correctedLabel: string;
      reviewedBy:     string;
      reviewNotes?:   string;
    };
  }>('/api/detection/:id', async (req, reply) => {
    const { id }     = req.params;
    const { correctedLabel, reviewedBy, reviewNotes } = req.body;

    if (!correctedLabel || !reviewedBy) {
      return reply.code(400).send({ error: 'correctedLabel and reviewedBy are required' });
    }

    const res = await db.query(
      `UPDATE detections
       SET corrected_label = $1,
           reviewed_by     = $2,
           review_notes    = $3,
           reviewed_at     = NOW(),
           needs_review    = false
       WHERE id = $4
       RETURNING id`,
      [correctedLabel, reviewedBy, reviewNotes ?? null, id],
    );

    if (!res.rows.length) return reply.code(404).send({ error: 'Detection not found' });

    return { id: res.rows[0].id, updated: true };
  });

  // GET /api/job/:id/export — Phase 1 output JSON for Phase 2
  app.get<{ Params: { id: string } }>('/api/job/:id/export', async (req, reply) => {
    const { id } = req.params;

    const jobRes = await db.query(
      `SELECT * FROM jobs WHERE id = $1`,
      [id],
    );
    if (!jobRes.rows.length) return reply.code(404).send({ error: 'Job not found' });
    const job = jobRes.rows[0];

    const detectionsRes = await db.query(
      `SELECT * FROM detections WHERE job_id = $1 AND element_type = 'member_callout'
       ORDER BY page_number, created_at`,
      [id],
    );

    const missingRes = await db.query(
      `SELECT referenced_sheet FROM missing_sheets WHERE job_id = $1`,
      [id],
    );

    const members = detectionsRes.rows.map((d) => ({
      id:             d.id,
      type:           inferType(d.shape_type, d.element_type),
      designation:    d.designation,
      shapeType:      d.shape_type,
      depthIn:        d.depth_in,
      weightPerFoot:  d.weight_per_foot,
      gridFrom:       d.grid_from,
      gridTo:         d.grid_to,
      level:          d.level,
      lengthFt:       d.length_ft,
      totalWeightLb:  d.total_weight_lb,
      sourceSheetId:  d.source_sheet_id,
      scheduleMark:   d.schedule_mark,
      bbox:           { x: d.bbox_x, y: d.bbox_y, w: d.bbox_w, h: d.bbox_h },
      confidenceScore: d.confidence_score,
      needsReview:    d.needs_review,
      reviewReason:   d.review_reason,
      reviewedBy:     d.reviewed_by,
      correctedLabel: d.corrected_label,
    }));

    const needsReview = members.filter((m) => m.needsReview).length;

    return {
      projectId:   id,
      jobId:       id,
      status:      job.status,
      processedAt: job.updated_at,
      summary: {
        totalSheets:      job.page_count ?? 0,
        totalMembers:     members.length,
        needsReview,
        reviewPercentage:
          members.length > 0
            ? Math.round((needsReview / members.length) * 100)
            : 0,
        missingSheets:     missingRes.rows.map((r) => r.referenced_sheet),
        unresolvableRefs:  0,
      },
      members,
    };
  });
}

function inferType(shapeType: string | null, _elementType: string): string {
  if (!shapeType) return 'unknown';
  if (shapeType === 'W' || shapeType === 'WT') return 'beam';
  if (shapeType === 'HSS')  return 'column';
  if (shapeType === 'L')    return 'brace';
  if (shapeType === 'C' || shapeType === 'MC') return 'beam';
  return 'unknown';
}
