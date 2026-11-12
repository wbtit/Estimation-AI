// Phase 0 cover details: the project details panel and the drawing index check.
export type Conf = "high" | "medium" | "low";

export interface DetailField {
  field: string;
  value: string | null;
  read_value: string | null;
  edited: boolean;
  edited_by: string | null;
  page_index: number | null;
  box: [number, number, number, number] | null;
  rule: string | null;
  confidence: Conf | null;
  flags: string[];
  alternatives: {
    value: string;
    page_index: number;
    box: [number, number, number, number];
    rule: string;
    confidence: Conf;
  }[];
  agreement: {
    state: "agree" | "conflict" | "single";
    agree: string[];
    differ: { rule: string; value: string; page_index: number }[];
    clue_differs?: { value: string; page_index: number }[];
  } | null;
}

export interface IndexFlagItem {
  id: string;
  kind: string;
  number: string | null;
  title: string | null;
  detail: Record<string, unknown>;
  sheet_id: string | null;
  page_index: number | null;
  index_page: number | null;
}

export interface ProjectDetails {
  status: "not_read" | "no_text" | "read";
  project: { name: string; number: string | null };
  read: {
    read_at: string;
    cover_pages: number[];
    no_text_pages: number[];
    pages: number;
    seconds: number | null;
  } | null;
  fields: DetailField[];
  index: {
    rows: {
      id: string;
      page_index: number;
      number: string;
      title: string;
      match: "exact" | "equivalent" | "none";
      matched_page: number | null;
    }[];
    flags: IndexFlagItem[];
    summary: { rows: number; matched: number; percent: number | null };
  };
}

export const FIELD_LABEL: Record<string, string> = {
  project_name: "Project name",
  project_number: "Project number",
  owner: "Client",
  location: "Location",
  building_type: "Building type",
  architect: "Architect",
  engineer: "Structural engineer",
  contractor: "Contractor",
  address: "Address",
  date: "Date",
  issue: "Issue / revision",
  issue_status: "Issue status",
  building_code: "Building code",
  risk_category: "Risk category",
  load_ground_snow: "Ground snow load",
  load_roof_snow: "Roof snow load",
  load_wind_speed: "Wind speed",
  load_seismic_category: "Seismic design category",
  load_site_class: "Site class",
  load_live: "Live load",
  load_dead: "Dead load",
};

/** The fields the panel shows. The reader still reads (and the database still keeps) the others. */
export const SHOWN_FIELDS = [
  "project_name",
  "owner",
  "location",
  "building_type",
] as const;

export const FLAG_LABEL: Record<string, string> = {
  missing_from_pdf: "On the index, not in the PDF",
  not_in_index: "In the PDF, not on the index",
  page_no_number: "Page has no sheet number",
  number_mismatch: "Sheet number differs from the index",
  number_format: "Same number, written differently",
  name_mismatch: "Name differs from the index",
  role_disagreement: "Index title and page role disagree",
};

export const RULE_LABEL: Record<string, string> = {
  same_line: "label, same line",
  below: "label, text below",
  right: "label, cell to the right",
  above: "label, text above",
  city_state: "city and state line",
  keyword_in_project_name: "word in the project name",
  keyword_in_cover_text: "word in the cover text",
  address_one_line: "address pattern",
  address_two_lines: "address pattern",
  date_pattern: "date pattern",
  status_word: "status words",
  largest_cover_text: "largest text on the cover",
};

/** "page 3 · label, same line": the source chip of a field. */
export function sourceText(
  f: Pick<DetailField, "page_index" | "rule">,
): string {
  if (f.page_index === null || f.rule === null) return "";
  const rule = RULE_LABEL[f.rule] ?? f.rule.replace(/_/g, " ");
  return `page ${f.page_index + 1} · ${rule}`;
}

/** One line for a flag: what it says about which row or page. */
export function flagText(f: IndexFlagItem): string {
  const d = f.detail as Record<string, string | number | undefined>;
  const who = [f.number, f.title].filter(Boolean).join(" ");
  switch (f.kind) {
    case "number_mismatch":
      return `${who}: the page reads ${d.page ?? "no number"}`;
    case "number_format":
      return `${who}: the page reads ${d.page}`;
    case "name_mismatch":
      return `${f.number}: index "${d.index}" · page "${d.page}"`;
    case "role_disagreement":
      return `${f.number}: index says ${String(d.index_says).replace("_", " ")}, role is ${d.role}`;
    case "not_in_index":
      return `${d.number}${d.name ? ` ${d.name}` : ""}`;
    case "page_no_number":
      return d.name ? String(d.name) : "unnamed page";
    default:
      return who;
  }
}
