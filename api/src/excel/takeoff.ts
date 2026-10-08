// Excel (xlsx) export of the takeoff table: a "Takeoff" sheet (a row per group) and a "Summary" sheet.
// Same conventions as the BOM export: plain numbers and text, no formulas, no timestamps.
// Lengths in mm and feet-inches. No weight and no price columns.
import ExcelJS from 'exceljs';
import { mmToFeetInches } from '../units/index.js';
import type { Takeoff } from '../review/takeoff.js';

export interface TakeoffExportInput {
  project: { project_id: string; name: string; number: string | null };
  takeoff: Takeoff;
}

const STATUS_FILL: Record<string, string> = {
  green: 'FFC6EFCE',
  amber: 'FFFFEB9C',
  red: 'FFFFC7CE',
};

export const TAKEOFF_HEADERS = [
  'Mark',
  'Profile (as read)',
  'Profile',
  'Qty',
  'Total length (ft-in)',
  'Total length (mm)',
  'Unit lengths (ft-in)',
  'Pieces without length',
  'Level',
  'Sheets (page numbers)',
  'Status',
  'Checked by a person',
  'In totals',
  'Notes',
] as const;

const bold = (row: ExcelJS.Row): void => {
  row.font = { bold: true };
};

export async function buildTakeoffWorkbook(input: TakeoffExportInput): Promise<Buffer> {
  const { takeoff } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Estimation-AI';

  const ws = wb.addWorksheet('Takeoff', { views: [{ state: 'frozen', ySplit: 1 }] });
  bold(ws.addRow([...TAKEOFF_HEADERS]));
  for (const r of takeoff.rows) {
    const row = ws.addRow([
      r.mark,
      r.profile_raw,
      r.profile,
      r.quantity,
      r.total_length_ft_in,
      r.total_length_mm,
      r.unit_lengths_mm.map((mm) => mmToFeetInches(mm)).join('; '),
      r.unmeasured,
      r.level,
      r.sheets.join(', '),
      r.color,
      r.confirmed ? 'Yes' : 'No',
      r.kind === 'main' ? 'Yes' : r.kind === 'red' ? 'No (red)' : 'No (possible duplicate)',
      r.reasons.join('; '),
    ]);
    row.getCell(11).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_FILL[r.color] },
    };
  }
  const t = takeoff.totals;
  bold(
    ws.addRow([
      'TOTAL (rows in totals)',
      null,
      null,
      t.pieces,
      t.total_length_ft_in,
      t.total_length_mm,
    ]),
  );
  const x = takeoff.excluded_red;
  ws.addRow([
    'EXCLUDED (red), not in totals',
    null,
    null,
    x.pieces,
    x.total_length_ft_in,
    x.total_length_mm,
  ]);
  const d = takeoff.possible_duplicates;
  ws.addRow([
    'POSSIBLE DUPLICATES (shared line), not in totals',
    null,
    null,
    d.pieces,
    d.total_length_ft_in,
    d.total_length_mm,
  ]);
  ws.getColumn(6).numFmt = '#,##0.0';
  ws.columns.forEach((col, i) => {
    col.width = i === 13 ? 60 : i === 0 ? 26 : 18;
  });

  const sum = wb.addWorksheet('Summary');
  bold(sum.addRow(['Takeoff summary']));
  sum.addRow(['Project', input.project.name]);
  sum.addRow(['Project number', input.project.number]);
  sum.addRow(['Project id', input.project.project_id]);
  sum.addRow(['Weights and prices', 'Not included in this export']);
  sum.addRow([]);
  bold(
    sum.addRow([
      'Level',
      'Members',
      'Pieces',
      'Total length (ft-in)',
      'Total length (mm)',
      'Pieces without length',
    ]),
  );
  for (const l of takeoff.by_level) {
    sum.addRow([
      l.level ?? '(no level)',
      l.totals.members,
      l.totals.pieces,
      l.totals.total_length_ft_in,
      l.totals.total_length_mm,
      l.totals.unmeasured,
    ]);
  }
  bold(
    sum.addRow([
      'TOTAL (red excluded)',
      t.members,
      t.pieces,
      t.total_length_ft_in,
      t.total_length_mm,
      t.unmeasured,
    ]),
  );
  sum.addRow([
    'EXCLUDED (red), not in totals',
    x.members,
    x.pieces,
    x.total_length_ft_in,
    x.total_length_mm,
    x.unmeasured,
  ]);
  sum.addRow([
    'POSSIBLE DUPLICATES (shared line), not in totals',
    d.members,
    d.pieces,
    d.total_length_ft_in,
    d.total_length_mm,
    d.unmeasured,
  ]);
  sum.addRow([]);
  bold(sum.addRow(['Unlinked labels (profile labels with no line; not members, in no total)']));
  sum.addRow(['Unlinked labels on the sheets of this takeoff', takeoff.unlinked_labels.count]);
  for (const s of takeoff.unlinked_labels.by_sheet) {
    sum.addRow([`Sheet page ${s.page_number ?? '?'}`, s.count]);
  }
  sum.columns.forEach((col, i) => {
    col.width = i === 0 ? 34 : 20;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
