import React from "react";
import { COLOUR_HEX } from "../lib/status";
import type { MemberView } from "../lib/types";

/** Members on the page: the label box and the proposed line in the status color; the selected member also shows its other candidates. */
export const MemberOverlay: React.FC<{
  members: MemberView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ members, selectedId, onSelect }) => (
  <g className="members">
    {members
      .filter((m) => !m.deleted)
      .map((m) => {
        const colour = COLOUR_HEX[m.status.color];
        const selected = m.id === selectedId;
        const b = m.bbox;
        return (
          <g
            key={m.id}
            onClick={() => onSelect(m.id)}
            className={selected ? "member sel" : "member"}
          >
            {m.link.line && (
              <line
                x1={m.link.line.p[0]}
                y1={m.link.line.p[1]}
                x2={m.link.line.q[0]}
                y2={m.link.line.q[1]}
                stroke={colour}
                strokeWidth={selected ? 5 : 3}
                strokeOpacity={selected ? 0.9 : 0.55}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {b && (
              <rect
                x={b.x0 - 2}
                y={b.y0 - 2}
                width={b.x1 - b.x0 + 4}
                height={b.y1 - b.y0 + 4}
                fill={colour}
                fillOpacity={0.18}
                stroke={colour}
                strokeWidth={selected ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {`${m.profile_raw ?? m.mark ?? "member"}: ${m.status.color}${
                    m.status.reasons.length
                      ? ` (${m.status.reasons.join("; ")})`
                      : ""
                  }`}
                </title>
              </rect>
            )}
          </g>
        );
      })}
    {members
      .filter((m) => m.id === selectedId && !m.deleted)
      .flatMap((m) =>
        m.link.candidates.map((c) => {
          const chosen = c.rank === m.link.chosen_rank;
          return (
            <g key={`${m.id}-c${c.rank}`} pointerEvents="none">
              <line
                x1={c.p[0]}
                y1={c.p[1]}
                x2={c.q[0]}
                y2={c.q[1]}
                stroke={chosen ? "#000" : "#1768c4"}
                strokeWidth={chosen ? 2 : 3}
                strokeDasharray={chosen ? undefined : "10 6"}
                strokeOpacity={0.85}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={(c.p[0] + c.q[0]) / 2}
                y={(c.p[1] + c.q[1]) / 2 - 4}
                className="cand-rank"
              >
                {c.rank}
              </text>
            </g>
          );
        }),
      )}
  </g>
);
