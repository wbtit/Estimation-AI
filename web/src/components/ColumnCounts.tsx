import React from "react";
import type { Piece } from "../lib/lf";

/** Phase 0-column-capture: the columns of the page, counted live per profile, with how many have an
 * orientation that is not clear yet (amber). Shown while columns are drawn or found. */
export function countColumns(pieces: readonly Piece[]): {
  total: number;
  amber: number;
  byProfile: [string, number][];
} {
  const cols = pieces.filter((p) => p.type === "column" && !p.deleted);
  const by = new Map<string, number>();
  for (const p of cols) {
    const k = p.profile ?? p.profile_raw ?? "no size";
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  const amber = cols.filter(
    (p) =>
      p.kind !== "Stud/Post" &&
      p.symbol !== "hss_round" &&
      p.orientation_state !== "clear" &&
      p.orientation_state !== "manual",
  ).length;
  return {
    total: cols.length,
    amber,
    byProfile: [...by.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}

export const ColumnCounts: React.FC<{ pieces: readonly Piece[] }> = ({
  pieces,
}) => {
  const c = countColumns(pieces);
  if (c.total === 0) return null;
  return (
    <div className="find-similar column-counts" data-testid="column-counts">
      <span>
        {c.total} column{c.total === 1 ? "" : "s"} on this page:{" "}
        {c.byProfile.map(([name, n]) => `${name} × ${n}`).join(" · ")}
      </span>
      {c.amber > 0 && (
        <span className="similar-warning" data-testid="column-counts-amber">
          {c.amber} to check (orientation)
        </span>
      )}
    </div>
  );
};
