import React from "react";
import type { Box4, MarkProposal, Occurrence } from "../lib/profile-callout";

/** Phase 0 profile from callout: the occurrences of the searched profile, highlighted on the page,
 * and the Mark all proposals (a proposed member is DASHED until accepted; a click unticks it). */
export const ProfileMarks: React.FC<{
  occurrences: Occurrence[];
  proposals: MarkProposal[];
  unticked: ReadonlySet<string>;
  onToggle: (labelId: string) => void;
  /** "Pick a label": every label of the sheet is clickable and becomes the search */
  pickable?: { label_id: string; canonical: string | null; box: Box4 }[];
  onPick?: (canonical: string) => void;
  px: number;
}> = ({ occurrences, proposals, unticked, onToggle, pickable, onPick, px }) => (
  <g data-testid="profile-marks">
    {(pickable ?? []).map((l) => (
      <rect
        key={`pick-${l.label_id}`}
        data-testid="profile-pick"
        x={l.box[0] - 2 * px}
        y={l.box[1] - 2 * px}
        width={l.box[2] - l.box[0] + 4 * px}
        height={l.box[3] - l.box[1] + 4 * px}
        fill="rgba(37,99,235,0.08)"
        stroke="var(--select, #2563eb)"
        strokeWidth={px}
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (l.canonical) onPick?.(l.canonical);
        }}
      >
        <title>{`Search ${l.canonical ?? ""}`}</title>
      </rect>
    ))}
    {occurrences.map((o) => {
      const [x0, y0, x1, y1] = o.box as Box4;
      const off = unticked.has(o.label_id);
      return (
        <g key={o.label_id} pointerEvents="none">
          <rect
            x={x0 - 2 * px}
            y={y0 - 2 * px}
            width={x1 - x0 + 4 * px}
            height={y1 - y0 + 4 * px}
            fill="none"
            stroke="var(--casing)"
            strokeWidth={4.5 * px}
          />
          <rect
            data-testid="profile-occurrence"
            data-valid={o.valid ? "1" : "0"}
            x={x0 - 2 * px}
            y={y0 - 2 * px}
            width={x1 - x0 + 4 * px}
            height={y1 - y0 + 4 * px}
            fill={o.valid ? "rgba(255,212,0,0.40)" : "rgba(150,150,150,0.30)"}
            stroke={off ? "#9ca3af" : "var(--select, #ffd400)"}
            strokeWidth={2 * px}
          />
        </g>
      );
    })}
    {proposals.map((p) => {
      const stop = (e: React.PointerEvent) => e.stopPropagation();
      if (p.kind === "new") {
        return (
          <g
            key={`n-${p.label_id}`}
            data-testid="profile-proposed-member"
            data-ticked={p.ticked ? "1" : "0"}
            style={{ cursor: "pointer" }}
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(p.label_id);
            }}
          >
            <title>{`${p.proposed ?? ""} · proposed, nothing counted until accepted · ${p.position}`}</title>
            <circle
              cx={p.at[0]}
              cy={p.at[1]}
              r={9 * px}
              fill={p.ticked ? "rgba(37,99,235,0.15)" : "rgba(255,255,255,0.6)"}
              stroke={p.ticked ? "var(--select, #2563eb)" : "#9ca3af"}
              strokeWidth={2 * px}
              strokeDasharray={`${4 * px} ${3 * px}`}
            />
          </g>
        );
      }
      return null;
    })}
  </g>
);
