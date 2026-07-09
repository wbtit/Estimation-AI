import axios, { AxiosError } from 'axios';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000';

const client = axios.create({
  baseURL: PYTHON_URL,
  timeout: 0, // 0 means no timeout
});

async function callWithRetry<T>(path: string, body: unknown): Promise<T> {
  try {
    const res = await client.post<T>(path, body);
    return res.data;
  } catch (err) {
    if (err instanceof AxiosError && err.code !== 'ECONNABORTED') {
      // Single retry
      const res = await client.post<T>(path, body);
      return res.data;
    }
    throw err;
  }
}

// ── Stage 1 ──────────────────────────────────────────────────────────────────

export interface RasterizePage {
  page_number: number;
  image_path:  string;
  width:       number;
  height:      number;
}

export async function rasterize(pdfPath: string, dpi = 300): Promise<{ pages: RasterizePage[] }> {
  return callWithRetry('/rasterize', { pdf_path: pdfPath, dpi });
}

// ── Stage 2 ──────────────────────────────────────────────────────────────────

export interface SheetClassification {
  sheet_type:       string;
  confidence:       number;
  title_block_text: string;
  detected_schedule_present: boolean;
  matched_text?: string;
  tier?: number;
}

export async function classifySheet(
  imagePath: string, 
  jobId: string, 
  pageId: string,
  pdfPath: string,
  pageNumber: number
): Promise<SheetClassification> {
  return callWithRetry('/classify-sheet', { 
    image_path: imagePath, 
    job_id: jobId, 
    page_id: pageId,
    pdf_path: pdfPath,
    page_number: pageNumber
  });
}

// ── Stage 3 ──────────────────────────────────────────────────────────────────

export interface ScheduleRow {
  mark_number:  string;
  designation:  string;
  quantity:     number;
  length_ft:    number;
  remarks:      string;
}

export async function extractSchedule(
  imagePath: string,
  pdfPath: string,
  pageNumber: number,
): Promise<{ source: string; rows: ScheduleRow[] }> {
  return callWithRetry('/extract-schedule', {
    image_path:  imagePath,
    pdf_path:    pdfPath,
    page_number: pageNumber,
  });
}

// ── Stage 4 ──────────────────────────────────────────────────────────────────

export interface RawDetection {
  class_name: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export async function detect(imagePath: string): Promise<{ detections: RawDetection[] }> {
  return callWithRetry('/detect', { image_path: imagePath });
}

// ── Stage 5 ──────────────────────────────────────────────────────────────────

export interface OcrResult {
  raw_text:      string | null;
  ocr_confidence: number;
  parsed: {
    shape_type:       string;
    designation:      string;
    depth_in:         number;
    weight_per_foot:  number;
  } | null;
  parse_success: boolean;
}

export async function ocrRegion(
  imagePath: string,
  bbox: { x: number; y: number; w: number; h: number },
): Promise<OcrResult> {
  return callWithRetry('/ocr', { image_path: imagePath, bbox });
}

// ── Health ───────────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string }> {
  const res = await client.get<{ status: string }>('/health');
  return res.data;
}
