// Excel (xlsx) export: one "BOM" sheet (a row per member) and one "Summary" sheet.
// Lengths are shown in mm and feet-inches, weights in kg and lb. Values are written as plain
// numbers and text (no formulas). No pricing in this phase, and no timestamps, so the content is
// a pure function of the inputs.
import ExcelJS from 'exceljs';
import type { Bom, BomGroup } from '../bom/index.js';
import { kgToLb, mmToFeetInches } from '../units/index.js';
import { ISSUE_CODES, type ValidationReport } from '../validator/index.js';

export interface ExportInput {
  project: { project_id: string; name: string; number: string | null };
  catalog_edition: string;
  schema_version: number;
  validation: ValidationReport;
  bom: Bom;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const STATUS_FILL: Record<string, string> = {
  green: 'FFC6EFCE',
  amber: 'FFFFEB9C',
  red: 'FFFFC7CE',
};

const BOM_HEADERS = [
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
] as const;

function boldRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
}

function addBomSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const ws = wb.addWorksheet('BOM', { views: [{ state: 'frozen', ySplit: 1 }] });
  boldRow(ws.addRow([...BOM_HEADERS]));

  for (const l of input.bom.lines) {
    const row = ws.addRow([
      l.member_id,
      l.mark,
      l.type,
      l.profile,
      l.material,
      l.grade,
      l.quantity,
      l.unit_length_mm === null ? null : mmToFeetInches(l.unit_length_mm),
      l.unit_length_mm,
      l.weight_kg_per_m,
      l.unit_weight_kg,
      l.total_weight_kg,
      l.total_weight_kg === null ? null : kgToLb(l.total_weight_kg),
      l.status,
      l.included_in_totals ? 'Yes' : 'No',
      l.issue_codes.join('; '),
    ]);
    row.getCell(14).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_FILL[l.status] },
    };
  }

  const t = input.bom.totals;
  const total = ws.addRow([
    'TOTAL (members in totals)',
    null,
    null,
    null,
    null,
    null,
    t.pieces_included,
    null,
    null,
    null,
    null,
    t.total_weight_kg,
    kgToLb(t.total_weight_kg),
  ]);
  boldRow(total);

  ws.getColumn(9).numFmt = '#,##0.0';
  for (const c of [10, 11, 12, 13]) ws.getColumn(c).numFmt = '#,##0.00';
  ws.columns.forEach((col, i) => {
    col.width = i === 15 ? 60 : i === 0 ? 26 : 16;
  });
}

function addGroupTable(ws: ExcelJS.Worksheet, title: string, groups: BomGroup[]): void {
  ws.addRow([]);
  boldRow(ws.addRow([title]));
  boldRow(
    ws.addRow([
      'Key',
      'Members',
      'Pieces',
      'Total length (mm)',
      'Total weight (kg)',
      'Total weight (lb)',
    ]),
  );
  for (const g of groups) {
    ws.addRow([
      g.key === '' ? '(no profile)' : g.key,
      g.member_count,
      g.piece_count,
      g.total_length_mm,
      g.total_weight_kg,
      kgToLb(g.total_weight_kg),
    ]);
  }
}

function addSummarySheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const ws = wb.addWorksheet('Summary');
  const { totals } = input.bom;
  const counts = input.validation.counts;

  boldRow(ws.addRow(['Bill of materials summary']));
  ws.addRow(['Project', input.project.name]);
  ws.addRow(['Project number', input.project.number]);
  ws.addRow(['Project id', input.project.project_id]);
  ws.addRow(['Catalog edition', input.catalog_edition]);
  ws.addRow(['Contract schema version', input.schema_version]);
  ws.addRow(['Pricing', 'Not included in this export']);

  ws.addRow([]);
  boldRow(ws.addRow(['Members']));
  ws.addRow(['Total members', totals.members]);
  ws.addRow(['Included in totals', totals.members_included]);
  ws.addRow(['Excluded from totals (cannot be weighed)', totals.members_excluded]);
  ws.addRow(['Status green', counts.green]);
  ws.addRow(['Status amber', counts.amber]);
  ws.addRow(['Status red', counts.red]);

  ws.addRow([]);
  boldRow(ws.addRow(['Totals (members included only)']));
  ws.addRow(['Pieces', totals.pieces_included]);
  ws.addRow(['Total length (mm)', totals.total_length_mm]);
  ws.addRow(['Total length (ft-in)', mmToFeetInches(totals.total_length_mm)]);
  ws.addRow(['Total weight (kg)', totals.total_weight_kg]);
  ws.addRow(['Total weight (lb)', kgToLb(totals.total_weight_kg)]);
  ws.addRow(['Total weight (tonnes)', totals.total_weight_kg / 1000]);

  addGroupTable(ws, 'By profile', input.bom.by_profile);
  addGroupTable(ws, 'By type', input.bom.by_type);

  ws.addRow([]);
  boldRow(ws.addRow(['Validation issues']));
  boldRow(ws.addRow(['Code', 'Count']));
  for (const code of ISSUE_CODES) ws.addRow([code, input.validation.issue_counts[code]]);

  ws.getColumn(1).width = 44;
  for (const c of [2, 3, 4, 5, 6]) ws.getColumn(c).width = 20;
}

export async function buildBomWorkbook(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Estimation-AI';
  addBomSheet(wb, input);
  addSummarySheet(wb, input);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
