// Turns a catalog table into validated shapes. Enforced here: a name, a numeric weight > 0,
// unique names. Bad rows are collected with their row numbers; the caller must refuse the whole
// file if any exist (no partial imports). No catalog values are ever invented or defaulted:
// the columns and the weight unit are passed in explicitly.
import { lbPerFtToKgPerM } from '../units/index.js';
import type { Table } from './table.js';

export type WeightUnit = 'lb/ft' | 'kg/m';

export interface CatalogColumns {
  /** Header of the shape-name column, matched exactly (after trimming). */
  name: string;
  /** Header of the weight column. */
  weight: string;
  /** Unit of the weight column. There is no default. */
  weightUnit: WeightUnit;
  /** Header of the family/type column. If omitted, family is the leading letters of the name. */
  family?: string;
}

export interface ParsedShape {
  shape_name: string;
  family: string;
  weight_kg_per_m: number;
  weight_lb_per_ft: number | null;
  properties: Record<string, unknown>;
}

export interface RowError {
  row: number;
  shape_name: string | null;
  message: string;
}

export class CatalogColumnError extends Error {}

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && NUMBER_PATTERN.test(value.trim())) return Number(value.trim());
  return null;
}

function toText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Index of a header. A header that appears more than once must be chosen by occurrence, written
 * `Header#1` for the first one (the AISC file repeats its imperial headers in a metric block).
 * Without the suffix a repeated header is still an error.
 */
function columnIndex(headers: string[], header: string, role: string): number {
  const nth = /^(.*)#(\d+)$/.exec(header);
  if (nth && !headers.includes(header)) {
    const base = nth[1] as string;
    const matches = headers.flatMap((h, i) => (h === base ? [i] : []));
    const idx = matches[Number(nth[2]) - 1];
    if (idx !== undefined && Number(nth[2]) >= 1) return idx;
    throw new CatalogColumnError(
      `${role} column "${header}" not found (the header "${base}" appears ${matches.length} times)`,
    );
  }
  const matches = headers.flatMap((h, i) => (h === header ? [i] : []));
  if (matches.length === 1) return matches[0] as number;
  const found = headers.filter((h) => h !== '').join(' | ');
  throw new CatalogColumnError(
    matches.length === 0
      ? `${role} column "${header}" not found. Headers in file: ${found}`
      : `${role} column "${header}" appears ${matches.length} times. Headers in file: ${found}`,
  );
}

export function parseCatalogTable(
  table: Table,
  columns: CatalogColumns,
): { shapes: ParsedShape[]; errors: RowError[] } {
  const nameIdx = columnIndex(table.headers, columns.name, 'name');
  const weightIdx = columnIndex(table.headers, columns.weight, 'weight');
  const familyIdx = columns.family ? columnIndex(table.headers, columns.family, 'family') : -1;
  const used = new Set([nameIdx, weightIdx, familyIdx]);

  const shapes: ParsedShape[] = [];
  const errors: RowError[] = [];
  const firstRow = new Map<string, number>();

  for (const row of table.rows) {
    if (row.values.every((v) => toText(v) === '')) continue; // blank line

    const name = toText(row.values[nameIdx]);
    const fail = (message: string) =>
      errors.push({ row: row.rowNumber, shape_name: name || null, message });

    if (name === '') {
      fail('shape name is empty');
      continue;
    }
    const seenAt = firstRow.get(name);
    if (seenAt !== undefined) {
      fail(`duplicate shape name (first seen at row ${seenAt})`);
      continue;
    }
    firstRow.set(name, row.rowNumber);

    const weight = toNumber(row.values[weightIdx]);
    if (weight === null) {
      fail(`weight "${toText(row.values[weightIdx])}" is not a number`);
      continue;
    }
    if (!(weight > 0)) {
      fail(`weight must be > 0 (got ${weight})`);
      continue;
    }

    let family: string;
    if (familyIdx >= 0) {
      family = toText(row.values[familyIdx]);
      if (family === '') {
        fail('family is empty');
        continue;
      }
    } else {
      const prefix = /^[A-Za-z]+/.exec(name);
      if (!prefix) {
        fail('cannot derive family from name (no leading letters); pass a family column');
        continue;
      }
      family = prefix[0];
    }

    const properties: Record<string, unknown> = {};
    table.headers.forEach((header, i) => {
      if (used.has(i) || header === '') return;
      if (table.headers.indexOf(header) !== i) return; // repeated header: the first column wins
      const value = row.values[i];
      if (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '')
      )
        return;
      properties[header] = value;
    });

    const kgPerM = columns.weightUnit === 'kg/m' ? weight : lbPerFtToKgPerM(weight);
    shapes.push({
      shape_name: name,
      family,
      weight_kg_per_m: kgPerM,
      weight_lb_per_ft: columns.weightUnit === 'lb/ft' ? weight : null,
      properties,
    });
  }
  return { shapes, errors };
}
