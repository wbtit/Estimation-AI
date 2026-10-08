import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { CatalogIndex } from '../validator/index.js';

// Database tests read the same root .env as the app (requires `make up` and `make migrate`).
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

export function uniqueLabel(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Synthetic catalog index from { name: kg/m }. */
export function catalogOf(weights: Record<string, number>): CatalogIndex {
  return new Map(
    Object.entries(weights).map(([name, kg]) => [name, { shape_name: name, weight_kg_per_m: kg }]),
  );
}

export async function insertProject(db: Kysely<Database>): Promise<string> {
  const row = await db
    .insertInto('projects')
    .values({
      name: uniqueLabel('test-project'),
      number: null,
      status: 'draft',
      location: null,
      drawing_issue: null,
      grids: '[]',
      levels: '[]',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function deleteProject(db: Kysely<Database>, id: string): Promise<void> {
  await db.deleteFrom('projects').where('id', '=', id).execute(); // members cascade
}

export async function deleteEdition(db: Kysely<Database>, edition: string): Promise<void> {
  await db.deleteFrom('catalog_shapes').where('edition', '=', edition).execute();
}

/** Loads xlsx bytes. exceljs's Buffer typing predates Node's generic Buffer; the value is a plain Buffer. */
export async function loadWorkbook(data: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  return wb;
}

/** Builds a multipart/form-data body with a single file part. */
export function multipartBody(
  filename: string,
  content: Buffer,
  contentType = 'application/pdf',
): { payload: Buffer; headers: { 'content-type': string } } {
  const boundary = `----test${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** A minimal byte string that starts like a PDF. The upload route only checks the header. */
export function fakePdf(extra = 'synthetic test document'): Buffer {
  return Buffer.from(`%PDF-1.7\n% ${extra}\n%%EOF\n`);
}

/** Removes a project's rows that do not cascade (the scan jobs queued for it). */
export async function deleteJobsFor(db: Kysely<Database>, projectId: string): Promise<void> {
  await db
    .deleteFrom('jobs')
    .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
    .execute();
}

export interface SheetSeed {
  page_index: number;
  sheet_number?: string | null;
  kind?: 'plan' | 'schedule' | 'detail' | 'notes' | 'other';
  page_kind?: 'vector' | 'scanned' | 'unknown';
  scales?: { raw: string; kind: 'ratio' | 'nts'; ratio: number | null; count: number }[];
  scale_parsed?: string | null;
  scale_parsed_ratio?: number | null;
  review_reasons?: string[];
  thumbnail_path?: string | null;
  width_pt?: number | null;
  height_pt?: number | null;
  page_type_guess?: string | null;
  /** An explicit takeoff decision a person made for this sheet (a sheet_edits row). */
  decided?: 'include' | 'exclude';
}

/** Inserts a sheet row as the scan job would have written it. */
export async function insertSheet(
  db: Kysely<Database>,
  projectId: string,
  seed: SheetSeed,
): Promise<string> {
  const row = await db
    .insertInto('sheets')
    .values({
      project_id: projectId,
      page_index: seed.page_index,
      sheet_number: seed.sheet_number ?? null,
      kind: seed.kind ?? 'plan',
      page_kind: seed.page_kind ?? 'vector',
      scales: JSON.stringify(seed.scales ?? []),
      scale_parsed: seed.scale_parsed ?? null,
      scale_parsed_ratio: seed.scale_parsed_ratio ?? null,
      scale_source: seed.scale_parsed ? 'pdf_text' : null,
      review_reasons: seed.review_reasons ?? [],
      needs_review: (seed.review_reasons ?? []).length > 0,
      thumbnail_path: seed.thumbnail_path ?? null,
      width_pt: seed.width_pt ?? null,
      height_pt: seed.height_pt ?? null,
      page_type_guess: (seed.page_type_guess ?? null) as never,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (seed.decided) {
    await db
      .insertInto('sheet_edits')
      .values({
        sheet_id: row.id,
        field_name: 'takeoff',
        original_value: JSON.stringify(null),
        corrected_value: JSON.stringify(seed.decided),
        editor: 'test',
        reason: null,
      })
      .execute();
  }
  return row.id;
}

/** The scan jobs queued for a project. */
export async function jobsFor(db: Kysely<Database>, projectId: string) {
  return db
    .selectFrom('jobs')
    .selectAll()
    .where('type', '=', 'scan_pdf')
    .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
    .execute();
}
