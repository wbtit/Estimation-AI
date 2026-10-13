// The count symbols of the review page (V1_UI_SPEC section 1). Pure helpers, no React.
import type { Box, Pt } from "./geometry";
import type { MemberView, SymbolColor, SymbolGroup } from "./types";

/** Where the symbol goes: the middle of the linked line, moved along it if it would cover the label. */
export function symbolAnchor(
  m: Pick<MemberView, "link" | "bbox">,
  offsetPt: number,
): Pt | null {
  const label = m.bbox;
  const line = m.link.line;
  if (line) {
    const mid = {
      x: (line.p[0] + line.q[0]) / 2,
      y: (line.p[1] + line.q[1]) / 2,
    };
    if (!label) return mid;
    const lc = { x: (label.x0 + label.x1) / 2, y: (label.y0 + label.y1) / 2 };
    const dx = line.q[0] - line.p[0];
    const dy = line.q[1] - line.p[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // distance of the label box from the middle point; if the symbol would sit on it, slide along the line
    const near = Math.hypot(lc.x - mid.x, lc.y - mid.y);
    const halfLabel = Math.hypot(label.x1 - label.x0, label.y1 - label.y0) / 2;
    if (near > halfLabel + offsetPt) return mid;
    // slide to the side of the middle that is farther from the label
    const along = (lc.x - mid.x) * ux + (lc.y - mid.y) * uy;
    const dir = along >= 0 ? -1 : 1;
    const shift = Math.min(halfLabel + offsetPt, len / 2);
    return { x: mid.x + dir * ux * shift, y: mid.y + dir * uy * shift };
  }
  if (label) return { x: label.x1 + offsetPt, y: (label.y0 + label.y1) / 2 };
  return null;
}

/** SVG path (centred on 0,0) of a symbol group with radius r. Circle is drawn by the caller. */
export function symbolPath(group: SymbolGroup, r: number): string | null {
  switch (group) {
    case "column": // triangle
      return `M0 ${-r} L${r * 0.95} ${r * 0.75} L${-r * 0.95} ${r * 0.75} Z`;
    case "plate": // square
      return `M${-r * 0.85} ${-r * 0.85} H${r * 0.85} V${r * 0.85} H${-r * 0.85} Z`;
    case "other": // diamond
      return `M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`;
    default:
      return null; // linear = circle, none = no symbol
  }
}

export interface Filters {
  colours: ReadonlySet<SymbolColor>; // empty = all
  kind: string; // "" = all, "(none)" = no kind
  onlyUnreviewed: boolean;
  onlyChanged: boolean;
}

export const NO_FILTERS: Filters = {
  colours: new Set(),
  kind: "",
  onlyUnreviewed: false,
  onlyChanged: false,
};

export function isFiltering(f: Filters): boolean {
  return (
    f.colours.size > 0 || f.kind !== "" || f.onlyUnreviewed || f.onlyChanged
  );
}

/** Members that pass the filters. `lastRunStart` is when the latest pipeline run began (ISO). */
export function applyFilters<T extends MemberView>(
  members: readonly T[],
  f: Filters,
  lastRunStart: string | null,
): T[] {
  return members.filter((m) => {
    if (f.colours.size > 0 && !f.colours.has(m.symbol_color)) return false;
    if (f.kind === "(none)" && m.kind.name !== null) return false;
    if (f.kind !== "" && f.kind !== "(none)" && m.kind.name !== f.kind)
      return false;
    if (f.onlyUnreviewed && m.human !== "unreviewed") return false;
    if (f.onlyChanged && lastRunStart !== null && m.changed_at < lastRunStart)
      return false;
    return true;
  });
}

/** Does this piece get a count symbol on the page? Excluded and misc kinds, existing and non-members do not. */
export function hasCountSymbol(m: MemberView): boolean {
  return (
    !m.deleted &&
    m.merged_into === null &&
    m.not_member === null &&
    !m.existing &&
    m.counting === "counted" &&
    m.status.color !== "unlinked"
  );
}

/** Pieces the symbol layer lists apart: excluded kinds ("not counted") and misc (reserved). */
export function listedApart(members: readonly MemberView[]): {
  notCounted: MemberView[];
  misc: MemberView[];
} {
  const live = members.filter(
    (m) => !m.deleted && m.merged_into === null && m.not_member === null,
  );
  return {
    notCounted: live.filter((m) => m.counting === "not_counted"),
    misc: live.filter((m) => m.counting === "misc_reserved"),
  };
}

/** The box of a label or line, for a jump link to scroll and highlight. */
export function boxOfLine(p: [number, number], q: [number, number]): Box {
  return {
    x0: Math.min(p[0], q[0]),
    y0: Math.min(p[1], q[1]),
    x1: Math.max(p[0], q[0]),
    y1: Math.max(p[1], q[1]),
  };
}
