// Phase 0 profile from callout: the profile search, Mark all, the proposals for existing members,
// and the source chip of a member's profile (green = its own label, amber = typical / example).
import type { Piece, ProfileLink } from "./lf";

export type Box4 = [number, number, number, number];

export interface Occurrence {
  label_id: string;
  sheet_id: string;
  view_id: string;
  text: string;
  raw: string;
  canonical: string | null;
  valid: boolean;
  flags: string[];
  box: Box4;
}

export interface SearchResult {
  query: string;
  canonical: string;
  total: number;
  per_sheet: {
    sheet_id: string;
    page_number: number;
    sheet_number: string | null;
    count: number;
  }[];
  occurrences: Occurrence[];
  labels: { sheets: number; read: number; no_text: number };
  ms: number;
}

export type MarkProposal =
  | {
      kind: "invalid";
      label_id: string;
      text: string;
      ticked: boolean;
      reason: string;
    }
  | {
      kind: "set";
      label_id: string;
      member_id: string;
      tag: string | null;
      current: string | null;
      proposed: string | null;
      change: boolean;
      confidence: string | null;
      reason: string;
      ticked: boolean;
    }
  | {
      kind: "new";
      label_id: string;
      text: string;
      proposed: string | null;
      at: [number, number];
      position: string;
      can_create: boolean;
      ticked: boolean;
      reason: string;
    };

export interface MarkPreview {
  query: string;
  canonical: string;
  occurrences: number;
  proposals: MarkProposal[];
  accepted: boolean;
  created: number;
  updated: number;
}

export interface ProfileProposal {
  member_id: string;
  tag: string | null;
  current: string | null;
  proposed: string;
  confidence: string | null;
  reason: string;
  set_existing: boolean;
}

export interface ProfileCounts {
  profiles: {
    profile: string;
    project: number;
    sheet: number;
    valid: boolean;
    existing: number;
  }[];
  joists: { project: number; sheet: number };
  labels: { sheets: number; read: number; no_text: number };
}

export interface SourceChip {
  text: string;
  tone: "green" | "amber" | "grey";
  title: string;
}

const why = (l: ProfileLink | null | undefined): string =>
  [l?.reason, l?.note].filter(Boolean).join(" · ");

/** The chip next to a member's profile: where it came from. */
export function sourceChip(
  p: Pick<Piece, "profile_source" | "profile_link">,
): SourceChip | null {
  const link = p.profile_link ?? null;
  switch (p.profile_source) {
    case "label":
      return link?.confidence === "low"
        ? { text: "from label (unsure)", tone: "amber", title: why(link) }
        : { text: "from label", tone: "green", title: why(link) };
    case "typical":
      return { text: "from typical", tone: "amber", title: why(link) };
    case "example":
      return { text: "from example", tone: "amber", title: why(link) };
    case "person":
      return {
        text: "typed",
        tone: "grey",
        title: "a person typed this profile",
      };
    default:
      return null;
  }
}

/** The note on a page card with no text layer. */
export const NO_TEXT_NOTE =
  "No text on this page: profiles come from the example. Use Find similar.";

export const noText = (p: {
  labels_read?: boolean;
  labels_text_lines?: number | null;
}): boolean => p.labels_read === true && p.labels_text_lines === 0;
