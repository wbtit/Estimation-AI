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
  /** The page's own crop from before views (View 1's "Reset box to page crop"). */
  page_crop?: Box | null;
  /** Phase 11c: the views of the page (the first one is the page's setup above). */
  views?: PageViewInfo[];
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

/** Role behaviour: what the engine does with a view. */
export type Behaviour = "column_plan" | "framing" | "none";

export interface RoleName {
  name: string;
  behaviour: Behaviour;
  built_in: boolean;
}

export interface Exclusion {
  id: string;
  box: Box;
  status: "suggested" | "accepted";
  rule: string | null;
}

/** A view of a page (Phase 11c): a box with its own role, scale, T.O.S., beam pens, exclude
 * areas and deselected lines. */
export interface BuildView {
  id: string;
  position: number;
  name: string;
  box: Box | null;
  role_name: string | null;
  behaviour: Behaviour | null;
  scale_ratio: number | null;
  scale_text: string | null;
  tos_mm: number | null;
  tos_raw: string | null;
  pens: { pen_class: string; position: number; source: string }[];
  no_beams: boolean;
  column_plan_view_id: string | null;
  column_plan_sheet_id: string | null;
  exclusions: Exclusion[];
  deselections: { id: string; line: [number, number, number, number] }[];
  setup_changed_at: string | null;
  built_at: string | null;
  deselections_unmatched?: number;
}

/** A view as the page list shows it (with its badge and counts). */
export interface PageViewInfo extends BuildView {
  badge: Badge;
  reasons: string[];
  system_values: string[];
  counts: Page["counts"];
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
  /** The view the piece belongs to; null = the page's first view. */
  build_view_id?: string | null;
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
  /** Phase 11c: the page's views (with the last build's unmatched deselections). */
  views?: BuildView[];
  pens?: string[];
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
  /** One flag per "needs review" (amber) or "attention" (red) member, at its middle (optional:
   * the whole member is drawn in its state colour). */
  flags: boolean;
  /** Only undefined beams (isolate). */
  isolateUndefined: boolean;
  /** Write every read size (else only where it differs from the drawing's label, or on hover). */
  allSizes: boolean;
  /** Hide found and ignored members: only orange and red remain. */
  onlyProblems: boolean;
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
  flags: false,
  isolateUndefined: false,
  allSizes: false,
  onlyProblems: false,
  minMm: null,
  maxMm: null,
};

/** A member that needs attention or review (and is not ignored). */
export function isProblem(p: Piece): boolean {
  return (
    !p.ignored &&
    (p.build_state === "attention" || p.build_state === "needs_review")
  );
}

export function visible(p: Piece, l: Layers): boolean {
  if (p.deleted) return false;
  if (l.onlyProblems && !isProblem(p)) return false;
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

// ---- pen preview (Pick beam) ---------------------------------------------------------------------
const r2 = (v: number) => Math.round(v * 100) / 100;
/** A line's key as the server stores a deselection (0.01 pt). */
export const lineKey = (l: readonly number[]): string =>
  [l[0]!, l[1]!, l[2]!, l[3]!].map(r2).join(",");

export function insideBox(b: Box, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

export interface PenLine {
  index: number;
  line: [number, number, number, number];
  pen: string;
  deselected: boolean;
  excluded: boolean;
}

/** The lines of the view's beam pens inside its box (the "Pen preview"): each marked deselected
 * (a person clicked it off) or excluded (inside an accepted exclude box). */
export function penPreview(
  lines: SheetLines | null,
  pens: readonly string[],
  box: Box | null,
  view: Pick<BuildView, "exclusions" | "deselections"> | null,
): PenLine[] {
  if (!lines || pens.length === 0) return [];
  const want = new Map<number, string>();
  for (const pen of pens) {
    const k = lines.classes.indexOf(pen);
    if (k >= 0) want.set(k, pen);
  }
  const off = new Set((view?.deselections ?? []).map((d) => lineKey(d.line)));
  const ex = (view?.exclusions ?? [])
    .filter((e) => e.status === "accepted")
    .map((e) => e.box);
  const out: PenLine[] = [];
  lines.lines.forEach((r, index) => {
    const pen = want.get(r[4]!);
    if (pen === undefined) return;
    const mx = (r[0]! + r[2]!) / 2;
    const my = (r[1]! + r[3]!) / 2;
    if (box && !insideBox(box, mx, my)) return;
    const line: [number, number, number, number] = [r[0]!, r[1]!, r[2]!, r[3]!];
    out.push({
      index,
      line,
      pen,
      deselected: off.has(lineKey(line)),
      excluded: ex.some((b) => insideBox(b, mx, my)),
    });
  });
  return out;
}

/** The pen-preview line nearest a point within `tol` (for the click that deselects it). */
export function penLineAt(
  list: readonly PenLine[],
  p: Pt2,
  tol: number,
): PenLine | null {
  let best: { d: number; l: PenLine } | null = null;
  for (const l of list) {
    const d = pointSegDist(p, [l.line[0], l.line[1]], [l.line[2], l.line[3]]);
    if (d <= tol && (!best || d < best.d)) best = { d, l };
  }
  return best?.l ?? null;
}

/** Highlighted (not yet deselected) pen lines fully inside a box (ctrl + drag). */
export function penLinesInBox(list: readonly PenLine[], b: Box): PenLine[] {
  return list.filter(
    (l) =>
      !l.deselected &&
      insideBox(b, l.line[0], l.line[1]) &&
      insideBox(b, l.line[2], l.line[3]),
  );
}

/** The view of a page that is active: the one chosen, else the first. */
export function activeView<T extends { id: string; position: number }>(
  views: readonly T[] | undefined,
  id: string | null,
): T | null {
  if (!views || views.length === 0) return null;
  return (
    views.find((v) => v.id === id) ??
    views.find((v) => v.position === 1) ??
    views[0]!
  );
}

/** The flag colour of a piece: red for "attention", amber for "needs review", none when found. */
export function flagOf(p: Piece): "red" | "amber" | null {
  if (p.ignored) return null;
  if (p.build_state === "attention") return "red";
  if (p.build_state === "needs_review") return "amber";
  return null;
}

/** The colour of a whole member: its state when it needs attention or review, else its kind
 * (CSS variables, styles.css). */
export function markColour(p: Piece): string {
  if (p.ignored) return "var(--mark-ignored)";
  if (p.build_state === "attention") return "var(--attention)";
  if (p.build_state === "needs_review") return "var(--review)";
  return isColumn(p) ? "var(--column)" : "var(--beam)";
}

// ---- marks: weight by state and zoom (Phase 11c polish round) ----------------------------------
/** A member mark is this wide on paper, in page points ... */
export const MARK_PT = 2;
/** ... kept between these widths on screen, in CSS px ... */
export const MARK_MIN_PX = 1.25;
export const MARK_MAX_PX = 4;
/** ... and this wide when hovered or selected. */
export const MARK_ON_PX = 6;
/** A column symbol is this tall on screen at every zoom. */
export const COLUMN_PX = 14;

/** Only "attention" (red) glows; review is a plain orange line, found the kind colour. */
export function hasGlow(p: Piece): boolean {
  return !p.ignored && p.build_state === "attention";
}

/** The on-screen width of a mark in CSS px: thin at low zoom, never thicker than MARK_MAX_PX. */
export function markWidthPx(zoom: number, wide = false): number {
  if (wide) return MARK_ON_PX;
  return Math.min(MARK_MAX_PX, Math.max(MARK_MIN_PX, MARK_PT * zoom));
}

/** Dash and gap of an undefined beam, scaled with its width (CSS px). */
export function dashPx(widthPx: number): [number, number] {
  return [widthPx * 3, widthPx * 2];
}

const normSize = (s: string) =>
  s.toUpperCase().replace(/\s+/g, "").replace(/×/g, "X");

/** Does our read size differ from the label text on the drawing? The drawing's text starts with the
 * size ("W18X35", "W18X35 (10)", "W18X35 C=3/4"); spaces and case do not count. A size with no
 * label text (typed by a person) differs, and so do studs other than the label's. */
export function labelDiffers(p: Piece): boolean {
  if (!p.profile) return false;
  if (!p.profile_raw) return true;
  const raw = normSize(p.profile_raw);
  const size = normSize(p.profile);
  if (!raw.startsWith(size)) return true;
  const next = raw.charAt(size.length);
  if (next !== "" && /[0-9./X]/.test(next)) return true; // W18X35 is not W18X350
  const read = p.evidence?.studs?.count ?? null;
  return p.studs !== null && p.studs !== read;
}

/** Write the read size beside a beam? When it differs from the drawing, on hover or selection,
 * or with "Show all read sizes". */
export function showSizeLabel(
  p: Piece,
  o: { hover: boolean; on: boolean; allSizes: boolean },
): boolean {
  if (!p.profile) return false;
  return o.allSizes || o.hover || o.on || labelDiffers(p);
}

// ---- setup chips of a view (the page card) -------------------------------------------------------
export type ChipState = "ok" | "system" | "missing";
export interface SetupChip {
  key: "role" | "crop" | "scale" | "pen" | "column_plan" | "tos";
  label: string;
  state: ChipState;
  tip: string;
}

/** The setup of a view as chips: green when a person confirmed it, grey when the system set it,
 * red when missing. Pen, Column plan and T.O.S. only for framing; only Role when nothing builds. */
export function setupChips(
  v: Pick<
    PageViewInfo,
    | "role_name"
    | "behaviour"
    | "box"
    | "scale_ratio"
    | "pens"
    | "no_beams"
    | "column_plan_sheet_id"
    | "column_plan_view_id"
    | "tos_mm"
    | "system_values"
  >,
): SetupChip[] {
  const sys = new Set(v.system_values);
  const chip = (
    key: SetupChip["key"],
    label: string,
    has: boolean,
    sysKey: string,
    what: string,
  ): SetupChip => {
    const state: ChipState = !has
      ? "missing"
      : sys.has(sysKey)
        ? "system"
        : "ok";
    const tip =
      state === "missing"
        ? `${what}: missing`
        : state === "system"
          ? `${what}: set by the system, not confirmed`
          : `${what}: confirmed`;
    return { key, label, state, tip };
  };
  const out = [chip("role", "Role", v.role_name !== null, "role", "Role")];
  if (v.behaviour !== "framing" && v.behaviour !== "column_plan") return out;
  out.push(chip("crop", "Crop", v.box !== null, "crop", "Crop"));
  out.push(chip("scale", "Scale", v.scale_ratio !== null, "scale", "Scale"));
  if (v.behaviour === "framing") {
    out.push(
      chip(
        "pen",
        "Pen",
        v.no_beams || v.pens.length > 0,
        "pen_class",
        "Beam pen",
      ),
    );
    // "None" is a valid column plan once a person chose it; unchosen and empty is missing
    const linked =
      v.column_plan_sheet_id !== null || v.column_plan_view_id !== null;
    out.push(
      chip(
        "column_plan",
        "Column plan",
        linked || !sys.has("column_plan"),
        "column_plan",
        "Column plan",
      ),
    );
    out.push(chip("tos", "T.O.S.", v.tos_mm !== null, "tos", "Top of Steel"));
  }
  return out;
}

// ---- issue navigator ----------------------------------------------------------------------------
export type IssueKey = [number, number, number, number, string];

/** The order of the issue navigator: attention before review; within each, by view, then top to
 * bottom, then left to right (the id breaks a tie). */
export function issueKey(
  p: Piece,
  viewPos: (id: string | null) => number,
): IssueKey {
  const a = p.a ?? [0, 0];
  const b = p.b ?? a;
  const top = a[1] <= b[1] ? a : b;
  return [
    p.build_state === "attention" ? 0 : 1,
    viewPos(p.build_view_id ?? null),
    Math.round(top[1] * 100) / 100,
    Math.round(top[0] * 100) / 100,
    p.id,
  ];
}

export function compareKeys(a: IssueKey, b: IssueKey): number {
  for (let i = 0; i < 4; i++)
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0;
}

/** The members that need attention or review, in navigator order (shown ones only). */
export function issues(
  pieces: readonly Piece[],
  views: readonly { id: string; position: number }[] = [],
  layers: Layers = ALL_LAYERS,
): { piece: Piece; key: IssueKey }[] {
  const pos = new Map(views.map((v) => [v.id, v.position]));
  const viewPos = (id: string | null) => (id === null ? 1 : (pos.get(id) ?? 1));
  return pieces
    .filter(
      (p) =>
        p.a &&
        !p.ignored &&
        !p.deleted &&
        (p.build_state === "attention" || p.build_state === "needs_review") &&
        visible(p, { ...layers, minMm: null, maxMm: null }),
    )
    .map((piece) => ({ piece, key: issueKey(piece, viewPos) }))
    .sort((x, y) => compareKeys(x.key, y.key));
}

/** The next (dir 1) or previous (dir -1) issue after the last one shown; wraps around. A fixed
 * member drops out of the list, so Next goes on from where it was. */
export function nextIssue<T extends { key: IssueKey }>(
  list: readonly T[],
  last: IssueKey | null,
  dir: 1 | -1,
): T | null {
  if (list.length === 0) return null;
  if (last === null) return dir === 1 ? list[0]! : list[list.length - 1]!;
  if (dir === 1)
    return list.find((x) => compareKeys(x.key, last) > 0) ?? list[0]!;
  for (let i = list.length - 1; i >= 0; i--)
    if (compareKeys(list[i]!.key, last) < 0) return list[i]!;
  return list[list.length - 1]!;
}

// ---- drawing fade -------------------------------------------------------------------------------
export const DEFAULT_FADE = 0.45;
const fadeKey = (who: string) => `review.fade.${who}`;

/** The drawing fade of a person (0..1), remembered in this browser. */
export function loadFade(who: string): number {
  try {
    const v = window.localStorage.getItem(fadeKey(who));
    const n = v === null ? NaN : Number(v);
    return isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_FADE;
  } catch {
    return DEFAULT_FADE;
  }
}

export function saveFade(who: string, fade: number): void {
  try {
    window.localStorage.setItem(fadeKey(who), String(fade));
  } catch {
    // private window or blocked storage: the fade is not remembered
  }
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
