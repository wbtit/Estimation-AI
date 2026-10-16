// Types of the review UI's API (api/src/routes/review-ui.ts, build.ts) and the pure logic of the
// workspace: hit tests, layer filters, "Mixed" values, the Summary, hash routes. Page points are
// displayed page points (rotation applied, origin top-left, y down), like the API.

export type Pt2 = [number, number];
export type Role = "column_plan" | "framing" | null;
export type Badge =
  | "Building"
  | "Requesting Build"
  | "Not built"
  | "Skip"
  | "Reviewed"
  | "Not confirmed"
  | "Built";

export interface Project {
  id: string;
  name: string;
  number: string | null;
  status: string;
  stage: "Estimating" | "Submitted" | "Won" | "Lost";
  archived: boolean;
  created_at: string;
  thumbnail_url?: string | null;
  document: {
    original_filename: string;
    page_count: number | null;
    pages_scanned: number;
    scan_status: string;
  } | null;
}

export const STAGES = ["Estimating", "Submitted", "Won", "Lost"] as const;

export interface ScaleFound {
  raw: string;
  kind: string;
  ratio: number | null;
  count: number;
}

export interface Page {
  id: string;
  page_index: number;
  page_number: number;
  sheet_number: string | null;
  title: string | null;
  page_type: string | null;
  page_kind: string;
  width_pt: number | null;
  height_pt: number | null;
  rotation: number | null;
  thumbnail_url: string | null;
  badge: Badge;
  reasons: string[];
  notes: string[];
  system_values: string[];
  setup: {
    role: Role;
    crop: Box | null;
    pen_class: string | null;
    pen_class_source: string | null;
    scale_ratio: number | null;
    scale_text: string | null;
    tos_mm: number | null;
    tos_raw: string | null;
    column_plan_sheet_id: string | null;
  };
  scales_found: ScaleFound[];
  built_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  pending_edits: number;
  counts: {
    pieces: number;
    beams: number;
    columns: number;
    braces: number;
    found: number;
    needs_review: number;
    attention: number;
  };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SizeEvidence {
  size?: {
    state: string;
    rule: string | null;
    kind?: string;
    distance_pt?: number | null;
    box?: [number, number, number, number];
  };
  studs?: { raw: string; count: number } | null;
  camber?: { raw: string } | null;
}

export interface Piece {
  id: string;
  member_id: string;
  sheet_id: string | null;
  type: string;
  kind: string | null;
  tag: string | null;
  quantity: number;
  profile: string | null;
  profile_raw: string | null;
  studs: number | null;
  camber_raw: string | null;
  ignored: boolean;
  deleted: boolean;
  added: boolean;
  edited: boolean;
  a: Pt2 | null;
  b: Pt2 | null;
  ends_moved: boolean;
  length_mm: number | null;
  elevation_mm: number | null;
  build_state: "found" | "needs_review" | "attention" | null;
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  scale_ratio: number | null;
  evidence: SizeEvidence | null;
}

export interface GridLine {
  label: string | null;
  family: string | null;
  a: Pt2;
  b: Pt2;
  bubble: { cx: number; cy: number; r: number } | null;
}

export interface LineFirstPage {
  sheet_id: string;
  crop: Box | null;
  pen_class: string | null;
  tos_mm: number | null;
  scale_ratio: number | null;
  grid_lines: GridLine[];
  pieces: Piece[];
}

export interface BomRow {
  main: 1;
  category: string | null;
  piecemark: string | null;
  qty: number;
  section_type: string | null;
  section: string | null;
  length_mm: number | null;
  grade: string | null;
  weight_kg: number | null;
  weight_lb: number | null;
  member: string;
  sheet_id: string | null;
  build_state: string | null;
  in_main_total: boolean;
}

export interface Bom {
  rows: BomRow[];
  totals: { pieces: number; length_mm: number; weight_lb: number };
  attention: { pieces: number; length_mm: number; weight_lb: number };
}

export interface SheetLines {
  version: string;
  classes: string[];
  lines: number[][];
}

// ---- piece kinds ----------------------------------------------------------------------------------
export function isColumn(p: Pick<Piece, "type">): boolean {
  return p.type === "column";
}

export function isBrace(p: Pick<Piece, "type">): boolean {
  return p.type === "brace";
}

/** A beam without a size: the "Undefined Beams" layer. */
export function isUndefinedBeam(p: Piece): boolean {
  return !isColumn(p) && !p.profile;
}

// ---- layers and filters ---------------------------------------------------------------------------
export interface Layers {
  plan: boolean;
  grids: boolean;
  beams: boolean;
  undefinedBeams: boolean;
  columns: boolean;
  labels: boolean;
  /** One flag per "needs review" (amber) or "attention" (red) member, at its middle. */
  flags: boolean;
  /** Only undefined beams (isolate). */
  isolateUndefined: boolean;
  /** Length filter in mm (beams); null = no bound. */
  minMm: number | null;
  maxMm: number | null;
}

export const ALL_LAYERS: Layers = {
  plan: true,
  grids: true,
  beams: true,
  undefinedBeams: true,
  columns: true,
  labels: true,
  flags: true,
  isolateUndefined: false,
  minMm: null,
  maxMm: null,
};

export function visible(p: Piece, l: Layers): boolean {
  if (p.deleted) return false;
  if (isColumn(p)) return l.columns && !l.isolateUndefined;
  const undef = isUndefinedBeam(p);
  if (l.isolateUndefined && !undef) return false;
  if (undef ? !l.undefinedBeams : !l.beams) return false;
  if (p.length_mm !== null) {
    if (l.minMm !== null && p.length_mm < l.minMm) return false;
    if (l.maxMm !== null && p.length_mm > l.maxMm) return false;
  }
  return true;
}

// ---- hit tests ------------------------------------------------------------------------------------
export function pointSegDist(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2),
        );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The visible piece nearest to a point within `tol` page points (columns win a tie). */
export function pieceAt(
  pieces: readonly Piece[],
  p: Pt2,
  tol: number,
  layers: Layers = ALL_LAYERS,
): Piece | null {
  let best: { d: number; piece: Piece } | null = null;
  for (const piece of pieces) {
    if (!piece.a || !visible(piece, layers)) continue;
    const d = piece.b
      ? pointSegDist(p, piece.a, piece.b)
      : Math.hypot(p[0] - piece.a[0], p[1] - piece.a[1]);
    if (d > tol) continue;
    const better =
      !best ||
      d < best.d - 1e-9 ||
      (Math.abs(d - best.d) <= 1e-9 &&
        isColumn(piece) &&
        !isColumn(best.piece));
    if (better) best = { d, piece };
  }
  return best?.piece ?? null;
}

/** Pieces whose geometry lies inside a box (box select). */
export function piecesInBox(
  pieces: readonly Piece[],
  box: Box,
  layers: Layers = ALL_LAYERS,
): Piece[] {
  const inside = (q: Pt2) =>
    q[0] >= box.x0 && q[0] <= box.x1 && q[1] >= box.y0 && q[1] <= box.y1;
  return pieces.filter(
    (p) => p.a && visible(p, layers) && inside(p.a) && (!p.b || inside(p.b)),
  );
}

/** The lines of one pen class (for the "Pick beam" highlight). */
export function linesOfClass(
  lines: SheetLines | null,
  pen: string | null,
): number[][] {
  if (!lines || !pen) return [];
  const k = lines.classes.indexOf(pen);
  return k < 0 ? [] : lines.lines.filter((r) => r[4] === k);
}

/** The flag colour of a piece: red for "attention", amber for "needs review", none when found. */
export function flagOf(p: Piece): "red" | "amber" | null {
  if (p.ignored) return null;
  if (p.build_state === "attention") return "red";
  if (p.build_state === "needs_review") return "amber";
  return null;
}

/** The size written beside a beam, Steel Genie style: "w18x35 <10>" (studs in angle brackets). */
export function beamLabel(p: Piece): string {
  if (!p.profile) return "";
  return p.studs
    ? `${p.profile.toLowerCase()} <${p.studs}>`
    : p.profile.toLowerCase();
}

// ---- properties -----------------------------------------------------------------------------------
export const MIXED = "Mixed";

/** The common value of several pieces, or "Mixed". */
export function common<T>(values: readonly T[]): T | typeof MIXED | null {
  if (values.length === 0) return null;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first)
    ? (values[0] as T)
    : MIXED;
}

// ---- summary --------------------------------------------------------------------------------------
export const LB_PER_SHORT_TON = 2000;

export interface Summary {
  columns: number;
  beams: number;
  braces: number;
  tons: number;
}

/** Counts of every BOM row (optionally of one sheet), "attention" included: the pieces drawn on
 * the page. The weight is the main total only (found and needs review), in US short tons. */
export function summary(
  rows: readonly BomRow[],
  sheetId?: string | null,
): Summary {
  const out: Summary = { columns: 0, beams: 0, braces: 0, tons: 0 };
  let lb = 0;
  for (const r of rows) {
    if (sheetId !== undefined && r.sheet_id !== sheetId) continue;
    const cat = (r.category ?? "").toLowerCase();
    if (cat === "column") out.columns += r.qty;
    else if (cat.includes("brace")) out.braces += r.qty;
    else out.beams += r.qty;
    if (r.in_main_total) lb += r.weight_lb ?? 0;
  }
  out.tons = Math.round((lb / LB_PER_SHORT_TON) * 100) / 100;
  return out;
}

// ---- BOM ----------------------------------------------------------------------------------------
const byText = (a: string | null, b: string | null) =>
  (a ?? "").localeCompare(b ?? "", undefined, { numeric: true });

/** The BOM order: Category, then Section, then Piecemark (B2 before B10). */
export function bomOrder(a: BomRow, b: BomRow): number {
  return (
    byText(a.category, b.category) ||
    byText(a.section, b.section) ||
    byText(a.piecemark, b.piecemark)
  );
}

// ---- misc -----------------------------------------------------------------------------------------
/** A project name from a file name: no extension, separators as spaces. */
export function nameFromFile(file: string): string {
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const PAGE_TYPE_SHORT: Record<string, string> = {
  framing_plan: "Framing",
  foundation_plan: "Foundation",
  elevation: "Elevation",
  detail: "Detail",
  schedule_legend: "Schedule",
  general_notes: "Notes",
  other: "Other",
};

export const ROLE_LABEL: Record<string, string> = {
  column_plan: "Column plan",
  framing: "Framing",
  skip: "Skip",
};

/** Why a piece is amber or red, in short words (the tooltip). */
export function stateReason(p: Piece): string {
  const why: string[] = [];
  if (p.size_state === "undefined" && !p.profile) why.push("no size read");
  if (p.size_state === "inferred") why.push("size from a nearby label");
  if (p.support_state === "one") why.push("one end not supported");
  if (p.support_state === "none") why.push("no support");
  return why.join("; ");
}

/** What the size was read from (the tooltip). */
export function evidenceText(p: Piece): string {
  const s = p.evidence?.size;
  if (p.added) return "drawn by a person";
  if (!s || !s.rule) return "no label";
  const d =
    s.distance_pt === null || s.distance_pt === undefined
      ? ""
      : ` at ${s.distance_pt} pt`;
  return `${p.profile_raw ?? ""} (${s.rule}${d})`.trim();
}

// ---- routes ---------------------------------------------------------------------------------------
export type Route =
  | { view: "projects" }
  | {
      view: "workspace";
      projectId: string;
      tab: "plans" | "bom" | "report";
      sheetId: string | null;
    };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) {
    const tab =
      parts[2] === "bom" || parts[2] === "report" ? parts[2] : "plans";
    const sheetId =
      tab === "plans" && parts[2] === "plans" && parts[3] ? parts[3] : null;
    return { view: "workspace", projectId: parts[1], tab, sheetId };
  }
  return { view: "projects" };
}

export function routeHash(r: Route): string {
  if (r.view === "projects") return "#/";
  if (r.tab !== "plans") return `#/p/${r.projectId}/${r.tab}`;
  return r.sheetId
    ? `#/p/${r.projectId}/plans/${r.sheetId}`
    : `#/p/${r.projectId}`;
}
