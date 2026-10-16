// A saved final as an answer key (Phase 11b): the same row format the evaluation tools read from
// fixtures/private/target/rows.json ({cols, rows}; worker/tools/takeoff/phase8_eval.py), so every
// reviewed job can become ground truth. One row per BOM row of the line-first BOM main total:
//   ref      "-/<sheet number>" (the `detail/sheet` form; the detail is unknown), else "-/P<page>"
//   qty      the piece's quantity
//   shape    the catalog's type column (W, HSS, ...), else the profile's letters
//   size     the section without the shape letters (W16X26 -> 16X26)
//   name     the category (Beams, Column, ...), which the tools' kind table reads
//   len_ft / len_in   the length in feet and inches (inches to 1/16)
//   unit_w   catalog lb/ft; total_w = qty x length (ft) x unit_w (lb)
//   grade    the project's grade for the shape family, else null
import type { LineFirstBom } from './line-first-bom.js';

export const ANSWER_KEY_COLS = {
  ref: 'Reference',
  qty: 'Qty',
  shape: 'Shape',
  size: 'Size',
  name: 'Name',
  len_ft: 'Length (ft)',
  len_in: 'Length (in)',
  unit_w: 'Unit W (lb/ft)',
  total_w: 'Total W (lb)',
  grade: 'Grade',
} as const;

export interface AnswerKeyRow {
  ref: string;
  qty: number;
  shape: string | null;
  size: string | null;
  name: string | null;
  len_ft: number | null;
  len_in: number | null;
  unit_w: number | null;
  total_w: number | null;
  grade: string | null;
}

/** Feet and inches (inches to 1/16) of a length in mm. */
export function feetAndInches(mm: number): { ft: number; inch: number } {
  const sixteenths = Math.round((mm / 25.4) * 16);
  const ft = Math.floor(sixteenths / (12 * 16));
  return { ft, inch: (sixteenths - ft * 12 * 16) / 16 };
}

export function answerKey(
  bom: LineFirstBom,
  sheets: ReadonlyMap<string, { sheet_number: string | null; page_index: number }>,
): { cols: typeof ANSWER_KEY_COLS; rows: AnswerKeyRow[] } {
  const rows: AnswerKeyRow[] = [];
  for (const r of bom.rows) {
    if (!r.in_main_total) continue;
    const sheet = r.sheet_id ? sheets.get(r.sheet_id) : undefined;
    const ref = sheet ? `-/${sheet.sheet_number ?? `P${sheet.page_index + 1}`}` : '-/?';
    const section = r.section?.toUpperCase().replace(/\s+/g, '') ?? null;
    const shape = r.section_type ?? (section ? (/^[A-Z]+/.exec(section)?.[0] ?? null) : null);
    const size =
      section && shape && section.startsWith(shape.toUpperCase())
        ? section.slice(shape.length)
        : section;
    const fi = r.length_mm === null ? null : feetAndInches(r.length_mm);
    const lengthFt = r.length_mm === null ? null : r.length_mm / 304.8;
    rows.push({
      ref,
      qty: r.qty,
      shape,
      size,
      name: r.category,
      len_ft: fi ? fi.ft : null,
      len_in: fi ? fi.inch : null,
      unit_w: r.unit_w_lb_ft,
      total_w:
        lengthFt !== null && r.unit_w_lb_ft !== null
          ? Math.round(r.qty * lengthFt * r.unit_w_lb_ft * 100) / 100
          : null,
      grade: r.grade,
    });
  }
  return { cols: ANSWER_KEY_COLS, rows };
}
