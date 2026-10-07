import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import type { Kysely } from 'kysely';
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
