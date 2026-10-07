// Reads a catalog file (CSV or XLSX) into a plain table of headers + rows. No interpretation
// happens here; parse.ts decides what the columns mean.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

export interface TableRow {
  /** 1-based row number in the source (CSV: record number; XLSX: worksheet row). */
  rowNumber: number;
  values: unknown[];
}

export interface Table {
  headers: string[];
  rows: TableRow[];
}

export interface ReadTableOptions {
  /** XLSX only: worksheet name. Default: the first worksheet. */
  sheet?: string;
  /** 1-based row holding the column headers. Default: 1. */
  headerRow?: number;
}

/** Minimal RFC 4180 reader. Every cell stays a string; nothing is type-guessed. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function cellToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellToPrimitive(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return value.text;
    if ('error' in value) return String(value.error);
    return String(value);
  }
  return value;
}

export async function readTable(filePath: string, options: ReadTableOptions = {}): Promise<Table> {
  const headerRow = options.headerRow ?? 1;
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const records = parseCsv(fs.readFileSync(filePath, 'utf8'));
    const header = records[headerRow - 1];
    if (!header) throw new Error(`header row ${headerRow} not found in ${path.basename(filePath)}`);
    return {
      headers: header.map((h) => h.trim()),
      rows: records.slice(headerRow).map((values, i) => ({ rowNumber: headerRow + 1 + i, values })),
    };
  }

  if (ext === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
    if (!sheet) {
      const names = workbook.worksheets.map((w) => w.name).join(', ');
      throw new Error(`worksheet not found (available: ${names || 'none'})`);
    }
    const width = sheet.columnCount;
    const read = (rowNumber: number): unknown[] =>
      Array.from({ length: width }, (_, c) =>
        cellToPrimitive(sheet.getRow(rowNumber).getCell(c + 1).value),
      );

    const headers = read(headerRow).map((h) => (h === null ? '' : String(h).trim()));
    const rows: TableRow[] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r += 1)
      rows.push({ rowNumber: r, values: read(r) });
    return { headers, rows };
  }

  throw new Error(`unsupported catalog file type "${ext}" (expected .csv or .xlsx)`);
}
