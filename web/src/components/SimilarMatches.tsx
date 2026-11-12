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
          fill="rgba(23,71,201,0.12)"
          stroke="#fff"
          strokeWidth={7 * px}
        />
        <polygon
          points={overlay.example.rect.map((q) => `${q[0]},${q[1]}`).join(" ")}
          fill="none"
          stroke="var(--capture)"
          strokeWidth={3.5 * px}
          strokeDasharray={`${12 * px} ${7 * px}`}
        />
        <g
          transform={`translate(${Math.min(...overlay.example.rect.map((q) => q[0]))} ${Math.min(...overlay.example.rect.map((q) => q[1])) - 22 * px})`}
        >
          <rect
            width={(overlay.example.source === "ink" ? 112 : 84) * px}
            height={22 * px}
            fill="var(--capture)"
          />
          <text
            x={8 * px}
            y={16 * px}
            fontSize={12 * px}
            fontWeight={700}
            fill="#fff"
          >
            {overlay.example.source === "ink" ? "example (ink)" : "example"}
          </text>
        </g>
      </g>
    )}
    {overlay.matches.map((m) => {
      const key = matchKey(m);
      const on = !overlay.unticked.has(key);
      const r = 10 * px;
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
            r={r + 2 * px}
            fill="none"
            stroke="#fff"
            strokeWidth={7 * px}
          />
          <circle
            cx={m.centre[0]}
            cy={m.centre[1]}
            r={r + 2 * px}
            fill={on ? "rgba(0,105,92,0.15)" : "rgba(255,255,255,0.6)"}
            stroke={on ? "var(--find)" : "#5b6474"}
            strokeWidth={3.5 * px}
            strokeDasharray={on ? `${7 * px} ${4 * px}` : `${2 * px} ${4 * px}`}
            strokeLinecap={on ? "butt" : "round"}
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
            fontSize={12 * px}
            fontWeight={700}
            fill={on ? "var(--find)" : "#4b5563"}
            stroke="#fff"
            strokeWidth={4 * px}
            paintOrder="stroke"
          >
            {scoreLabel(m)}
          </text>
        </g>
      );
    })}
  </g>
);
