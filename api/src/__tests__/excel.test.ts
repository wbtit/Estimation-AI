import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generateBom } from '../bom/index.js';
import { buildBomWorkbook } from '../excel/index.js';
import { loadSyntheticMembers } from '../synthetic/fixture.js';
import { validateMembers } from '../validator/index.js';
import { catalogOf, loadWorkbook } from './helpers.js';

async function workbook(): Promise<ExcelJS.Workbook> {
  const catalog = catalogOf({ 'TEST-001': 10, 'TEST-002': 25, 'TEST-003': 40 });
  const { members } = loadSyntheticMembers();
  const validation = validateMembers(members, catalog);
  const buffer = await buildBomWorkbook({
    project: { project_id: 'project-001', name: 'synthetic-001', number: 'SYN-001' },
    catalog_edition: 'TEST-EDITION',
    schema_version: 0,
    validation,
    bom: generateBom(members, catalog, validation),
  });
  return loadWorkbook(buffer);
}

function rowByFirstCell(ws: ExcelJS.Worksheet, text: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (row.getCell(1).value === text) found = row;
  });
  if (!found) throw new Error(`no row starting with "${text}"`);
  return found;
}

describe('Excel export', () => {
  it('has exactly a BOM sheet and a Summary sheet', async () => {
    const wb = await workbook();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['BOM', 'Summary']);
  });

  it('BOM sheet: header, one row per member (sorted by id), and a totals row', async () => {
    const ws = (await workbook()).getWorksheet('BOM')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Member ID',
      'Mark',
      'Type',
      'Profile',
      'Material',
      'Grade',
      'Qty',
      'Unit length (ft-in)',
      'Unit length (mm)',
      'Weight (kg/m)',
      'Unit weight (kg)',
      'Total weight (kg)',
      'Total weight (lb)',
      'Status',
      'In totals',
      'Issues',
    ]);
    expect(ws.rowCount).toBe(1 + 14 + 1);
    const ids: unknown[] = [];
    for (let r = 2; r <= 15; r += 1) ids.push(ws.getRow(r).getCell(1).value);
    expect(ids).toEqual([
      'B1',
      'B10',
      'B11',
      'B12',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B7',
      'B8',
      'B9',
      'C1',
      'C2',
    ]);
  });

  it('BOM sheet: values, feet-inches display, and blanks for what cannot be computed', async () => {
    const ws = (await workbook()).getWorksheet('BOM')!;
    const b2 = rowByFirstCell(ws, 'B2');
    expect(b2.getCell(4).value).toBe('TEST-002');
    expect(b2.getCell(8).value).toBe(`16'-4 7/8"`);
    expect(b2.getCell(9).value).toBe(5000);
    expect(b2.getCell(10).value).toBe(25);
    expect(b2.getCell(12).value).toBe(125);
    expect(b2.getCell(13).value as number).toBeCloseTo(275.578, 3);
    expect(b2.getCell(14).value).toBe('green');
    expect(b2.getCell(15).value).toBe('Yes');

    const b4 = rowByFirstCell(ws, 'B4');
    expect(b4.getCell(4).value).toBeNull();
    expect(b4.getCell(12).value).toBeNull();
    expect(b4.getCell(14).value).toBe('red');
    expect(b4.getCell(15).value).toBe('No');
    expect(b4.getCell(16).value).toBe('MISSING_PROFILE');

    expect(rowByFirstCell(ws, 'B3').getCell(16).value).toBe('MISSING_MATERIAL; MISSING_GRADE');
    expect(rowByFirstCell(ws, 'B11').getCell(7).value).toBe(4);
    expect(rowByFirstCell(ws, 'B11').getCell(12).value).toBe(600);
  });

  it('BOM sheet: totals row sums only the members included in totals', async () => {
    const ws = (await workbook()).getWorksheet('BOM')!;
    const total = rowByFirstCell(ws, 'TOTAL (members in totals)');
    expect(total.getCell(7).value).toBe(14);
    expect(total.getCell(12).value).toBe(1465);
    expect(total.getCell(13).value as number).toBeCloseTo(3229.77, 1);
  });

  it('Summary sheet: inputs, counts, totals, groups, issue counts, and a no-pricing note', async () => {
    const ws = (await workbook()).getWorksheet('Summary')!;
    const value = (label: string) => rowByFirstCell(ws, label).getCell(2).value;
    expect(value('Project')).toBe('synthetic-001');
    expect(value('Catalog edition')).toBe('TEST-EDITION');
    expect(value('Contract schema version')).toBe(0);
    expect(value('Pricing')).toBe('Not included in this export');
    expect(value('Total members')).toBe(14);
    expect(value('Included in totals')).toBe(11);
    expect(value('Excluded from totals (cannot be weighed)')).toBe(3);
    expect(value('Status green')).toBe(6);
    expect(value('Status amber')).toBe(4);
    expect(value('Status red')).toBe(4);
    expect(value('Total length (mm)')).toBe(79000);
    expect(value('Total length (ft-in)')).toBe(`259'-2 1/4"`);
    expect(value('Total weight (kg)')).toBe(1465);
    expect(value('Total weight (tonnes)')).toBe(1.465);

    const profile = rowByFirstCell(ws, 'TEST-002');
    expect([2, 3, 4, 5].map((c) => profile.getCell(c).value)).toEqual([2, 5, 29000, 725]);
    expect(rowByFirstCell(ws, 'beam').getCell(5).value).toBe(1145);
    expect(rowByFirstCell(ws, 'DUPLICATE_MEMBER').getCell(2).value).toBe(2);
    expect(rowByFirstCell(ws, 'UNSUPPORTED_MEMBER').getCell(2).value).toBe(1);
  });

  it('writes plain values only (no formulas) and no pricing columns', async () => {
    const wb = await workbook();
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          expect(['string', 'number']).toContain(typeof cell.value);
        }),
      );
    }
    const headers = (wb.getWorksheet('BOM')!.getRow(1).values as string[]).join(' ');
    expect(headers).not.toMatch(/cost|price|rate/i);
  });

  it('keeps text exactly, including Cyrillic', async () => {
    const catalog = catalogOf({ 'TEST-001': 10 });
    const { members } = loadSyntheticMembers();
    const marked = members.map((m) => ({ ...m, mark: m.member_id === 'B1' ? 'B\u0410' : m.mark }));
    const validation = validateMembers(marked, catalog);
    const buffer = await buildBomWorkbook({
      project: { project_id: 'p', name: 'synthetic-001', number: null },
      catalog_edition: 'E',
      schema_version: 0,
      validation,
      bom: generateBom(marked, catalog, validation),
    });
    const wb = await loadWorkbook(buffer);
    expect(rowByFirstCell(wb.getWorksheet('BOM')!, 'B1').getCell(2).value).toBe('B\u0410');
  });
});
