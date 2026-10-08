import type { Color } from "./types";

export const COLOUR_HEX: Record<Color, string> = {
  green: "#1f9d3f",
  amber: "#f0a30a",
  red: "#d12c2c",
};

export const COLOUR_WORD: Record<Color, string> = {
  green: "green",
  amber: "amber",
  red: "red",
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
