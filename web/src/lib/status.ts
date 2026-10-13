import type { Color, SymbolColor } from "./types";

export const COLOUR_HEX: Record<Color, string> = {
  green: "#1f9d3f",
  amber: "#f0a30a",
  red: "#d12c2c",
  unlinked: "#6b7a99",
};

export const SYMBOL_HEX: Record<SymbolColor, string> = {
  ...COLOUR_HEX,
  grey: "#8d8d8d",
};

/** The ring that says "a person confirmed or fixed this" (not a confidence colour). */
export const REVIEWED_RING = "#1768c4";

export const COLOUR_WORD: Record<Color, string> = {
  green: "green",
  amber: "amber",
  red: "red",
  unlinked: "unlinked",
};

/** Stable swatch colour of a stroke class (same order as the class table). */
const SWATCHES = [
  "#d62728",
  "#1f77b4",
  "#2ca02c",
  "#ff7f0e",
  "#9467bd",
  "#17becf",
  "#e377c2",
  "#8c564b",
];
export function swatch(index: number): string {
  return SWATCHES[index % SWATCHES.length];
}
