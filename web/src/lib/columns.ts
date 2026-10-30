// Phase 14b column symbols: the palette of the 14 plan symbols (+ Stud/Post), the symbol a profile
// implies, the marker size from the real section and its SVG outline. Pure.

export type SymbolFamily =
  | "w_shape"
  | "w_cover_plates"
  | "built_up_3w"
  | "built_up_3plates"
  | "cruciform"
  | "hss_square"
  | "hss_rect"
  | "hss_round"
  | "hss_filled"
  | "welded_box"
  | "box_with_web"
  | "2c_back_to_back"
  | "2c_toe_laced"
  | "double_laced";

export const STUD_KIND = "Stud/Post";

/** The palette: W family, HSS, Built-up (the estimator's symbol sheet). */
export const PALETTE: {
  group: string;
  items: { family: SymbolFamily; label: string }[];
}[] = [
  {
    group: "W family",
    items: [
      { family: "w_shape", label: "W-shape" },
      { family: "w_cover_plates", label: "W with cover plates" },
      { family: "built_up_3w", label: "Built-up 3W" },
      { family: "built_up_3plates", label: "3 plates (built-up I)" },
      { family: "cruciform", label: "Cruciform" },
    ],
  },
  {
    group: "HSS",
    items: [
      { family: "hss_square", label: "Square HSS" },
      { family: "hss_rect", label: "Rectangular HSS" },
      { family: "hss_round", label: "Round HSS / pipe" },
      { family: "hss_filled", label: "Concrete-filled HSS" },
    ],
  },
  {
    group: "Built-up",
    items: [
      { family: "welded_box", label: "Welded box" },
      { family: "box_with_web", label: "Box with web" },
      { family: "2c_back_to_back", label: "2C back-to-back" },
      { family: "2c_toe_laced", label: "2C toe-to-toe, laced" },
      { family: "double_laced", label: "Double laced / battened" },
    ],
  },
];

export const ALL_FAMILIES: SymbolFamily[] = PALETTE.flatMap((g) =>
  g.items.map((i) => i.family),
);

/** The symbol a typed or read profile implies: W/HP/S/M -> I; HSS a x a -> square; HSS a x b ->
 * rectangle; round HSS (one size and a thickness) and PIPE -> circle; PL / built-up -> 3 plates;
 * 2C / 2MC -> 2C back-to-back. Null when the text names no column profile. */
export function symbolForProfile(
  text: string | null | undefined,
): SymbolFamily | null {
  const t = (text ?? "").toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  if (/^2M?C\d/.test(t)) return "2c_back_to_back";
  if (/^(W|HP|S|M)\d/.test(t)) return "w_shape";
  if (/^PIPE/.test(t)) return "hss_round";
  if (/^PL\d/.test(t) || /^BU/.test(t)) return "built_up_3plates";
  const hss = /^HSS([\d./-]+)X([\d./-]+)(?:X([\d./-]+))?/.exec(t);
  if (hss) {
    if (!hss[3]) return "hss_round"; // HSS6.625X.280: diameter x thickness
    return num(hss[1]!) === num(hss[2]!) ? "hss_square" : "hss_rect";
  }
  return null;
}

function num(s: string): number {
  // 12, 6-1/2, 3/8, 6.625
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+)\/(\d+))?$|^(\d+)\/(\d+)$/.exec(s);
  if (!m) return NaN;
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

export interface ColumnLike {
  kind: string | null;
  profile: string | null;
  profile_raw?: string | null;
  symbol?: string | null;
  symbol_flag?: string | null;
  rotation_deg?: number | null;
  symbol_real_in?: [number, number] | null;
  section_in?: [number, number] | null;
  scale_ratio: number | null;
}

/** The symbol a column marker draws: from its profile first, else the drawn family, else null
 * (an unknown column: a neutral amber marker). */
export function pieceSymbol(p: ColumnLike): SymbolFamily | null {
  const fromProfile = symbolForProfile(p.profile ?? p.profile_raw);
  if (fromProfile) return fromProfile;
  return ALL_FAMILIES.includes(p.symbol as SymbolFamily)
    ? (p.symbol as SymbolFamily)
    : null;
}

/** The marker's [width, depth] in page points: the catalog section, else the drawn symbol's real
 * size, at the page scale; null when neither is known (the marker keeps its screen size). */
export function markerSizePt(p: ColumnLike): [number, number] | null {
  const inches = p.section_in ?? p.symbol_real_in ?? null;
  if (!inches || !p.scale_ratio) return null;
  const k = 72 / p.scale_ratio;
  return [inches[0] * k, inches[1] * k];
}

/** The SVG path of a symbol centred on (0, 0), w wide and h deep (page points). */
export function symbolPath(f: SymbolFamily, w: number, h: number): string {
  const x = w / 2;
  const y = h / 2;
  const t = Math.max(Math.min(w, h) * 0.12, 0.3); // plate / flange thickness for the drawing
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`;
  const I = (cx: number, bw: number) =>
    `M ${cx - bw / 2} ${-y} H ${cx + bw / 2} M ${cx - bw / 2} ${y} H ${cx + bw / 2} M ${cx} ${-y} V ${y}`;
  const C = (x0: number, x1: number, open: "left" | "right") => {
    const back = open === "right" ? x0 : x1;
    const toe = open === "right" ? x1 : x0;
    return `M ${toe} ${-y} H ${back} V ${y} H ${toe}`;
  };
  const lace = (x0: number, x1: number) =>
    `M ${x0} ${-y} L ${x1} 0 L ${x0} ${y}`;
  switch (f) {
    case "w_shape":
      return I(0, w);
    case "w_cover_plates":
      return `${I(0, w)} ${rect(-x, -y - t, x, -y)} ${rect(-x, y, x, y + t)}`;
    case "built_up_3w":
      return `${I(-w / 3, w / 3)} ${I(0, w / 3)} ${I(w / 3, w / 3)}`;
    case "built_up_3plates":
      return `${rect(-x, -y, x, -y + t)} ${rect(-x, y - t, x, y)} ${rect(-t / 2, -y + t, t / 2, y - t)}`;
    case "cruciform":
      return `M ${-x} 0 H ${x} M 0 ${-y} V ${y} M ${-x} ${-y / 3} V ${y / 3} M ${x} ${-y / 3} V ${y / 3} M ${-x / 3} ${-y} H ${x / 3} M ${-x / 3} ${y} H ${x / 3}`;
    case "hss_square":
    case "hss_rect":
      return `${rect(-x, -y, x, y)} ${rect(-x + t, -y + t, x - t, y - t)}`;
    case "hss_round": {
      const r = Math.min(x, y);
      return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z M ${-r + t} 0 A ${r - t} ${r - t} 0 1 0 ${r - t} 0 A ${r - t} ${r - t} 0 1 0 ${-r + t} 0 Z`;
    }
    case "hss_filled":
      return `${rect(-x, -y, x, y)} M ${-x} ${-y} L ${x} ${y} M ${-x} 0 L 0 ${y} M 0 ${-y} L ${x} 0`;
    case "welded_box":
      return `${rect(-x, -y, x, -y + t)} ${rect(-x, y - t, x, y)} ${rect(-x, -y + t, -x + t, y - t)} ${rect(x - t, -y + t, x, y - t)}`;
    case "box_with_web":
      return `${symbolPath("welded_box", w, h)} ${rect(-x + t, -t / 2, x - t, t / 2)}`;
    case "2c_back_to_back":
      return `${C(-x, 0, "left")} ${C(0, x, "right")}`;
    case "2c_toe_laced":
      return `${C(-x, -x / 3, "right")} ${C(x / 3, x, "left")} ${lace(-x / 3, x / 3)}`;
    case "double_laced":
      return `${C(-x, -x / 3, "left")} ${C(x / 3, x, "right")} ${lace(-x / 3, x / 3)}`;
  }
}

// ---- the palette's remembered choice -------------------------------------------------------------
const lastKey = (who: string) => `review.column.symbol.${who}`;

export interface PaletteChoice {
  family: SymbolFamily;
  stud: boolean;
}

export function loadPaletteChoice(who: string): PaletteChoice {
  try {
    const v = JSON.parse(window.localStorage.getItem(lastKey(who)) ?? "null");
    if (v && ALL_FAMILIES.includes(v.family))
      return { family: v.family, stud: !!v.stud };
  } catch {
    // no storage or a bad value: the default
  }
  return { family: "w_shape", stud: false };
}

export function savePaletteChoice(who: string, c: PaletteChoice): void {
  try {
    window.localStorage.setItem(lastKey(who), JSON.stringify(c));
  } catch {
    // private window or blocked storage: not remembered
  }
}
