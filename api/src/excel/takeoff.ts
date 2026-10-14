// Excel (xlsx) export of the takeoff table: a "Takeoff" sheet (a row per group) and a "Summary" sheet.
// Same conventions as the BOM export: plain numbers and text, no formulas, no timestamps.
// Lengths in mm and feet-inches. No weight and no price columns.
import ExcelJS from 'exceljs';
import { mmToFeetInches } from '../units/index.js';
import type { Takeoff } from '../review/takeoff.js';

export interface SheetListRow {
  page_number: number;
  sheet_number: string | null;
  page_type: string | null;
  decision: 'include' | 'exclude' | 'undecided';
  included?: boolean;
  decided_by: string | null;
  decided_at: string | null;
  members_not_counted: number;
}

export interface GradeRuleRow {
  family: string;
  grade: string;
  set_by: string;
  set_at: string;
}

export interface TakeoffExportInput {
  project: { project_id: string; name: string; number: string | null };
  takeoff: Takeoff & { sheets?: SheetListRow[]; grades?: GradeRuleRow[] };
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
  'Grade (user-set)',
  'Notes',
  'Pieces with length not trusted (shared line)',
] as const;

const bold = (row: ExcelJS.Row): void => {
  row.font = { bold: true };
};

export async function buildTakeoffWorkbook(input: TakeoffExportInput): Promise<Buffer> {
  const { takeoff } = input;
  const jt = takeoff.joists.totals;
  const jx = takeoff.joists.excluded_red;
  const jd = takeoff.joists.possible_duplicates;
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
      r.kind === 'main'
        ? 'Yes'
        : r.kind === 'red'
          ? 'No (red)'
          : 'No (possible duplicate: same line, same profile, labels at one spot)',
      r.grade,
      r.reasons.join('; '),
      r.length_shared_pieces,
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
  ws.addRow([
    'of which LENGTH NOT TRUSTED (shared line): pieces counted, length left out of the total',
    null,
    null,
    t.length_shared_pieces,
  ]);
  // Phase 10 (owner decision 127): pieces with no length stay in the pieces above
  ws.addRow([
    `${t.unmeasured} pieces without length (counted in the pieces above; no length, so no weight)`,
    null,
    null,
    t.unmeasured,
  ]);
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
    'POSSIBLE DUPLICATES (same line, same profile, labels at one spot), not in totals',
    null,
    null,
    d.pieces,
    d.total_length_ft_in,
    d.total_length_mm,
  ]);
  ws.addRow([
    'COUNT BASIS: one piece per linked line. Labels on a line that already has its piece are listed but add 0; labels in the rows above (older basis, one piece per label)',
    null,
    null,
    t.labels,
  ]);
  ws.getColumn(6).numFmt = '#,##0.0';
  ws.columns.forEach((col, i) => {
    col.width = i === 14 ? 60 : i === 0 ? 26 : 18;
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
      'Pieces with length not trusted (shared line)',
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
      l.totals.length_shared_pieces,
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
      t.length_shared_pieces,
    ]),
  );
  sum.addRow([
    'EXCLUDED (red), not in totals',
    x.members,
    x.pieces,
    x.total_length_ft_in,
    x.total_length_mm,
    x.unmeasured,
    x.length_shared_pieces,
  ]);
  sum.addRow([
    'POSSIBLE DUPLICATES (same line, same profile, labels at one spot), not in totals',
    d.members,
    d.pieces,
    d.total_length_ft_in,
    d.total_length_mm,
    d.unmeasured,
    d.length_shared_pieces,
  ]);
  const und = (takeoff.sheets ?? []).filter((s) => s.decision === 'undecided');
  sum.addRow([]);
  bold(sum.addRow(['Sheets no person has decided yet (in or out by default)', und.length]));
  sum.addRow([`${und.length} sheets undecided`, und.map((s) => s.page_number).join(', ')]);
  const rv = takeoff.review;
  const nm = takeoff.not_member_reasons;
  sum.addRow([]);
  bold(sum.addRow(['Existing steel (listed on its own sheet, not counted)', 'Members', 'Pieces']));
  sum.addRow(['existing steel', takeoff.existing.totals.members, takeoff.existing.totals.pieces]);
  sum.addRow([]);
  bold(sum.addRow(['Labels marked "not a member", by reason (labels only)', 'Labels']));
  sum.addRow(['existing', nm.existing]);
  sum.addRow(['misc steel', nm.misc_steel]);
  sum.addRow(['detail, not this plan', nm.detail]);
  sum.addRow(['other', nm.other]);
  sum.addRow(['all', nm.total]);
  sum.addRow([]);
  bold(
    sum.addRow(["The system's own result per member (rule, before any human action)", 'Members']),
  );
  sum.addRow(['green', rv.system.green]);
  sum.addRow(['amber', rv.system.amber]);
  sum.addRow(['red', rv.system.red]);
  sum.addRow(['unlinked label', rv.system.unlinked]);
  sum.addRow(['added by a person (no system result)', rv.system.added_by_person]);
  sum.addRow([]);
  bold(sum.addRow(['What a person did', 'Members']));
  sum.addRow(['unreviewed', rv.human.unreviewed]);
  sum.addRow(['confirmed ("looks right")', rv.human.confirmed]);
  sum.addRow(['edited or added by hand', rv.human.edited]);
  sum.addRow(['existing steel', rv.human.existing]);
  sum.addRow(['not a member', rv.human.not_member]);
  sum.addRow(['deleted', rv.human.deleted]);
  sum.addRow([]);
  const mu = rv.main_total_unreviewed;
  sum.addRow([
    'Unreviewed system output in the main total',
    `${mu.pieces} of ${mu.of_pieces} pieces, ${mu.total_length_ft_in} of ${mu.of_length_ft_in}`,
  ]);
  sum.addRow([]);
  bold(
    sum.addRow([
      'Joists (K, LH, DLH series; not matched to AISC)',
      'Members',
      'Pieces',
      'Total length (ft-in)',
      'Total length (mm)',
      'Pieces without length',
      'Pieces with length not trusted (shared line)',
    ]),
  );
  sum.addRow([
    'Joists in totals',
    jt.members,
    jt.pieces,
    jt.total_length_ft_in,
    jt.total_length_mm,
    jt.unmeasured,
    jt.length_shared_pieces,
  ]);
  sum.addRow([
    'Joists excluded (red)',
    jx.members,
    jx.pieces,
    jx.total_length_ft_in,
    jx.total_length_mm,
    jx.unmeasured,
    jx.length_shared_pieces,
  ]);
  sum.addRow([
    'Joists possible duplicates (same line, same profile, labels at one spot)',
    jd.members,
    jd.pieces,
    jd.total_length_ft_in,
    jd.total_length_mm,
    jd.unmeasured,
    jd.length_shared_pieces,
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

  // Joists (K, LH, DLH series): their own section, never matched to AISC, designation as read.
  const jw = wb.addWorksheet('Joists', { views: [{ state: 'frozen', ySplit: 1 }] });
  bold(
    jw.addRow([
      'Designation',
      'As read',
      'Qty',
      'Total length (ft-in)',
      'Total length (mm)',
      'Unit lengths (ft-in)',
      'Level',
      'Sheets (page numbers)',
      'Status',
      'In totals',
      'Grade (user-set)',
      'Notes',
      'Pieces with length not trusted (shared line)',
    ]),
  );
  for (const r of takeoff.joists.rows) {
    const row = jw.addRow([
      r.profile,
      r.profile_raw,
      r.quantity,
      r.total_length_ft_in,
      r.total_length_mm,
      r.unit_lengths_mm.map((mm) => mmToFeetInches(mm)).join('; '),
      r.level,
      r.sheets.join(', '),
      r.color,
      r.kind === 'main'
        ? 'Yes'
        : r.kind === 'red'
          ? 'No (red)'
          : 'No (possible duplicate: same line, same profile, labels at one spot)',
      r.grade,
      r.reasons.join('; '),
      r.length_shared_pieces,
    ]);
    row.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_FILL[r.color] },
    };
  }
  bold(
    jw.addRow([
      'TOTAL (rows in totals)',
      null,
      jt.pieces,
      jt.total_length_ft_in,
      jt.total_length_mm,
    ]),
  );
  jw.addRow([
    'of which LENGTH NOT TRUSTED (shared line): pieces counted, length left out of the total',
    null,
    jt.length_shared_pieces,
  ]);
  jw.addRow([
    'EXCLUDED (red), not in totals',
    null,
    jx.pieces,
    jx.total_length_ft_in,
    jx.total_length_mm,
  ]);
  jw.addRow([
    'POSSIBLE DUPLICATES (same line, same profile, labels at one spot), not in totals',
    null,
    jd.pieces,
    jd.total_length_ft_in,
    jd.total_length_mm,
  ]);
  jw.getColumn(5).numFmt = '#,##0.0';
  jw.columns.forEach((col, i) => {
    col.width = i === 11 ? 60 : i === 0 ? 26 : 18;
  });

  // Existing steel: listed, never counted in the totals. Lengths are the trusted ones only.
  const ew = wb.addWorksheet('Existing (not counted)', { views: [{ state: 'frozen', ySplit: 1 }] });
  bold(
    ew.addRow([
      'Sheet (page number)',
      'Mark',
      'Profile (as read)',
      'Profile',
      'Qty',
      'Trusted length (ft-in)',
      'Trusted length (mm)',
      'Pieces with length not trusted (shared line)',
      'Level',
    ]),
  );
  for (const r of takeoff.existing.rows) {
    ew.addRow([
      r.source.page_number,
      r.mark,
      r.profile_raw,
      r.profile,
      r.quantity,
      r.total_length_ft_in,
      r.total_length_mm,
      r.length_shared_pieces,
      r.level,
    ]);
  }
  const et = takeoff.existing.totals;
  bold(
    ew.addRow([
      'EXISTING TOTAL (not counted anywhere else)',
      null,
      null,
      null,
      et.pieces,
      et.total_length_ft_in,
      et.total_length_mm,
      et.length_shared_pieces,
    ]),
  );
  ew.columns.forEach((col, i) => {
    col.width = i === 0 ? 24 : 20;
  });

  // Count mode (Phase 8): the totals above are CONFIRMED pieces only (a click or an accepted
  // suggestion); what the system found and nobody decided is listed here, never in a total.
  if (takeoff.count_mode) {
    const sw = wb.addWorksheet('Suggested (undecided)', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    bold(
      sw.addRow([
        'Mark',
        'Size as written',
        'Size',
        'Pieces (one per linked line)',
        'Labels',
        'Sheets',
      ]),
    );
    for (const r of takeoff.suggested.rows) {
      sw.addRow([r.mark, r.profile_raw, r.profile, r.quantity, r.labels, r.sheets.join(', ')]);
    }
    const st = takeoff.suggested.totals;
    bold(sw.addRow(['SUGGESTED, NOT IN ANY TOTAL', null, null, st.pieces, st.labels]));
    sw.columns.forEach((col, i) => {
      col.width = i === 0 ? 24 : 22;
    });
    ws.addRow([]);
    ws.addRow([
      'COUNT MODE: the totals above are confirmed pieces only (a click or an accepted suggestion); suggested pieces nobody decided are on the sheet "Suggested (undecided)"',
    ]);
  }

  // Grades are typed by a person per shape family; the system never fills one in.
  const gw = wb.addWorksheet('Grades');
  bold(gw.addRow(['Shape family', 'Grade (user-set)', 'Set by', 'Set at']));
  const families = [
    ...new Set(
      [...takeoff.rows, ...takeoff.joists.rows]
        .map((r) => r.family)
        .filter((f): f is string => !!f),
    ),
  ].sort();
  for (const f of families) {
    const rule = takeoff.grades?.find((g) => g.family === f);
    gw.addRow([f, rule?.grade ?? 'not set', rule?.set_by ?? null, rule?.set_at ?? null]);
  }
  gw.columns.forEach((col) => {
    col.width = 24;
  });

  if (takeoff.sheets) {
    const sh = wb.addWorksheet('Sheets');
    bold(
      sh.addRow([
        'Page',
        'Sheet number',
        'Page type (a guess)',
        'Decision',
        'Decided by',
        'Decided at',
        'Members stored but not counted',
      ]),
    );
    for (const s of takeoff.sheets) {
      sh.addRow([
        s.page_number,
        s.sheet_number,
        s.page_type,
        s.decision === 'include'
          ? 'in the takeoff'
          : s.decision === 'exclude'
            ? 'excluded'
            : s.included === false
              ? 'UNDECIDED (not in the totals)'
              : 'UNDECIDED (in the totals by default)',
        s.decided_by,
        s.decided_at,
        s.members_not_counted,
      ]);
    }
    sh.columns.forEach((col, i) => {
      col.width = i === 6 ? 30 : i === 3 ? 28 : 18;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
