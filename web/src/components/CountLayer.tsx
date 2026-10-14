import React from "react";
import type { LineRow, SnappedPoint } from "../lib/snap";
import type { Pt } from "../lib/geometry";

export interface MeasureDraft {
  a: Pt | null;
  b: Pt | null;
  aSnap: SnappedPoint | null;
  bSnap: SnappedPoint | null;
  text: string | null;
}

/**
 * What the count and measure tools draw over the page: the extracted line the pointer would snap to
 * (any class), the snap radius, and for the measure tool the two points, the snap marker shown
 * BEFORE the click is confirmed, and the length.
 */
export const CountLayer: React.FC<{
  tool: "count" | "measure" | null;
  zoom: number;
  hover: Pt | null;
  hoverLine: LineRow | null;
  hoverSnap: SnappedPoint | null;
  radiusPt: number;
  measure: MeasureDraft;
}> = ({ tool, zoom, hover, hoverLine, hoverSnap, radiusPt, measure }) => {
  if (!tool) return null;
  const px = 1 / zoom;
  const marker = (s: SnappedPoint, key: string) =>
    s.kind === "endpoint" ? (
      <rect
        key={key}
        x={s.x - 5 * px}
        y={s.y - 5 * px}
        width={10 * px}
        height={10 * px}
        fill="none"
        stroke="#d4380d"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        data-testid="snap-endpoint"
      />
    ) : (
      <g key={key} data-testid="snap-intersection">
        <line
          x1={s.x - 6 * px}
          y1={s.y - 6 * px}
          x2={s.x + 6 * px}
          y2={s.y + 6 * px}
          stroke="#d4380d"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={s.x - 6 * px}
          y1={s.y + 6 * px}
          x2={s.x + 6 * px}
          y2={s.y - 6 * px}
          stroke="#d4380d"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  return (
    <g className="count-layer" pointerEvents="none">
      {tool === "count" && hoverLine && (
        <line
          x1={hoverLine[0]}
          y1={hoverLine[1]}
          x2={hoverLine[2]}
          y2={hoverLine[3]}
          stroke="#13a8a8"
          strokeWidth={5}
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
          data-testid="snap-line"
        />
      )}
      {hover && (
        <circle
          cx={hover.x}
          cy={hover.y}
          r={radiusPt}
          fill="none"
          stroke="#13a8a8"
          strokeDasharray="4 4"
          strokeOpacity={0.6}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {tool === "measure" &&
        hoverSnap &&
        !measure.b &&
        marker(hoverSnap, "hover")}
      {tool === "measure" && measure.a && (
        <circle cx={measure.a.x} cy={measure.a.y} r={4 * px} fill="#d4380d" />
      )}
      {tool === "measure" && measure.a && measure.b && (
        <>
          <line
            x1={measure.a.x}
            y1={measure.a.y}
            x2={measure.b.x}
            y2={measure.b.y}
            stroke="#d4380d"
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={measure.b.x} cy={measure.b.y} r={4 * px} fill="#d4380d" />
          {measure.text && (
            <text
              x={(measure.a.x + measure.b.x) / 2}
              y={(measure.a.y + measure.b.y) / 2 - 8 * px}
              fontSize={13 * px}
              fill="#d4380d"
              stroke="#fff"
              strokeWidth={3 * px}
              paintOrder="stroke"
              data-testid="measure-text"
            >
              {measure.text}
            </text>
          )}
        </>
      )}
      {tool === "measure" && measure.aSnap && marker(measure.aSnap, "a")}
      {tool === "measure" && measure.bSnap && marker(measure.bSnap, "b")}
    </g>
  );
};
