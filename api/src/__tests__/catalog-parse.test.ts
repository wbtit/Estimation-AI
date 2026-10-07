import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalogFile } from '../catalog/load-file.js';
import { CatalogColumnError, parseCatalogTable, type CatalogColumns } from '../catalog/parse.js';
import { parseCsv, readTable, type Table } from '../catalog/table.js';
import { SYNTHETIC_CATALOG_CSV } from '../synthetic/fixture.js';

const kgColumns: CatalogColumns = {
  name: 'shape',
  weight: 'kg_m',
  weightUnit: 'kg/m',
  family: 'type',
};

function table(rows: unknown[][]): Table {
  return {
    headers: ['shape', 'type', 'kg_m', 'extra'],
    rows: rows.map((values, i) => ({ rowNumber: i + 2, values })),
  };
}

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF and a BOM', () => {
    const text = '\uFEFFa,b\r\n"x,1","q""r"\r\n"two\nlines",3\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x,1', 'q"r'],
      ['two\nlines', '3'],
    ]);
  });

  it('keeps every cell as a string (nothing is type-guessed)', () => {
    expect(parseCsv('1/2,10,2026-01-01')).toEqual([['1/2', '10', '2026-01-01']]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b')).toThrow(/quoted/);
  });
});

describe('parseCatalogTable: weight > 0 is enforced', () => {
  it('accepts valid rows and keeps other columns as properties', () => {
    const { shapes, errors } = parseCatalogTable(
      table([['TEST-001', 'TEST', '10', 'note']]),
      kgColumns,
    );
    expect(errors).toEqual([]);
    expect(shapes).toEqual([
      {
        shape_name: 'TEST-001',
        family: 'TEST',
        weight_kg_per_m: 10,
        weight_lb_per_ft: null,
        properties: { extra: 'note' },
      },
    ]);
  });

  it.each([
    ['zero', '0', /weight must be > 0/],
    ['negative', '-5', /weight must be > 0/],
    ['text', 'heavy', /not a number/],
    ['empty', '', /not a number/],
    ['dash placeholder', '\u2013', /not a number/],
  ])('rejects a %s weight with its row number', (_label, weight, message) => {
    const { shapes, errors } = parseCatalogTable(
      table([['TEST-001', 'TEST', weight, '']]),
      kgColumns,
    );
    expect(shapes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2, shape_name: 'TEST-001' });
    expect(errors[0]?.message).toMatch(message);
  });

  it('collects every bad row instead of stopping at the first', () => {
    const { shapes, errors } = parseCatalogTable(
      table([
        ['TEST-001', 'TEST', '10', ''],
        ['TEST-002', 'TEST', '0', ''],
        ['', 'TEST', '5', ''],
        ['TEST-001', 'TEST', '11', ''],
      ]),
      kgColumns,
    );
    expect(shapes.map((s) => s.shape_name)).toEqual(['TEST-001']);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(errors[1]?.message).toMatch(/name is empty/);
    expect(errors[2]?.message).toMatch(/duplicate shape name \(first seen at row 2\)/);
  });

  it('skips fully blank lines', () => {
    const { shapes, errors } = parseCatalogTable(
      table([
        ['TEST-001', 'TEST', '10', ''],
        ['', '', '', ''],
      ]),
      kgColumns,
    );
    expect(errors).toEqual([]);
    expect(shapes).toHaveLength(1);
  });
});

describe('parseCatalogTable: units and columns', () => {
  it('converts lb/ft to kg/m and keeps the source value', () => {
    const { shapes } = parseCatalogTable(table([['TEST-101', 'TEST', '100', '']]), {
      ...kgColumns,
      weightUnit: 'lb/ft',
    });
    expect(shapes[0]?.weight_lb_per_ft).toBe(100);
    expect(shapes[0]?.weight_kg_per_m).toBeCloseTo(148.8163944, 6);
  });

  it('derives the family from the leading letters when no family column is given', () => {
    const { shapes, errors } = parseCatalogTable(table([['TEST-001', '', '10', '']]), {
      name: 'shape',
      weight: 'kg_m',
      weightUnit: 'kg/m',
    });
    expect(errors).toEqual([]);
    expect(shapes[0]?.family).toBe('TEST');
  });

  it('reports a missing column and lists the headers that were found', () => {
    expect(() => parseCatalogTable(table([]), { ...kgColumns, weight: 'W' })).toThrow(
      CatalogColumnError,
    );
    expect(() => parseCatalogTable(table([]), { ...kgColumns, weight: 'W' })).toThrow(
      /weight column "W" not found. Headers in file: shape \| type \| kg_m \| extra/,
    );
  });

  it('rejects an ambiguous (duplicated) header', () => {
    const dup: Table = { headers: ['shape', 'kg_m', 'kg_m'], rows: [] };
    expect(() =>
      parseCatalogTable(dup, { name: 'shape', weight: 'kg_m', weightUnit: 'kg/m' }),
    ).toThrow(/appears 2 times/);
  });
});

describe('catalog files', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads the synthetic CSV fixture', async () => {
    const { shapes, errors } = await loadCatalogFile(SYNTHETIC_CATALOG_CSV, {
      columns: kgFixtureColumns,
    });
    expect(errors).toEqual([]);
    expect(shapes.map((s) => [s.shape_name, s.weight_kg_per_m])).toEqual([
      ['TEST-001', 10],
      ['TEST-002', 25],
      ['TEST-003', 40],
    ]);
  });

  it('loads an XLSX file: numeric cells, formula results, a chosen sheet and header row', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notes').addRow(['not the catalog']);
    const ws = wb.addWorksheet('Shapes');
    ws.addRow(['synthetic file, title row above the headers']);
    ws.addRow(['shape', 'type', 'lb_ft', 'comment']);
    ws.addRow(['TEST-101', 'TEST', 100, 'plain number']);
    ws.addRow([
      'TEST-102',
      'TEST',
      { formula: '50+50', result: 100 },
      'formula with cached result',
    ]);
    ws.addRow(['TEST-103', 'TEST', 0, 'zero weight']);
    const file = path.join(dir, 'catalog.xlsx');
    await wb.xlsx.writeFile(file);

    const table = await readTable(file, { sheet: 'Shapes', headerRow: 2 });
    expect(table.headers).toEqual(['shape', 'type', 'lb_ft', 'comment']);

    const { shapes, errors } = await loadCatalogFile(file, {
      sheet: 'Shapes',
      headerRow: 2,
      columns: { name: 'shape', family: 'type', weight: 'lb_ft', weightUnit: 'lb/ft' },
    });
    expect(shapes.map((s) => s.shape_name)).toEqual(['TEST-101', 'TEST-102']);
    expect(shapes[1]?.weight_lb_per_ft).toBe(100);
    expect(errors).toEqual([
      { row: 5, shape_name: 'TEST-103', message: 'weight must be > 0 (got 0)' },
    ]);
  });

  it('reports a missing worksheet and an unsupported file type', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Only').addRow(['x']);
    const file = path.join(dir, 'one-sheet.xlsx');
    await wb.xlsx.writeFile(file);
    await expect(readTable(file, { sheet: 'Missing' })).rejects.toThrow(
      /worksheet not found \(available: Only\)/,
    );
    await expect(readTable(path.join(dir, 'data.txt'))).rejects.toThrow(
      /unsupported catalog file type/,
    );
  });
});

const kgFixtureColumns: CatalogColumns = {
  name: 'shape',
  family: 'family',
  weight: 'weight_kg_per_m',
  weightUnit: 'kg/m',
};
