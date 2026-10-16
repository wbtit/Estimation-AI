import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Crop,
  Filter,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Pipette,
  Plus,
  Ruler,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import { fitZoom, MM_PER_PT } from "../lib/geometry";
import {
  beamLabel,
  evidenceText,
  flagOf,
  isColumn,
  isUndefinedBeam,
  linesOfClass,
  pieceAt,
  piecesInBox,
  stateReason,
  visible,
  type Box,
  type Layers,
  type LineFirstPage,
  type Page,
  type Piece,
  type Pt2,
  type SheetLines,
} from "../lib/lf";
import { snapPoint } from "../lib/snap";
import { ColumnIcon } from "./icons";
import { PageView } from "./PageView";

export type Tool = "select" | "crop" | "pick" | "beam" | "column" | "measure";

export interface CanvasProps {
  pdf: PDFDocumentProxy | null;
  page: Page;
  data: LineFirstPage | null;
  lines: SheetLines | null;
  layers: Layers;
  onLayers: (l: Layers) => void;
  selected: Set<string>;
  onSelect: (ids: string[], add: boolean) => void;
  pendingEdits: number;
  onCrop: (box: Box) => void;
  onPick: (p: Pt2) => void;
  onDraw: (kind: "Beams" | "Column", a: Pt2, b: Pt2 | null) => void;
  onEnds: (piece: Piece, a: Pt2, b: Pt2 | null) => void;
  onUndo: () => void;
  onDeleteSelected: () => void;
  /** Raised by the Crop section's "Redraw": switch to the Crop tool. */
  cropAsk?: number;
}

const TOOLS: { tool: Tool; Icon: LucideIcon; label: string }[] = [
  { tool: "select", Icon: MousePointer2, label: "Select" },
  { tool: "crop", Icon: Crop, label: "Crop" },
  { tool: "pick", Icon: Pipette, label: "Pick beam" },
  { tool: "beam", Icon: PenLine, label: "Draw beam" },
  { tool: "column", Icon: ColumnIcon, label: "Draw column" },
  { tool: "measure", Icon: Ruler, label: "Measure" },
];
const ICON = { size: 20, strokeWidth: 2 } as const;

const SNAP_PX = 10;
/** The page's margins in the viewport (styles.css .page-wrap: 72 left for the toolbar, 16 else). */
const PAGE_MARGIN = { x: 72 + 16, y: 16 + 16 };

export const Canvas: React.FC<CanvasProps> = (props) => {
  const { pdf, page, data, lines, layers, onLayers, selected } = props;
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [layersOpen, setLayersOpen] = useState(false);
  const [drag, setDrag] = useState<{ from: Pt2; to: Pt2 } | null>(null);
  const [first, setFirst] = useState<Pt2 | null>(null);
  const [hover, setHover] = useState<Pt2 | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt2; b: Pt2 } | null>(null);
  const [handle, setHandle] = useState<{
    piece: Piece;
    end: "a" | "b";
    at: Pt2;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  const w = page.width_pt ?? 1000;
  const h = page.height_pt ?? 800;
  const px = 1 / zoom; // one screen pixel in page points
  const pieces = data?.pieces ?? [];
  const ratio = data?.scale_ratio ?? page.setup.scale_ratio;

  const fit = useCallback(() => {
    const el = viewport.current;
    if (el)
      setZoom(
        Math.min(
          fitZoom(w, el.clientWidth - PAGE_MARGIN.x + 16),
          Math.max(0.05, (el.clientHeight - PAGE_MARGIN.y) / h),
        ),
      );
  }, [w, h]);
  useEffect(() => {
    fit();
    setFirst(null);
    setMeasure(null);
    setTool("select");
  }, [page.id, fit]);

  useEffect(() => {
    if (props.cropAsk) setTool("crop");
  }, [props.cropAsk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") {
        setFirst(null);
        setDrag(null);
        setMeasure(null);
        setTool("select");
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0)
        props.onDeleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, props]);

  const snap = (p: Pt2): Pt2 => {
    if (!lines) return p;
    const hit = snapPoint(lines.lines, p[0], p[1], SNAP_PX * px);
    return hit ? [hit.x, hit.y] : p;
  };

  const single =
    selected.size === 1
      ? (pieces.find((p) => selected.has(p.id)) ?? null)
      : null;

  const down = (
    pt: { x: number; y: number },
    e: React.PointerEvent,
  ): boolean => {
    const p: Pt2 = [pt.x, pt.y];
    if (e.button === 1 || e.button === 2 || e.altKey) {
      const el = viewport.current!;
      pan.current = {
        x: e.clientX,
        y: e.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
      return true;
    }
    if (tool === "select") {
      if (single && single.a) {
        for (const end of ["a", "b"] as const) {
          const q = single[end];
          if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) <= 6 * px) {
            setHandle({ piece: single, end, at: q });
            return true;
          }
        }
      }
      const hit = pieceAt(pieces, p, 6 * px, layers);
      if (hit) {
        props.onSelect([hit.id], e.shiftKey);
        return false;
      }
      setDrag({ from: p, to: p });
      return true;
    }
    if (tool === "crop") {
      setDrag({ from: p, to: p });
      return true;
    }
    if (tool === "pick") {
      props.onPick(p);
      return false;
    }
    if (tool === "column") {
      props.onDraw("Column", snap(p), null);
      return false;
    }
    if (tool === "beam" || tool === "measure") {
      const q = snap(p);
      if (!first) {
        setFirst(q);
        setMeasure(null);
      } else {
        if (tool === "beam") props.onDraw("Beams", first, q);
        else setMeasure({ a: first, b: q });
        setFirst(null);
      }
      return false;
    }
    return false;
  };

  const move = (pt: { x: number; y: number }, e: React.PointerEvent) => {
    const p: Pt2 = [pt.x, pt.y];
    if (pan.current) {
      const el = viewport.current!;
      el.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
      el.scrollTop = pan.current.st - (e.clientY - pan.current.y);
      return;
    }
    if (handle) setHandle({ ...handle, at: snap(p) });
    else if (drag) setDrag({ ...drag, to: p });
    setHover(first ? snap(p) : null);
  };

  const up = (pt: { x: number; y: number }, e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null;
      return;
    }
    if (handle) {
      const pc = handle.piece;
      const a = handle.end === "a" ? handle.at : pc.a!;
      const b = handle.end === "b" ? handle.at : pc.b;
      setHandle(null);
      if (
        Math.hypot(
          handle.at[0] - (pc[handle.end]?.[0] ?? 0),
          handle.at[1] - (pc[handle.end]?.[1] ?? 0),
        ) > 0.5
      )
        props.onEnds(pc, a, b);
      return;
    }
    if (!drag) return;
    const box: Box = {
      x0: Math.min(drag.from[0], pt.x),
      y0: Math.min(drag.from[1], pt.y),
      x1: Math.max(drag.from[0], pt.x),
      y1: Math.max(drag.from[1], pt.y),
    };
    setDrag(null);
    const big = box.x1 - box.x0 > 4 * px && box.y1 - box.y0 > 4 * px;
    if (tool === "crop") {
      if (big) {
        props.onCrop({
          x0: Math.max(0, box.x0),
          y0: Math.max(0, box.y0),
          x1: Math.min(w, box.x1),
          y1: Math.min(h, box.y1),
        });
        setTool("select");
      }
      return;
    }
    if (big)
      props.onSelect(
        piecesInBox(pieces, box, layers).map((p) => p.id),
        e.shiftKey,
      );
    else if (!e.shiftKey) props.onSelect([], false);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) =>
      Math.max(0.05, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))),
    );
  };

  const penLines =
    tool === "pick"
      ? linesOfClass(lines, data?.pen_class ?? page.setup.pen_class)
      : [];
  const crop = data?.crop ?? page.setup.crop;

  const toolButton = (t: (typeof TOOLS)[number]) => (
    <button
      key={t.tool}
      data-tip={t.label}
      aria-label={t.label}
      className={tool === t.tool ? "on" : ""}
      onClick={() => {
        setTool(t.tool);
        setFirst(null);
      }}
    >
      <t.Icon {...ICON} />
    </button>
  );
  const hint =
    tool === "pick"
      ? "Click one beam line"
      : tool === "crop"
        ? "Drag a box around the plan"
        : tool === "beam" || tool === "measure"
          ? first
            ? "Click the second point"
            : "Click the first point"
          : tool === "column"
            ? "Click the column centre"
            : null;

  return (
    <div className="center">
      <div className="canvas-chip">
        <b>
          Page {page.page_number}
          {page.sheet_number ? ` · ${page.sheet_number}` : ""}
        </b>
        {hint && <span className="muted">{hint}</span>}
        {measure && ratio && (
          <span data-testid="measure">
            {formatFtIn(
              Math.hypot(
                measure.b[0] - measure.a[0],
                measure.b[1] - measure.a[1],
              ) *
                MM_PER_PT *
                ratio,
            )}
          </span>
        )}
      </div>
      <div className="toolbar" data-testid="toolbar">
        {toolButton(TOOLS[0]!)}
        <span style={{ position: "relative" }}>
          <button
            data-tip={layersOpen ? undefined : "Layers"}
            aria-label="Layers"
            className={layersOpen ? "on" : ""}
            onClick={() => setLayersOpen(!layersOpen)}
          >
            <Filter {...ICON} />
          </button>
          {layersOpen && <LayerFilter layers={layers} onChange={onLayers} />}
        </span>
        <button data-tip="Fit" aria-label="Fit" onClick={fit}>
          <Maximize {...ICON} />
        </button>
        <div className="sep" />
        {TOOLS.slice(1).map(toolButton)}
        <div className="sep" />
        <button
          data-tip="Undo"
          aria-label="Undo"
          onClick={props.onUndo}
          disabled={props.pendingEdits === 0}
        >
          <Undo2 {...ICON} />
          {props.pendingEdits > 0 && (
            <span className="count">{props.pendingEdits}</span>
          )}
        </button>
      </div>
      <div className="zoom-card">
        <button
          aria-label="zoom out"
          title="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="zoom in"
          title="Zoom in"
          onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
        >
          <Plus size={16} />
        </button>
      </div>
      <div
        className="viewport"
        ref={viewport}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {pdf ? (
          <PageView
            pdf={pdf}
            pageIndex={page.page_index}
            widthPt={w}
            heightPt={h}
            zoom={zoom}
            dimPlan={!layers.plan}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            cursor={tool === "select" ? "default" : "crosshair"}
          >
            {crop && (
              <rect
                x={crop.x0}
                y={crop.y0}
                width={crop.x1 - crop.x0}
                height={crop.y1 - crop.y0}
                fill="none"
                stroke="var(--crop)"
                strokeWidth={1.5 * px}
                strokeDasharray={`${8 * px} ${5 * px}`}
                pointerEvents="none"
              />
            )}
            {layers.grids &&
              data?.grid_lines.map((g, i) => (
                <g key={i} pointerEvents="none">
                  <line
                    x1={g.a[0]}
                    y1={g.a[1]}
                    x2={g.b[0]}
                    y2={g.b[1]}
                    stroke="var(--grid)"
                    strokeWidth={1 * px}
                    strokeDasharray={`${10 * px} ${3 * px} ${2 * px} ${3 * px}`}
                    opacity={0.8}
                  />
                  {g.bubble && g.label && (
                    <text
                      x={g.bubble.cx}
                      y={g.bubble.cy - g.bubble.r - 3 * px}
                      fontSize={11 * px}
                      textAnchor="middle"
                      fill="var(--grid)"
                      fontWeight={700}
                    >
                      {g.label}
                    </text>
                  )}
                </g>
              ))}
            {penLines.map((r, i) => (
              <line
                key={`pen${i}`}
                x1={r[0]}
                y1={r[1]}
                x2={r[2]}
                y2={r[3]}
                stroke="var(--pick)"
                strokeWidth={3 * px}
                opacity={0.7}
                pointerEvents="none"
              />
            ))}
            {pieces
              .filter((p) => visible(p, layers))
              .map((p) => (
                <PieceMark
                  key={p.id}
                  p={p}
                  px={px}
                  on={selected.has(p.id)}
                  labels={layers.labels}
                  flags={layers.flags}
                />
              ))}
            {single && single.a && tool === "select" && (
              <g>
                {(["a", "b"] as const).map((end) => {
                  const q =
                    handle && handle.end === end ? handle.at : single[end];
                  return q ? (
                    <circle
                      key={end}
                      cx={q[0]}
                      cy={q[1]}
                      r={5 * px}
                      fill="#fff"
                      stroke="var(--beam)"
                      strokeWidth={2 * px}
                      style={{ cursor: "move" }}
                    />
                  ) : null;
                })}
              </g>
            )}
            {drag && (
              <rect
                x={Math.min(drag.from[0], drag.to[0])}
                y={Math.min(drag.from[1], drag.to[1])}
                width={Math.abs(drag.to[0] - drag.from[0])}
                height={Math.abs(drag.to[1] - drag.from[1])}
                fill={
                  tool === "crop"
                    ? "rgba(59,91,219,0.08)"
                    : "rgba(139,61,255,0.08)"
                }
                stroke={tool === "crop" ? "#3b5bdb" : "var(--beam)"}
                strokeWidth={1 * px}
                pointerEvents="none"
              />
            )}
            {first && hover && (
              <line
                x1={first[0]}
                y1={first[1]}
                x2={hover[0]}
                y2={hover[1]}
                stroke={tool === "beam" ? "var(--beam)" : "#111"}
                strokeWidth={2 * px}
                strokeDasharray={`${4 * px} ${3 * px}`}
                pointerEvents="none"
              />
            )}
            {measure && (
              <line
                x1={measure.a[0]}
                y1={measure.a[1]}
                x2={measure.b[0]}
                y2={measure.b[1]}
                stroke="#111"
                strokeWidth={1.5 * px}
                pointerEvents="none"
              />
            )}
          </PageView>
        ) : (
          <div className="empty">Loading drawing…</div>
        )}
      </div>
    </div>
  );
};

/** One piece on the page: a thin purple beam line with its size written beside it, or a dark
 * blue I column with its ID; one small flag at the middle when it needs review or attention. */
export const PieceMark: React.FC<{
  p: Piece;
  px: number;
  on: boolean;
  labels: boolean;
  flags?: boolean;
}> = ({ p, px, on, labels, flags = true }) => {
  if (!p.a) return null;
  const tip = [
    `${p.tag ?? ""} ${p.profile ?? "no size"}`.trim(),
    p.length_mm !== null ? formatFtIn(p.length_mm) : "",
    `Read: ${evidenceText(p)}`,
    stateReason(p),
    p.ignored ? "Ignored" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const colour = p.ignored
    ? "var(--beam-ignored)"
    : isColumn(p)
      ? "var(--column)"
      : isUndefinedBeam(p)
        ? "var(--beam-undef)"
        : "var(--beam)";
  const mid: Pt2 = p.b ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2] : p.a;
  const flag = flags ? flagOf(p) : null;
  const t = 6 * px;
  // the label runs along the beam, upright, just under it
  let angle = p.b
    ? (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI
    : 0;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const label = isColumn(p) ? "" : beamLabel(p);
  return (
    <g data-testid={`piece-${p.tag ?? p.id}`} data-flag={flag ?? undefined}>
      <title>{tip}</title>
      {isColumn(p) ? (
        <g stroke={colour} strokeWidth={(on ? 2.5 : 2) * px} fill="none">
          {on && (
            <circle
              cx={p.a[0]}
              cy={p.a[1]}
              r={t * 2}
              stroke="var(--select)"
              strokeWidth={3 * px}
            />
          )}
          <line
            x1={p.a[0] - t}
            y1={p.a[1] - t}
            x2={p.a[0] + t}
            y2={p.a[1] - t}
          />
          <line
            x1={p.a[0] - t}
            y1={p.a[1] + t}
            x2={p.a[0] + t}
            y2={p.a[1] + t}
          />
          <line x1={p.a[0]} y1={p.a[1] - t} x2={p.a[0]} y2={p.a[1] + t} />
          {/* a wide transparent box makes the column easy to hover */}
          <rect
            x={p.a[0] - 2 * t}
            y={p.a[1] - 2 * t}
            width={4 * t}
            height={4 * t}
            stroke="none"
            fill="transparent"
          />
          {labels && p.tag && (
            <text
              x={p.a[0] + t + 2 * px}
              y={p.a[1] + t + 8 * px}
              fontSize={8 * px}
              fill="var(--column-id)"
              stroke="none"
            >
              {p.tag}
            </text>
          )}
        </g>
      ) : (
        <>
          {on && (
            <line
              x1={p.a[0]}
              y1={p.a[1]}
              x2={p.b![0]}
              y2={p.b![1]}
              stroke="var(--select)"
              strokeWidth={7 * px}
              strokeOpacity={0.7}
              strokeLinecap="round"
            />
          )}
          <line
            x1={p.a[0]}
            y1={p.a[1]}
            x2={p.b![0]}
            y2={p.b![1]}
            stroke={colour}
            strokeOpacity={on ? 1 : 0.72}
            strokeWidth={(on ? 2.5 : 2) * px}
            strokeDasharray={
              isUndefinedBeam(p) ? `${6 * px} ${4 * px}` : undefined
            }
            strokeLinecap="round"
          />
          {/* a wide transparent line makes the beam easy to hover */}
          <line
            x1={p.a[0]}
            y1={p.a[1]}
            x2={p.b![0]}
            y2={p.b![1]}
            stroke="transparent"
            strokeWidth={10 * px}
          />
          {labels && label && (
            <text
              transform={`translate(${mid[0]} ${mid[1]}) rotate(${angle})`}
              y={9 * px}
              fontSize={8 * px}
              textAnchor="middle"
              fill="var(--beam-label)"
              pointerEvents="none"
            >
              {label}
            </text>
          )}
        </>
      )}
      {flag && <FlagMark at={mid} px={px} colour={flag} />}
    </g>
  );
};

/** A small flag standing on a point: a pole and a pennant, red or amber. */
const FlagMark: React.FC<{
  at: Pt2;
  px: number;
  colour: "red" | "amber";
}> = ({ at, px, colour }) => {
  const [x, y] = at;
  const h = 11 * px;
  const w = 7 * px;
  return (
    <g pointerEvents="none" data-testid="flag">
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={y - h}
        stroke="#3a3a3a"
        strokeWidth={1.2 * px}
      />
      <path
        d={`M ${x} ${y - h} L ${x + w} ${y - h + w / 2.2} L ${x} ${y - h + w * 0.9} Z`}
        fill={colour === "red" ? "var(--red)" : "var(--amber)"}
        stroke="#fff"
        strokeWidth={0.6 * px}
      />
    </g>
  );
};

const LayerFilter: React.FC<{
  layers: Layers;
  onChange: (l: Layers) => void;
}> = ({ layers, onChange }) => {
  const box = (key: keyof Layers, label: string) => (
    <label>
      <input
        type="checkbox"
        checked={layers[key] === true}
        onChange={(e) => onChange({ ...layers, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const ft = (mm: number | null) =>
    mm === null ? "" : String(Math.round((mm / 304.8) * 10) / 10);
  const mm = (text: string) =>
    text.trim() === "" || isNaN(Number(text)) ? null : Number(text) * 304.8;
  return (
    <div className="layers" data-testid="layers">
      <span className="label">Layers</span>
      {box("plan", "Plan")}
      {box("grids", "Grids")}
      {box("beams", "Beams")}
      {box("undefinedBeams", "Undefined Beams")}
      {box("columns", "Columns")}
      {box("labels", "Labels")}
      {box("flags", "Show flags")}
      {box("isolateUndefined", "Only undefined beams")}
      <div className="row">
        <span className="muted">Length ft</span>
        <input
          aria-label="min length ft"
          style={{ width: 52 }}
          placeholder="min"
          defaultValue={ft(layers.minMm)}
          onBlur={(e) => onChange({ ...layers, minMm: mm(e.target.value) })}
        />
        <input
          aria-label="max length ft"
          style={{ width: 52 }}
          placeholder="max"
          defaultValue={ft(layers.maxMm)}
          onBlur={(e) => onChange({ ...layers, maxMm: mm(e.target.value) })}
        />
      </div>
    </div>
  );
};
