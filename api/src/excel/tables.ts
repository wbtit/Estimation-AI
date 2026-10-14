// Excel export of the Stage 1 tables: a job sheet (summary by kind, then the overall table), one
// sheet per page, and a corrections sheet. Plain values, no formulas. While any sheet is
// unconfirmed the header of every sheet says DRAFT (and the file name carries DRAFT too).
import ExcelJS from 'exceljs';
import type { DraftStatus } from '../review/flags.js';
import type { JobTable, PageTable, TableRow } from '../review/tables.js';

export const TABLE_HEADERS = [
  'Kind',
  'Reference Dwg No.',
  'Quantity',
  'SHAPE',
  'Size',
  'Name',
  'Length ft',
  'Length In',
  'Unit W',
  'Total W',
  'Grade',
] as const;

export interface CorrectionRow {
  when: string;
  who: string;
  page_number: number | null;
  tag: string;
  profile: string | null;
  field: string;
  before: string;
  after: string;
  is_undo: boolean;
}

export interface TablesExportInput {
  draft: DraftStatus;
  job: JobTable;
  pages: PageTable[];
  corrections: CorrectionRow[];
}

const FILL: Record<string, string> = {
  green: 'FFC6EFCE',
  amber: 'FFFFEB9C',
  grey: 'FFE0E0E0',
  red: 'FFFFC7CE',
};

export function exportFileName(project: { number: string | null }, draft: DraftStatus): string {
  const base = (project.number ?? 'job').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'job';
  return `${base}_takeoff${draft.reviewed ? '' : '_DRAFT'}.xlsx`;
}

function headerText(draft: DraftStatus): string {
  return draft.reviewed ? 'Reviewed' : `DRAFT - ${draft.label}`;
}

function rowValues(r: TableRow): (string | number | null)[] {
  return [
    r.kind ?? '',
    r.reference,
    r.quantity,
    r.shape ?? '',
    r.size ?? '',
    r.name,
    r.length_ft, // from a two-click measurement only (else empty: lengths are Stage 2)
    r.length_in,
    r.unit_w,
    r.total_w,
    r.grade ?? '',
  ];
}

function addTable(ws: ExcelJS.Worksheet, rows: TableRow[]): void {
  const head = ws.addRow([...TABLE_HEADERS]);
  head.font = { bold: true };
  for (const r of rows) {
    const row = ws.addRow(rowValues(r));
    row.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: FILL[r.colour] ?? FILL.green },
    };
    const notes = r.flags.join('; ');
    if (notes) row.getCell(6).note = notes;
    if (r.grade === null && r.grade_suggestion)
      row.getCell(11).note = `grade not set; suggested ${r.grade_suggestion} (not applied)`;
  }
}

function addApart(
  ws: ExcelJS.Worksheet,
  label: string,
  a: { pieces: number; by_kind: { kind: string | null; pieces: number }[] },
): void {
  if (a.pieces === 0) return;
  const detail = a.by_kind.map((k) => `${k.kind ?? 'no kind'}: ${k.pieces}`).join(', ');
  const row = ws.addRow([label, '', a.pieces, '', '', detail]);
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.red } };
}

function sheetName(used: Set<string>, base: string): string {
  const clean =
    base
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 28) || 'page';
  let name = clean;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${clean.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export async function buildTablesWorkbook(input: TablesExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  const banner = headerText(input.draft);

  const job = wb.addWorksheet(sheetName(used, 'Job'));
  const title = job.addRow([banner]);
  title.font = {
    bold: true,
    size: 13,
    color: { argb: input.draft.reviewed ? 'FF1F7A3A' : 'FFA15C00' },
  };
  job.addRow(['Lengths and Total W are added in Stage 2 (the cells are empty on purpose).']);
  job.addRow([]);
  job.addRow(['Summary by kind']).font = { bold: true };
  const sh = job.addRow(['Kind', 'Scope', 'Quantity', 'Groups', 'Note']);
  sh.font = { bold: true };
  for (const s of input.job.summary) {
    job.addRow([s.kind ?? '(no kind)', s.scope ?? '', s.quantity, s.groups, s.note ?? '']);
  }
  job.addRow([]);
  addTable(job, input.job.rows);
  job.addRow(['TOTAL (main total)', '', input.job.quantity]).font = { bold: true };
  addApart(job, 'Red, not counted', input.job.red);
  addApart(job, 'Existing, not counted', input.job.existing);
  addApart(job, 'Not counted (excluded kinds)', input.job.not_counted);
  addApart(job, 'Not computed (misc)', input.job.misc);
  addApart(job, 'Suggested, not yet confirmed (count mode, not in the total)', input.job.suggested);
  if (input.job.unlinked > 0) job.addRow(['Unlinked labels (in no total)', '', input.job.unlinked]);
  if (input.job.sheets_excluded.length > 0)
    job.addRow([
      `${input.job.sheets_excluded.length} sheets excluded`,
      '',
      '',
      '',
      '',
      input.job.sheets_excluded.join(', '),
    ]);
  job.addRow([banner]);

  for (const p of input.pages) {
    const ws = wb.addWorksheet(sheetName(used, `p${p.page_number} ${p.sheet_number ?? ''}`));
    ws.addRow([banner]).font = {
      bold: true,
      color: { argb: input.draft.reviewed ? 'FF1F7A3A' : 'FFA15C00' },
    };
    ws.addRow([
      `Page ${p.page_number}${p.sheet_number ? ` (${p.sheet_number})` : ''}. Lengths are added in Stage 2.`,
    ]);
    addTable(ws, p.rows);
    ws.addRow(['TOTAL (page)', '', p.quantity]).font = { bold: true };
    addApart(ws, 'Red, not counted', p.red);
    addApart(ws, 'Existing, not counted', p.existing);
    addApart(ws, 'Not counted (excluded kinds)', p.not_counted);
    addApart(ws, 'Not computed (misc)', p.misc);
    addApart(ws, 'Suggested, not yet confirmed (count mode, not in the total)', p.suggested);
    if (p.unlinked > 0) ws.addRow(['Unlinked labels (in no total)', '', p.unlinked]);
  }

  const cs = wb.addWorksheet(sheetName(used, 'Corrections'));
  cs.addRow([banner]).font = { bold: true };
  cs.addRow(['When', 'Who', 'Page', 'Tag', 'Size', 'What', 'Before', 'After', 'Undo']).font = {
    bold: true,
  };
  for (const c of input.corrections) {
    cs.addRow([
      c.when,
      c.who,
      c.page_number,
      c.tag,
      c.profile ?? '',
      c.field,
      c.before,
      c.after,
      c.is_undo ? 'yes' : '',
    ]);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
