import type { Box } from "./geometry";
import type { ParsedEntry, TextItem } from "./types";

export type LabelCategory =
  "profile" | "mark" | "dimension" | "elevation" | "scale" | "sheet_number";

export const CATEGORY_NAMES: Record<LabelCategory, string> = {
  profile: "profiles",
  mark: "marks (candidates)",
  dimension: "dimensions",
  elevation: "elevation notes",
  scale: "scales",
  sheet_number: "sheet numbers",
};

export const CATEGORY_COLOURS: Record<LabelCategory, string> = {
  profile: "#1768c4",
  mark: "#8a3fc4",
  dimension: "#1f9d3f",
  elevation: "#e07b00",
  scale: "#0e9aa7",
  sheet_number: "#777777",
};

export interface Label {
  category: LabelCategory;
  bbox: Box;
  title: string;
  key: string;
}

/** Line-level items carry profiles, dimensions, elevation notes and scales; word items carry marks and sheet numbers. */
const BY_LEVEL: Record<LabelCategory, "line" | "word"> = {
  profile: "line",
  dimension: "line",
  elevation: "line",
  scale: "line",
  mark: "word",
  sheet_number: "word",
};

const KIND_TO_CATEGORY: Record<string, LabelCategory> = {
  profile: "profile",
  dimension: "dimension",
  elevation: "elevation",
  scale: "scale",
  mark_candidate: "mark",
  sheet_number: "sheet_number",
};

function describe(e: ParsedEntry): string {
  if (e.kind === "profile") return `profile ${e.canonical ?? e.raw ?? ""}`;
  if (e.kind === "dimension")
    return `dimension ${e.raw ?? ""} = ${Math.round(Number(e.mm))} mm`;
  if (e.kind === "elevation")
    return `elevation note ${e.raw ?? ""} (datum unknown)`;
  if (e.kind === "scale") return `scale ${e.raw ?? ""}`;
  if (e.kind === "mark_candidate")
    return `mark candidate ${e.raw ?? ""} (not a member claim)`;
  return `${e.kind} ${e.raw ?? ""}`;
}

/** The overlay labels of a sheet: one per parsed value on its item. Raw strings only; nothing is invented. */
export function labelsOf(items: TextItem[]): Label[] {
  const out: Label[] = [];
  for (const it of items) {
    for (const [i, e] of (it.parsed ?? []).entries()) {
      const category = KIND_TO_CATEGORY[e.kind];
      if (!category || it.level !== BY_LEVEL[category]) continue;
      out.push({
        category,
        bbox: it.bbox,
        title: describe(e),
        key: `${it.item_key}:${i}`,
      });
    }
  }
  return out;
}

export function countByCategory(
  labels: Label[],
): Record<LabelCategory, number> {
  const counts = {
    profile: 0,
    mark: 0,
    dimension: 0,
    elevation: 0,
    scale: 0,
    sheet_number: 0,
  };
  for (const l of labels) counts[l.category] += 1;
  return counts;
}
