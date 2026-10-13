import React from "react";
import { REVIEWED_RING, SYMBOL_HEX } from "../lib/status";
import { hasCountSymbol, symbolAnchor, symbolPath } from "../lib/symbols";
import type { Box } from "../lib/geometry";
import type { MemberView } from "../lib/types";

/** What a jump link highlights on the page: a label box or a line. */
export interface Highlight {
  box?: Box;
  line?: [number, number, number, number];
  kind: "label" | "line" | "candidate";
}

const SYMBOL_PX = 9; // radius on screen, whatever the zoom
const OFFSET_PX = 16;

/**
 * One count symbol per counted piece, on the member's linked line: shape by kind group (circle,
 * triangle, square, diamond), fill by confidence (grey = no kind yet), a blue ring when a person
 * confirmed or fixed it, the tag beside it. Unlinked labels are small red hollow squares. The
 * selected piece also shows its line and candidate lines.
 */
export const SymbolOverlay: React.FC<{
  members: MemberView[];
  selectedId: string | null;
  zoom: number;
  highlight: Highlight | null;
  /** Pieces of the table row the person clicked: ringed in yellow. */
  markedIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
}> = ({ members, selectedId, zoom, highlight, markedIds, onSelect }) => {
  const r = SYMBOL_PX / zoom;
  const offset = OFFSET_PX / zoom;
  const font = 11 / zoom;
  const live = members.filter(
    (m) => !m.deleted && !m.merged_into && !m.not_member,
  );
  return (
    <g className="symbols">
      {live
        .filter((m) => m.status.color === "unlinked" && m.bbox)
        .map((m) => {
          const b = m.bbox as Box;
          const s = 6 / zoom;
          return (
            <rect
              key={m.id}
              x={(b.x0 + b.x1) / 2 - s}
              y={(b.y0 + b.y1) / 2 - s}
              width={2 * s}
              height={2 * s}
              fill="none"
              stroke={SYMBOL_HEX.red}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              onClick={() => onSelect(m.id)}
              data-testid="unlinked-square"
            >
              <title>
                unlinked label (not counted): no line was found near it
              </title>
            </rect>
          );
        })}
      {live.filter(hasCountSymbol).map((m) => {
        const a = symbolAnchor(m, offset);
        if (!a) return null;
        const colour = SYMBOL_HEX[m.symbol_color];
        const selected = m.id === selectedId;
        const path = symbolPath(m.symbol_group, r);
        const reviewed = m.human === "confirmed" || m.human === "edited";
        const sw = selected ? 3 : 1.5;
        return (
          <g
            key={m.id}
            transform={`translate(${a.x} ${a.y})`}
            onClick={() => onSelect(m.id)}
            className={selected ? "symbol sel" : "symbol"}
            data-testid="count-symbol"
            data-group={m.symbol_group}
            data-colour={m.symbol_color}
          >
            {markedIds?.has(m.id) && (
              <circle
                r={r * 2.1}
                fill="#ffe14d"
                fillOpacity={0.35}
                stroke="#c79a00"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
                data-testid="row-mark"
              />
            )}
            {reviewed && (
              <circle
                r={r * 1.55}
                fill="none"
                stroke={REVIEWED_RING}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                data-testid="reviewed-ring"
              />
            )}
            {path ? (
              <path
                d={path}
                fill={colour}
                fillOpacity={0.85}
                stroke="#111"
                strokeWidth={sw}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <circle
                r={r}
                fill={colour}
                fillOpacity={0.85}
                stroke="#111"
                strokeWidth={sw}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <text
              x={r * 1.4}
              y={r * 0.4}
              fontSize={font}
              className="symbol-tag"
              stroke="#fff"
              strokeWidth={3 / zoom}
              paintOrder="stroke"
            >
              {m.tag.text}
            </text>
            <title>
              {`${m.tag.text} ${m.kind.name ?? "no kind"} ${m.profile_raw ?? ""}: ${m.status.color}${
                m.status.reasons.length
                  ? ` (${m.status.reasons.join("; ")})`
                  : ""
              }`}
            </title>
          </g>
        );
      })}
      {live
        .filter((m) => m.id === selectedId)
        .map((m) => {
          const colour = SYMBOL_HEX[m.symbol_color];
          return (
            <g key={`sel-${m.id}`} pointerEvents="none">
              {m.link.line && (
                <line
                  x1={m.link.line.p[0]}
                  y1={m.link.line.p[1]}
                  x2={m.link.line.q[0]}
                  y2={m.link.line.q[1]}
                  stroke={colour}
                  strokeWidth={5}
                  strokeOpacity={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {m.bbox && (
                <rect
                  x={m.bbox.x0 - 2}
                  y={m.bbox.y0 - 2}
                  width={m.bbox.x1 - m.bbox.x0 + 4}
                  height={m.bbox.y1 - m.bbox.y0 + 4}
                  fill={colour}
                  fillOpacity={0.15}
                  stroke={colour}
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {m.link.candidates.map((c) => {
                const chosen = c.rank === m.link.chosen_rank;
                return (
                  <g key={c.rank}>
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
                      y={(c.p[1] + c.q[1]) / 2 - 4 / zoom}
                      fontSize={font}
                      className="cand-rank"
                    >
                      {c.rank}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      {highlight?.box && (
        <rect
          x={highlight.box.x0 - 4}
          y={highlight.box.y0 - 4}
          width={highlight.box.x1 - highlight.box.x0 + 8}
          height={highlight.box.y1 - highlight.box.y0 + 8}
          fill="#ffe14d"
          fillOpacity={0.3}
          stroke="#c79a00"
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          className="jump-highlight"
          data-testid="jump-highlight"
        />
      )}
      {highlight?.line && (
        <line
          x1={highlight.line[0]}
          y1={highlight.line[1]}
          x2={highlight.line[2]}
          y2={highlight.line[3]}
          stroke="#c79a00"
          strokeWidth={6}
          strokeOpacity={0.9}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          className="jump-highlight"
        />
      )}
    </g>
  );
};
