// Review 3 item 4: the height of a column (its BOM length) until the Column Schedule is read
// (future: top - base elevation, splices). Types of the API (api/src/routes/column-height.ts) and the
// small pure logic of the panel.
import { parseFtIn } from "./ftin";
import type { Piece } from "./lf";

export type HeightSource = "schedule" | "column" | "project";

export interface ColumnHeightPatch {
  height_mm?: number | null;
  top_mm?: number | null;
  base_mm?: number | null;
}

/** What the Properties panel needs for column heights (Workspace wires it to the API). */
export interface ColumnHeightApi {
  /** The project's default column height, mm (null = not set). */
  defaultMm: number | null;
  /** One or many columns, one recorded action (one Undo). */
  onSet: (ids: string[], patch: ColumnHeightPatch) => void;
  onSetDefault: (mm: number | null) => void;
}

export const HEIGHT_SOURCE_LABEL: Record<HeightSource, string> = {
  schedule: "top − base",
  column: "this column",
  project: "project default",
};

/** A typed height or elevation: empty = null (not given); feet-inches (12'-6") or "N mm"; anything
 * else is undefined (refused, nothing sent). A height must be above 0; an elevation may be 0 or
 * below. */
export function parseHeightText(
  text: string,
  kind: "height" | "elevation",
): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const mm = /^(-?\d+(?:\.\d+)?)\s*mm$/i.exec(t);
  const v = mm ? Number(mm[1]) : parseFtIn(t);
  if (v === null || !Number.isFinite(v)) return undefined;
  if (kind === "height" && !(v > 0)) return undefined;
  return v;
}

export const isColumn = (p: Piece): boolean => p.type === "column";
