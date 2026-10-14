// Count mode helpers (Phase 8): which pieces are suggestions, which are confirmed, how a size was
// filled. Pure; no React. The server decides the totals, this only groups what the screen shows.
import type { KindInfo, MemberView } from "./types";
import type { Pt } from "./geometry";

export type TagScope = "job" | "sheet";

export interface CountSettings {
  /** The pilot switch of the project: count mode on means confirmed pieces only (default off). */
  count_mode: boolean;
  snap_radius_pt: number;
  label_radius_pt: number;
  /** Tag numbering: one running number per kind across the job (default), or restarting per sheet. */
  tag_scope: TagScope;
}

export const DEFAULT_SETTINGS: CountSettings = {
  count_mode: false,
  snap_radius_pt: 24,
  label_radius_pt: 80,
  tag_scope: "job",
};

export type CountState = "suggested" | "confirmed" | "rejected";

export const countStateOf = (m: Pick<MemberView, "count">): CountState =>
  m.count?.state ?? "suggested";

const live = (m: MemberView): boolean =>
  !m.deleted && !m.merged_into && !m.not_member && !m.existing;

/** A piece of the sheet the system found that nobody decided: a linked line piece, counted kind. */
export function isSuggestion(m: MemberView): boolean {
  return (
    live(m) &&
    m.origin === "extracted" &&
    countStateOf(m) === "suggested" &&
    m.status.color !== "unlinked" &&
    m.counting === "counted" &&
    // one piece per linked line: a label that shares a line it does not carry is not a piece
    (m.shared_line === null || m.shared_line === undefined || carriesLine(m))
  );
}

function carriesLine(m: MemberView): boolean {
  const sl = m.shared_line as
    (MemberView["shared_line"] & { line_piece?: boolean }) | null;
  return sl?.line_piece ?? sl?.best ?? true;
}

/**
 * Count mode (Phase 9): a size label that has no line is listed as an amber suggestion, never
 * dropped; one click counts it (it has no length until a line is given), shift-click rejects it.
 */
export function isUnlinkedSuggestion(m: MemberView): boolean {
  return (
    live(m) &&
    m.origin === "extracted" &&
    countStateOf(m) === "suggested" &&
    m.status.color === "unlinked" &&
    m.counting === "counted" &&
    !!m.profile
  );
}

export interface PieceLists {
  confirmed: MemberView[];
  suggested: MemberView[];
  rejected: MemberView[];
  /** Labels with no line: a warning, in no total (they can still be given a line or counted by a click). */
  unlinked: MemberView[];
}

export function pieceLists(
  members: readonly MemberView[],
  countMode = false,
): PieceLists {
  const out: PieceLists = {
    confirmed: [],
    suggested: [],
    rejected: [],
    unlinked: [],
  };
  for (const m of members) {
    if (m.deleted || m.merged_into || m.not_member) continue;
    const state = countStateOf(m);
    if (state === "rejected") out.rejected.push(m);
    else if (state === "confirmed") out.confirmed.push(m);
    else if (m.status.color === "unlinked") {
      if (countMode && isUnlinkedSuggestion(m)) out.suggested.push(m);
      else out.unlinked.push(m);
    } else if (isSuggestion(m)) out.suggested.push(m);
  }
  return out;
}

/** Where a clicked piece is drawn: the click itself, not the middle of its line. */
export function clickAnchor(m: MemberView): Pt | null {
  const c = m.count?.click;
  return c ? { x: c.x, y: c.y } : null;
}

export interface SizeNote {
  text: string;
  tone: "ok" | "amber" | "none";
}

/** Which rule filled the size, in words, and whether the person has to look at it. */
export function sizeNote(m: MemberView): SizeNote {
  const src = m.count?.size_source ?? null;
  if (src === "linked_label")
    return { text: "size from the label linked to this line", tone: "ok" };
  if (src === "nearest_label") {
    const d = m.count?.size_evidence?.distance_pt;
    return {
      text: `size from the nearest label${d === undefined ? "" : ` (${d} pt away)`}: check it`,
      tone: "amber",
    };
  }
  if (src === "manual") return { text: "size typed by a person", tone: "ok" };
  if (src === "none" || (!m.profile && !m.profile_raw))
    return { text: "size blank: type it", tone: "amber" };
  return { text: "", tone: "none" };
}

/** Main kinds first (the scope-of-work list), then the others, each in the list's own order. */
export function kindOptions(kinds: readonly KindInfo[]): KindInfo[] {
  const rank = { main: 0, misc: 1, excluded: 2 } as const;
  return [...kinds].sort(
    (a, b) => rank[a.scope] - rank[b.scope] || a.sort - b.sort,
  );
}

/** Confirmed pieces by size (the page's running count shown in the panel). */
export function confirmedBySize(
  members: readonly MemberView[],
): { size: string; pieces: number }[] {
  const by = new Map<string, number>();
  for (const m of members) {
    if (m.deleted || countStateOf(m) !== "confirmed") continue;
    const k = m.profile ?? m.profile_raw ?? "(no size)";
    by.set(k, (by.get(k) ?? 0) + m.quantity);
  }
  return [...by.entries()]
    .map(([size, pieces]) => ({ size, pieces }))
    .sort((a, b) => b.pieces - a.pieces || a.size.localeCompare(b.size));
}
