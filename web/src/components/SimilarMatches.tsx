import React from "react";
import { matchKey, scoreLabel, type SimilarMatch } from "../lib/similar";

export interface SimilarOverlay {
  /** the matches shown at the current strictness */
  matches: SimilarMatch[];
  unticked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Phase 0-14g: the box used as the example (its corners, page points), always shown */
  example?: { rect: [number, number][]; source: string } | null;
}

/** Phase 14e: every Find similar match on the canvas, highlighted, with its score ("shape" for a
 * vector match); a click unticks it (dashed grey) or ticks it again. The click never reaches the
 * drawing tools underneath. */
export const SimilarMatches: React.FC<{
  overlay: SimilarOverlay;
  px: number;
}> = ({ overlay, px }) => (
  <g data-testid="similar-matches">
    {overlay.example && overlay.example.rect.length === 4 && (
      <g data-testid="similar-example" pointerEvents="none">
        <polygon
          points={overlay.example.rect.map((q) => `${q[0]},${q[1]}`).join(" ")}
          fill="rgba(255,145,0,0.10)"
          stroke="var(--amber, #ff9100)"
          strokeWidth={2 * px}
          strokeDasharray={`${4 * px} ${2 * px}`}
        />
        <text
          x={Math.max(...overlay.example.rect.map((q) => q[0])) + 3 * px}
          y={Math.min(...overlay.example.rect.map((q) => q[1]))}
          fontSize={11 * px}
          fill="var(--amber, #ff9100)"
          stroke="#fff"
          strokeWidth={3 * px}
          paintOrder="stroke"
        >
          {overlay.example.source === "ink" ? "example (ink)" : "example"}
        </text>
      </g>
    )}
    {overlay.matches.map((m) => {
      const key = matchKey(m);
      const on = !overlay.unticked.has(key);
      const r = 9 * px;
      const stop = (e: React.PointerEvent) => e.stopPropagation();
      return (
        <g
          key={key}
          data-testid="similar-match"
          data-key={key}
          data-ticked={on ? "1" : "0"}
          style={{ cursor: "pointer" }}
          onPointerDown={stop}
          onPointerUp={stop}
          onClick={(e) => {
            e.stopPropagation();
            overlay.onToggle(key);
          }}
        >
          <title>{`${on ? "Click to untick" : "Click to tick"} · ${scoreLabel(m)}`}</title>
          <circle
            cx={m.centre[0]}
            cy={m.centre[1]}
            r={r}
            fill={on ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.6)"}
            stroke={on ? "var(--select, #2563eb)" : "#9ca3af"}
            strokeWidth={2 * px}
            strokeDasharray={on ? undefined : `${3 * px} ${2 * px}`}
          />
          {m.orientation_deg !== null && m.orientation_deg !== undefined && (
            // Phase 0-column-capture: this match's OWN web direction (green clear, amber unsure)
            <line
              data-testid="match-orientation"
              data-state={m.orientation_state ?? "unsure"}
              x1={
                m.centre[0] - Math.cos((m.orientation_deg * Math.PI) / 180) * r
              }
              y1={
                m.centre[1] + Math.sin((m.orientation_deg * Math.PI) / 180) * r
              }
              x2={
                m.centre[0] + Math.cos((m.orientation_deg * Math.PI) / 180) * r
              }
              y2={
                m.centre[1] - Math.sin((m.orientation_deg * Math.PI) / 180) * r
              }
              stroke={
                m.orientation_state === "clear"
                  ? "var(--ok, #00c853)"
                  : "var(--amber, #ff9100)"
              }
              strokeWidth={2.5 * px}
              strokeLinecap="round"
            />
          )}
          <text
            x={m.centre[0] + r + 2 * px}
            y={m.centre[1] - r}
            fontSize={11 * px}
            fill={on ? "var(--select, #2563eb)" : "#6b7280"}
            stroke="#fff"
            strokeWidth={3 * px}
            paintOrder="stroke"
          >
            {scoreLabel(m)}
          </text>
        </g>
      );
    })}
  </g>
);
