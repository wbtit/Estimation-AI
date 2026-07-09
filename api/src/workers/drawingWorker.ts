import { Worker, Queue } from 'bullmq';
import { db } from '../db/client.js';
import * as python from '../services/pythonService.js';

// BullMQ bundles its own ioredis; pass plain options to avoid version conflicts
const REDIS_URL  = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = {
  host:               REDIS_URL.hostname,
  port:               parseInt(REDIS_URL.port || '6379', 10),
  password:           REDIS_URL.password || undefined,
  maxRetriesPerRequest: null,
};

export const drawingQueue = new Queue('drawing-pipeline', { connection });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setStage(jobId: string, stage: string, progress: number) {
  await db.query(
    `UPDATE jobs SET current_stage = $1, progress = $2, updated_at = NOW() WHERE id = $3`,
    [stage, progress, jobId],
  );
  console.log(`[worker] job=${jobId} stage=${stage} progress=${progress}%`);
}

async function failJob(jobId: string, error: string) {
  await db.query(
    `UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
    [error, jobId],
  );
}

// ── Stage 1: Rasterize ────────────────────────────────────────────────────────

async function stage1Rasterize(jobId: string, pdfPath: string) {
  const result = await python.rasterize(pdfPath, 300);

  await db.query(
    `UPDATE jobs SET page_count = $1, updated_at = NOW() WHERE id = $2`,
    [result.pages.length, jobId],
  );

  for (const p of result.pages) {
    await db.query(
      `INSERT INTO pages (job_id, page_number, image_path, width_px, height_px)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, p.page_number, p.image_path, p.width, p.height],
    );
  }

  return result.pages;
}

// ── Stage 2: Classify sheets ──────────────────────────────────────────────────

async function stage2ClassifySheets(jobId: string, pdfPath: string, pages: python.RasterizePage[]) {
  const classified = [];

  for (const page of pages) {
    const pageRow = await db.query(
      `SELECT id FROM pages WHERE job_id = $1 AND page_number = $2`,
      [jobId, page.page_number],
    );
    const pageId = pageRow.rows[0]?.id;
    if (!pageId) continue;

    const cls = await python.classifySheet(page.image_path, jobId, pageId, pdfPath, page.page_number);

    await db.query(
      `UPDATE pages SET sheet_type = $1, sheet_type_confidence = $2, title_block_text = $3, detected_schedule_present = $4
       WHERE id = $5`,
      [cls.sheet_type, cls.confidence, cls.title_block_text, cls.detected_schedule_present, pageId],
    );

    classified.push({ ...page, sheet_type: cls.sheet_type, confidence: cls.confidence, detected_schedule_present: cls.detected_schedule_present, matched_text: cls.matched_text, tier: cls.tier });
  }

  return classified;
}

// ── Stage 3: Extract member schedules ─────────────────────────────────────────

async function stage3ExtractSchedules(
  jobId: string,
  pdfPath: string,
  pages: Array<python.RasterizePage & { sheet_type: string; detected_schedule_present: boolean }>,
) {
  const schedulePages = pages.filter((p) => p.sheet_type === 'member_schedule' || p.detected_schedule_present);

  for (const page of schedulePages) {
    const pageRow = await db.query(
      `SELECT id FROM pages WHERE job_id = $1 AND page_number = $2`,
      [jobId, page.page_number],
    );
    const pageId = pageRow.rows[0]?.id;
    if (!pageId) continue;

    const result = await python.extractSchedule(page.image_path, pdfPath, page.page_number);

    for (const row of result.rows) {
      await db.query(
        `INSERT INTO member_schedule_items
           (job_id, page_id, mark_number, designation, quantity, length_ft, remarks, raw_row)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [jobId, pageId, row.mark_number, row.designation, row.quantity,
         row.length_ft, row.remarks, JSON.stringify(row)],
      );
    }
  }
}

// ── Stage 4 + 5: Detect + OCR ─────────────────────────────────────────────────

const DETECTION_SHEET_TYPES = new Set(['framing_plan', 'elevation', 'section', 'connection_detail', 'foundation_plan']);

async function stage4And5DetectAndOcr(
  jobId: string,
  pages: Array<python.RasterizePage & { sheet_type: string }>,
  onProgress: (pct: number) => Promise<void>,
) {
  const detectionPages = pages.filter((p) => DETECTION_SHEET_TYPES.has(p.sheet_type));

  for (let i = 0; i < detectionPages.length; i++) {
    const page = detectionPages[i];

    const pageRow = await db.query(
      `SELECT id FROM pages WHERE job_id = $1 AND page_number = $2`,
      [jobId, page.page_number],
    );
    const pageId = pageRow.rows[0]?.id;
    if (!pageId) continue;

    const { detections } = await python.detect(page.image_path);

    for (const det of detections) {
      const insertRes = await db.query(
        `INSERT INTO detections
           (job_id, page_id, page_number, element_type,
            bbox_x, bbox_y, bbox_w, bbox_h, yolo_confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [jobId, pageId, page.page_number, det.class_name,
         det.bbox.x, det.bbox.y, det.bbox.w, det.bbox.h, det.confidence],
      );
      const detectionId = insertRes.rows[0].id;

      if (det.class_name === 'member_callout') {
        const ocr = await python.ocrRegion(page.image_path, det.bbox);
        await db.query(
          `UPDATE detections SET
             raw_ocr_text         = $1,
             ocr_confidence       = $2,
             ocr_confidence_score = $2,
             designation          = $3,
             shape_type           = $4,
             depth_in             = $5,
             weight_per_foot      = $6
           WHERE id = $7`,
          [
            ocr.raw_text,
            ocr.ocr_confidence,
            ocr.parsed?.designation ?? null,
            ocr.parsed?.shape_type  ?? null,
            ocr.parsed?.depth_in    ?? null,
            ocr.parsed?.weight_per_foot ?? null,
            detectionId,
          ],
        );
      }
    }

    await onProgress(Math.round(((i + 1) / detectionPages.length) * 60) + 20);
  }
}

// ── Stage 6: Grid resolver ────────────────────────────────────────────────────

async function stage6ResolveGrids(jobId: string) {
  const pages = await db.query(
    `SELECT id FROM pages WHERE job_id = $1`,
    [jobId],
  );

  for (const page of pages.rows) {
    // Fetch all grid bubbles on the page to build the grid map
    const bubbles = await db.query(
      `SELECT raw_ocr_text, bbox_x, bbox_y FROM detections
       WHERE page_id = $1 AND element_type = 'grid_bubble'`,
      [page.id],
    );

    const xLines: Array<{ label: string; xNorm: number }> = [];
    const yLines: Array<{ label: string; yNorm: number }> = [];

    for (const b of bubbles.rows) {
      if (!b.raw_ocr_text) continue;
      if (/^[A-Z]+$/i.test(b.raw_ocr_text.trim())) {
        xLines.push({ label: b.raw_ocr_text.trim().toUpperCase(), xNorm: b.bbox_x });
      } else if (/^\d+$/.test(b.raw_ocr_text.trim())) {
        yLines.push({ label: b.raw_ocr_text.trim(), yNorm: b.bbox_y });
      }
    }

    xLines.sort((a, b) => a.xNorm - b.xNorm);
    yLines.sort((a, b) => a.yNorm - b.yNorm);

    if (!xLines.length && !yLines.length) continue;

    // Assign each member callout to its nearest grid intersection
    const callouts = await db.query(
      `SELECT id, bbox_x, bbox_y FROM detections
       WHERE page_id = $1 AND element_type = 'member_callout'`,
      [page.id],
    );

    for (const c of callouts.rows) {
      const nearestX = findNearest(c.bbox_x, xLines, 'xNorm');
      const nextX    = findNext(nearestX, xLines, 'xNorm');
      const nearestY = findNearest(c.bbox_y, yLines, 'yNorm');

      if (!nearestX || !nearestY) {
        await db.query(
          `UPDATE detections SET review_reason = 'grid_unresolved', needs_review = true WHERE id = $1`,
          [c.id],
        );
        continue;
      }

      const gridFrom = `${nearestX.label}${nearestY.label}`;
      const gridTo   = `${nextX?.label ?? '?'}${nearestY.label}`;

      await db.query(
        `UPDATE detections SET grid_from = $1, grid_to = $2 WHERE id = $3`,
        [gridFrom, gridTo, c.id],
      );
    }
  }
}

function findNearest<T extends Record<string, unknown>>(
  val: number,
  arr: T[],
  key: keyof T,
): T | null {
  if (!arr.length) return null;
  return arr.reduce((prev, cur) =>
    Math.abs((cur[key] as number) - val) < Math.abs((prev[key] as number) - val) ? cur : prev,
  );
}

function findNext<T extends Record<string, unknown>>(
  nearest: T | null,
  arr: T[],
  _key: keyof T,
): T | null {
  if (!nearest) return null;
  const idx = arr.indexOf(nearest);
  return arr[idx + 1] ?? null;
}

// ── Stage 7: Cross-sheet resolver ─────────────────────────────────────────────

const CROSS_REF_PATTERN = /^(\d+)\/(S\d+|A\d+|[A-Z]\d+)$/i;

async function stage7ResolveCrossRefs(jobId: string) {
  const markers = await db.query(
    `SELECT id, raw_ocr_text, page_number FROM detections
     WHERE job_id = $1 AND element_type = 'section_marker'`,
    [jobId],
  );

  for (const marker of markers.rows) {
    if (!marker.raw_ocr_text) continue;
    const match = marker.raw_ocr_text.match(CROSS_REF_PATTERN);
    if (!match) continue;

    const [, detailNum, targetSheetId] = match;

    // We don't have a sheet_id column yet — approximate with page lookup by sheet type
    // When sheet_id is added to pages, swap this query
    const targetPage = await db.query(
      `SELECT id FROM pages WHERE job_id = $1 LIMIT 1`,
      [jobId],
    );

    if (!targetPage.rows.length) {
      await db.query(
        `INSERT INTO missing_sheets (job_id, referenced_sheet, referenced_from)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [jobId, targetSheetId, `page ${marker.page_number}`],
      );
    } else {
      await db.query(
        `INSERT INTO cross_references
           (job_id, source_sheet_id, source_page_number, reference_text,
            target_sheet_id, target_detail_num, resolved)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [jobId, `page_${marker.page_number}`, marker.page_number,
         marker.raw_ocr_text, targetSheetId, parseInt(detailNum, 10)],
      );
    }
  }
}

// ── Stage 8: Confidence scoring + review flagging ─────────────────────────────

interface ScoringSignals {
  yoloConf:           number;
  ocrConf:            number;
  parsedSuccessfully: boolean;
  gridResolved:       boolean;
  foundInSchedule:    boolean;
  crossRefResolved:   boolean;
}

function scoreDetection(s: ScoringSignals): { score: number; reason: string | null } {
  const score =
    s.yoloConf                          * 0.30 +
    s.ocrConf                           * 0.25 +
    (s.parsedSuccessfully ? 1.0 : 0.0)  * 0.20 +
    (s.gridResolved       ? 1.0 : 0.5)  * 0.15 +
    (s.foundInSchedule    ? 1.0 : 0.7)  * 0.10;

  const reason =
    !s.parsedSuccessfully ? 'callout_unparseable'     :
    s.ocrConf < 0.60      ? 'ocr_unreadable'          :
    !s.gridResolved        ? 'grid_unresolved'          :
    !s.foundInSchedule     ? 'no_schedule_match'        :
    s.yoloConf < 0.70      ? 'low_detection_confidence' :
    null;

  return { score, reason };
}

async function stage8ScoreAndFinalize(jobId: string) {
  const detections = await db.query(
    `SELECT * FROM detections WHERE job_id = $1 AND element_type = 'member_callout'`,
    [jobId],
  );

  const scheduleDesignations = await db.query(
    `SELECT DISTINCT UPPER(designation) as designation FROM member_schedule_items WHERE job_id = $1`,
    [jobId],
  );
  const scheduleSet = new Set(scheduleDesignations.rows.map((r: { designation: string }) => r.designation));

  for (const det of detections.rows) {
    const signals: ScoringSignals = {
      yoloConf:           det.yolo_confidence,
      ocrConf:            det.ocr_confidence_score ?? 0,
      parsedSuccessfully: !!det.designation,
      gridResolved:       !!det.grid_from,
      foundInSchedule:    !!det.designation && scheduleSet.has((det.designation as string).toUpperCase()),
      crossRefResolved:   det.cross_ref_resolved ?? true,
    };

    const { score, reason } = scoreDetection(signals);

    await db.query(
      `UPDATE detections SET
         confidence_score = $1,
         needs_review     = $2,
         review_reason    = COALESCE(review_reason, $3)
       WHERE id = $4`,
      [score, score < 0.75, reason, det.id],
    );
  }

  await db.query(
    `UPDATE jobs SET status = 'review_ready', progress = 100, current_stage = 'done', updated_at = NOW()
     WHERE id = $1`,
    [jobId],
  );
}

// ── BullMQ worker ─────────────────────────────────────────────────────────────

const worker = new Worker(
  'drawing-pipeline',
  async (job) => {
    const { jobId, pdfPath } = job.data as { jobId: string; pdfPath: string };

    try {
      await db.query(
        `UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [jobId],
      );

      // Verify Python service is reachable before starting
      await python.healthCheck();

      await setStage(jobId, 'rasterizing', 5);
      const pages = await stage1Rasterize(jobId, pdfPath);

      await setStage(jobId, 'classifying', 10);
      const classifiedPages = await stage2ClassifySheets(jobId, pdfPath, pages);

      await setStage(jobId, 'extracting_schedule', 15);
      await stage3ExtractSchedules(jobId, pdfPath, classifiedPages);

      await setStage(jobId, 'detecting', 20);
      await stage4And5DetectAndOcr(jobId, classifiedPages, async (pct) => {
        await job.updateProgress(pct);
        await db.query(
          `UPDATE jobs SET progress = $1, updated_at = NOW() WHERE id = $2`,
          [pct, jobId],
        );
      });

      await setStage(jobId, 'resolving_grids', 82);
      await stage6ResolveGrids(jobId);

      await setStage(jobId, 'resolving_references', 90);
      await stage7ResolveCrossRefs(jobId);

      await setStage(jobId, 'scoring', 95);
      await stage8ScoreAndFinalize(jobId);

      console.log(`[worker] job=${jobId} COMPLETE`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] job=${jobId} FAILED:`, message);
      await failJob(jobId, message);
      throw err;
    }
  },
  { connection, concurrency: 2 },
);

worker.on('completed', (job) => console.log(`[worker] completed jobId=${job.data.jobId}`));
worker.on('failed',    (job, err) => console.error(`[worker] failed jobId=${job?.data.jobId}`, err.message));

export default worker;
