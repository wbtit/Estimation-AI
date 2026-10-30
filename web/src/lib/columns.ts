// Phase 14b/14c column symbols: the palette of the five column types (+ Stud/Post), the symbol a
// profile implies, the marker size from the real section and its SVG outline. Pure.

/** The five column types (Phase 14c; worker col_symbols.FIVE_FAMILIES). */
export type SymbolFamily =
  "w_shape" | "w_cover_plates" | "hss_square" | "hss_rect" | "hss_round";

export const STUD_KIND = "Stud/Post";

/** The palette: the five column types. */
export const PALETTE: {
  group: string;
  items: { family: SymbolFamily; label: string }[];
}[] = [
  {
    group: "Column type",
    items: [
      { family: "w_shape", label: "W-shape" },
      { family: "w_cover_plates", label: "W with cover plates" },
      { family: "hss_square", label: "Square HSS" },
      { family: "hss_rect", label: "Rectangular HSS" },
      { family: "hss_round", label: "Round HSS / pipe" },
    ],
  },
];

export const ALL_FAMILIES: SymbolFamily[] = PALETTE.flatMap((g) =>
  g.items.map((i) => i.family),
);

/** The symbol a typed or read profile implies: W/HP/S/M -> W-shape, or W with cover plates when the
 * text also names a plate (PL..) or COVER; HSS a x a -> square; HSS a x b -> rectangle; round HSS
 * (one size and a thickness) and PIPE -> round. Null for anything else (2C, plates, angles...): an
 * unknown column, drawn as the neutral amber marker. */
export function symbolForProfile(
  text: string | null | undefined,
): SymbolFamily | null {
  const raw = (text ?? "").toUpperCase();
  const t = raw.replace(/\s+/g, "");
  if (!t) return null;
  if (/^(W|HP|S|M)\d/.test(t))
    return /\bPL\s*\d|\bCOVER\b/.test(raw) ? "w_cover_plates" : "w_shape";
  if (/^PIPE/.test(t)) return "hss_round";
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

/** The SVG path of a symbol centred on (0, 0), w wide and h deep (page points), drawn like the
 * owner's reference: an I outline; the I with a plate beyond each flange; HSS as a double outline
 * with rounded corners; round as two concentric circles. */
export function symbolPath(f: SymbolFamily, w: number, h: number): string {
  const x = w / 2;
  const y = h / 2;
  const t = Math.max(Math.min(w, h) * 0.12, 0.3); // wall / flange thickness for the drawing
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`;
  const rounded = (hx: number, hy: number, r: number) =>
    `M ${-hx + r} ${-hy} H ${hx - r} A ${r} ${r} 0 0 1 ${hx} ${-hy + r} V ${hy - r} A ${r} ${r} 0 0 1 ${hx - r} ${hy} H ${-hx + r} A ${r} ${r} 0 0 1 ${-hx} ${hy - r} V ${-hy + r} A ${r} ${r} 0 0 1 ${-hx + r} ${-hy} Z`;
  const I = (hy: number) => {
    const tw = t / 2;
    return `M ${-x} ${-hy} H ${x} V ${-hy + t} H ${tw} V ${hy - t} H ${x} V ${hy} H ${-x} V ${hy - t} H ${-tw} V ${-hy + t} H ${-x} Z`;
  };
  switch (f) {
    case "w_shape":
      return I(y);
    case "w_cover_plates":
      return `${I(y - t)} ${rect(-x, -y, x, -y + t * 0.8)} ${rect(-x, y - t * 0.8, x, y)}`;
    case "hss_square":
    case "hss_rect": {
      const r = Math.min(x, y) * 0.25;
      return `${rounded(x, y, r)} ${rounded(x - t, y - t, Math.max(r - t, 0))}`;
    }
    case "hss_round": {
      const r = Math.min(x, y);
      const q = r - t;
      return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z M ${-q} 0 A ${q} ${q} 0 1 0 ${q} 0 A ${q} ${q} 0 1 0 ${-q} 0 Z`;
    }
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
