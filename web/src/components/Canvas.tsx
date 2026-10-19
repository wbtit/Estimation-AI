import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Crop,
  Filter,
  Hand,
  LoaderCircle,
  Maximize,
  Minus,
  MousePointer2,
  PenLine as PenLineIcon,
  Pipette,
  Plus,
  Ruler,
  SquareDashedMousePointer,
  SquareX,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import { MM_PER_PT } from "../lib/geometry";
import {
  activeView,
  beamLabel,
  COLUMN_PX,
  dashPx,
  evidenceText,
  flagOf,
  hasGlow,
  isColumn,
  isUndefinedBeam,
  issues,
  markColour,
  markWidthPx,
  nextIssue,
  penLineAt,
  penLinesInBox,
  penPreview,
  pieceAt,
  piecesInBox,
  showSizeLabel,
  stateReason,
  visible,
  type Box,
  type BuildView,
  type IssueKey,
  type Layers,
  type LineFirstPage,
  type Page,
  type PenLine,
  type Piece,
  type Pt2,
  type SheetLines,
} from "../lib/lf";
import { snapPoint } from "../lib/snap";
import {
  anchorIn,
  clampZoom,
  parseZoom,
  viewOfBox,
  wheelFactor,
  wheelPan,
  zoomAround,
  type View,
} from "../lib/zoom";
import {
  cursorFor,
  dragHandle,
  effectiveTool,
  HANDLE_CURSOR,
  handleAt,
  handlePoints,
  pressPans,
  SHORTCUTS,
  tipOf,
  toolForKey,
  type BoxHandle,
  type Tool,
} from "../lib/tools";
import { ColumnIcon } from "./icons";
import { PageView } from "./PageView";

export type { Tool };
export type PickMode = "replace" | "add";

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
  onPick: (p: Pt2, mode: PickMode) => void;
  onDraw: (kind: "Beams" | "Column", a: Pt2, b: Pt2 | null) => void;
  onEnds: (piece: Piece, a: Pt2, b: Pt2 | null) => void;
  onUndo: () => void;
  onDeleteSelected: () => void;
  /** Drawing fade 0..1 and its change (the Layers slider). */
  fade?: number;
  onFade?: (f: number) => void;
  /** The active view of the page (its box, pens, exclusions and deselections are shown). */
  activeViewId?: string | null;
  onActiveView?: (id: string) => void;
  onRemovePen?: (pen: string) => void;
  onToggleDeselect?: (
    line: [number, number, number, number],
    index: number,
  ) => void;
  onBoxDeselect?: (lines: PenLine[]) => void;
  onResetDeselect?: () => void;
  onExclude?: (box: Box) => void;
  onDeleteExclusion?: (id: string) => void;
  onAcceptExclusions?: (ids: string[] | "all") => void;
  onSuggestExcludes?: () => void;
  onAddView?: (box: Box) => void;
  /** Raised from outside (the Crop section's Redraw, the page card's + Add view or Edit box):
   * use a tool. */
  toolAsk?: { tool: Tool; n: number };
  /** A view of this page is building: a spinner in the bar. */
  building?: boolean;
  /** A: approve the selected members. */
  onApprove?: () => void;
}

const TOOLS: { tool: Tool; Icon: LucideIcon; label: string }[] = [
  { tool: "select", Icon: MousePointer2, label: "Select" },
  { tool: "hand", Icon: Hand, label: "Hand" },
  { tool: "crop", Icon: Crop, label: "Crop" },
  { tool: "pick", Icon: Pipette, label: "Pick beam" },
  { tool: "exclude", Icon: SquareX, label: "Exclude area" },
  { tool: "view", Icon: SquareDashedMousePointer, label: "Add view" },
  { tool: "beam", Icon: PenLineIcon, label: "Draw beam" },
  { tool: "column", Icon: ColumnIcon, label: "Draw column" },
  { tool: "measure", Icon: Ruler, label: "Measure" },
];
const ICON = { size: 20, strokeWidth: 2 } as const;

const SNAP_PX = 10;
/** Where the page sits in the viewport (styles.css .page-wrap margin: 16 72 left). */
export const PAGE_OFFSET = { x: 72, y: 16 };
const PAGE_MARGIN = { x: 72 + 16, y: 16 + 16 };

const isTyping = (t: EventTarget | null) => {
  const tag = (t as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
};

const pieceBox = (p: Piece): Box => {
  const a = p.a!;
  const b = p.b ?? a;
  return {
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
  };
};

export const Canvas: React.FC<CanvasProps> = (props) => {
  const { pdf, page, data, lines, layers, onLayers, selected } = props;
  const [tool, setTool] = useState<Tool>("select");
  const [pickMode, setPickMode] = useState<PickMode>("replace");
  const [zoom, setZoom] = useState(1);
  const [zoomText, setZoomText] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [drag, setDrag] = useState<{
    from: Pt2;
    to: Pt2;
    ctrl: boolean;
  } | null>(null);
  const [first, setFirst] = useState<Pt2 | null>(null);
  const [hover, setHover] = useState<Pt2 | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt2; b: Pt2 } | null>(null);
  const [lastIssue, setLastIssue] = useState<IssueKey | null>(null);
  const [exclusionOn, setExclusionOn] = useState<string | null>(null);
  const [handle, setHandle] = useState<{
    piece: Piece;
    end: "a" | "b";
    at: Pt2;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const centre = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  const [overHandle, setOverHandle] = useState<BoxHandle | null>(null);
  const [help, setHelp] = useState(false);
  /** Edit box: the handle being dragged and the box as it is now. */
  const [boxEdit, setBoxEdit] = useState<{
    handle: BoxHandle;
    from: Pt2;
    start: Box;
    box: Box;
  } | null>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  const w = page.width_pt ?? 1000;
  const h = page.height_pt ?? 800;
  const px = 1 / zoom; // one screen pixel in page points
  const pieces = useMemo(() => data?.pieces ?? [], [data]);
  const views: BuildView[] = data?.views ?? [];
  const view = activeView(views, props.activeViewId ?? null);
  const ratio =
    view?.scale_ratio ?? data?.scale_ratio ?? page.setup.scale_ratio;
  const crop = view ? view.box : (data?.crop ?? page.setup.crop);
  const pens = view
    ? view.pens.map((p) => p.pen_class)
    : (data?.pens ?? (page.setup.pen_class ? [page.setup.pen_class] : []));

  /** Show a view of the page: the zoom now, the scroll once the page has its new size. */
  const show = useCallback((v: View) => {
    pendingScroll.current = { left: v.left, top: v.top };
    if (Math.abs(v.zoom - zoomRef.current) < 1e-9) {
      const el = viewport.current;
      if (el) {
        el.scrollLeft = v.left;
        el.scrollTop = v.top;
      }
      pendingScroll.current = null;
    }
    setZoom(v.zoom);
  }, []);
  useLayoutEffect(() => {
    const el = viewport.current;
    const s = pendingScroll.current;
    if (el && s) {
      el.scrollLeft = s.left;
      el.scrollTop = s.top;
    }
    pendingScroll.current = null;
  }, [zoom]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const z = clampZoom(
      Math.min(
        (el.clientWidth - PAGE_MARGIN.x) / w,
        (el.clientHeight - PAGE_MARGIN.y) / h,
      ),
    );
    show({ zoom: z, left: 0, top: 0 });
  }, [w, h, show]);

  /** Zoom around a point of the viewport (CSS px from its corner); the centre by default. */
  const zoomTo = useCallback(
    (z: number, at?: Pt2) => {
      const el = viewport.current;
      if (!el) return setZoom(clampZoom(z));
      const p: Pt2 = at ?? [el.clientWidth / 2, el.clientHeight / 2];
      show(
        zoomAround(
          { zoom: zoomRef.current, left: el.scrollLeft, top: el.scrollTop },
          z,
          p,
          PAGE_OFFSET,
        ),
      );
    },
    [show],
  );

  useEffect(() => {
    fit();
    setFirst(null);
    setMeasure(null);
    setTool("select");
    setLastIssue(null);
    setExclusionOn(null);
  }, [page.id, fit]);

  useEffect(() => {
    if (props.toolAsk) setTool(props.toolAsk.tool);
  }, [props.toolAsk]);

  // the wheel: ctrl + wheel (and a trackpad pinch) zooms around the pointer; plain wheel pans up
  // and down, shift + wheel left and right. Bound to the whole canvas area (the page, the floating
  // toolbar and the bar above it; passive: false), so ctrl + wheel over the toolbar or the bar
  // zooms the page, never the browser. Over the toolbar or the bar, the zoom is around the nearest
  // point of the page area.
  useEffect(() => {
    const area = centre.current;
    const el = viewport.current;
    if (!area || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomTo(
          zoomRef.current * wheelFactor(e.deltaY, e.deltaMode),
          anchorIn(r, e.clientX, e.clientY),
        );
        return;
      }
      const d = wheelPan(e);
      el.scrollLeft += d.dx;
      el.scrollTop += d.dy;
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // the issue navigator: attention first, then review
  const issueList = useMemo(
    () => issues(pieces, views, layers),
    [pieces, views, layers],
  );
  const nAttention = issueList.filter(
    (x) => x.piece.build_state === "attention",
  ).length;
  const nReview = issueList.length - nAttention;
  const step = useCallback(
    (dir: 1 | -1) => {
      const it = nextIssue(issueList, lastIssue, dir);
      const el = viewport.current;
      if (!it || !el) return;
      setLastIssue(it.key);
      setTool("select");
      show(
        viewOfBox(
          pieceBox(it.piece),
          { w: el.clientWidth, h: el.clientHeight },
          PAGE_OFFSET,
        ),
      );
      props.onSelect([it.piece.id], false);
    },
    [issueList, lastIssue, show, props],
  );

  /** Esc: cancel what is being drawn (a box, a beam, an Edit box drag), then back to Select. */
  const cancel = useCallback(() => {
    setFirst(null);
    setDrag(null);
    setMeasure(null);
    setBoxEdit(null);
    setTool("select");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!space.current) {
          space.current = true;
          setSpaceHeld(true);
        }
        return;
      }
      if (e.key === "Escape") {
        if (help) setHelp(false);
        else cancel();
        return;
      }
      if (e.key === "?") {
        setHelp((h) => !h);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (props.pendingEdits > 0) props.onUndo();
        return;
      }
      if (
        (e.key === "n" || e.key === "N") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        step(e.shiftKey ? -1 : 1);
        return;
      }
      if (
        (e.key === "a" || e.key === "A") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (selected.size > 0) props.onApprove?.();
        return;
      }
      const t = toolForKey(e.key, {
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
      });
      if (t) {
        setTool(t);
        setFirst(null);
        setDrag(null);
        setBoxEdit(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && exclusionOn) {
        props.onDeleteExclusion?.(exclusionOn);
        setExclusionOn(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0)
        props.onDeleteSelected();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        space.current = false;
        setSpaceHeld(false);
        // a focused button (the last tool clicked) is pressed by Space on key up: Space is the
        // temporary hand here, never a click (typing in a field is left alone)
        if (!isTyping(e.target)) e.preventDefault();
      }
    };
    // a lost focus never leaves the hand stuck on
    const onBlur = () => {
      space.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [selected, props, step, exclusionOn, help, cancel]);

  const snap = (p: Pt2): Pt2 => {
    if (!lines) return p;
    const hit = snapPoint(lines.lines, p[0], p[1], SNAP_PX * px);
    return hit ? [hit.x, hit.y] : p;
  };

  const preview = useMemo(
    () => (tool === "pick" ? penPreview(lines, pens, crop, view) : []),
    [tool, lines, pens, crop, view],
  );

  const single =
    selected.size === 1
      ? (pieces.find((p) => selected.has(p.id)) ?? null)
      : null;

  const exclusionAt = (p: Pt2) =>
    (view?.exclusions ?? []).find(
      (e) =>
        p[0] >= e.box.x0 &&
        p[0] <= e.box.x1 &&
        p[1] >= e.box.y0 &&
        p[1] <= e.box.y1,
    ) ?? null;

  const down = (
    pt: { x: number; y: number },
    e: React.PointerEvent,
  ): boolean => {
    const p: Pt2 = [pt.x, pt.y];
    if (pressPans(e.button, tool, space.current)) {
      const el = viewport.current!;
      e.preventDefault();
      pan.current = {
        x: e.clientX,
        y: e.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
      setPanning(true);
      return true;
    }
    if (tool === "editBox") {
      const b = view?.box;
      const hd = b ? handleAt(b, p, 7 * px) : null;
      if (b && hd) {
        setBoxEdit({ handle: hd, from: p, start: b, box: b });
        return true;
      }
      return false;
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
      setDrag({ from: p, to: p, ctrl: false });
      return true;
    }
    if (tool === "crop" || tool === "view") {
      setDrag({ from: p, to: p, ctrl: false });
      return true;
    }
    if (tool === "exclude") {
      const ex = exclusionAt(p);
      if (ex) {
        setExclusionOn(ex.id);
        return false;
      }
      setExclusionOn(null);
      setDrag({ from: p, to: p, ctrl: false });
      return true;
    }
    if (tool === "pick") {
      if (e.ctrlKey || e.metaKey) {
        setDrag({ from: p, to: p, ctrl: true });
        return true;
      }
      const l = penLineAt(preview, p, 6 * px);
      if (l) props.onToggleDeselect?.(l.line, l.index);
      else props.onPick(p, pickMode);
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
    if (boxEdit) {
      setBoxEdit({
        ...boxEdit,
        box: dragHandle(
          boxEdit.start,
          boxEdit.handle,
          p[0] - boxEdit.from[0],
          p[1] - boxEdit.from[1],
          { w, h },
        ),
      });
      return;
    }
    if (tool === "editBox") {
      const b = view?.box;
      setOverHandle(b ? handleAt(b, p, 7 * px) : null);
    }
    if (handle) setHandle({ ...handle, at: snap(p) });
    else if (drag) setDrag({ ...drag, to: p });
    setHover(first ? snap(p) : null);
    if (tool === "select" && !drag && !handle) {
      const hit = pieceAt(pieces, p, 6 * px, layers);
      setHoverId(hit?.id ?? null);
    }
  };

  const up = (pt: { x: number; y: number }, e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      return;
    }
    if (boxEdit) {
      const b = boxEdit.box;
      const s0 = boxEdit.start;
      setBoxEdit(null);
      const moved =
        Math.max(
          Math.abs(b.x0 - s0.x0),
          Math.abs(b.y0 - s0.y0),
          Math.abs(b.x1 - s0.x1),
          Math.abs(b.y1 - s0.y1),
        ) > 0.5;
      if (moved)
        props.onCrop({
          x0: Math.round(b.x0 * 100) / 100,
          y0: Math.round(b.y0 * 100) / 100,
          x1: Math.round(b.x1 * 100) / 100,
          y1: Math.round(b.y1 * 100) / 100,
        });
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
      x0: Math.max(0, Math.min(drag.from[0], pt.x)),
      y0: Math.max(0, Math.min(drag.from[1], pt.y)),
      x1: Math.min(w, Math.max(drag.from[0], pt.x)),
      y1: Math.min(h, Math.max(drag.from[1], pt.y)),
    };
    const ctrl = drag.ctrl;
    setDrag(null);
    const big = box.x1 - box.x0 > 4 * px && box.y1 - box.y0 > 4 * px;
    if (tool === "crop") {
      if (big) {
        props.onCrop(box);
        setTool("select");
      }
      return;
    }
    if (tool === "view") {
      if (big) {
        props.onAddView?.(box);
        setTool("select");
      }
      return;
    }
    if (tool === "exclude") {
      if (big) props.onExclude?.(box);
      return;
    }
    if (tool === "pick") {
      if (ctrl && big) {
        const inside = penLinesInBox(preview, box);
        if (inside.length) props.onBoxDeselect?.(inside);
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

  const shown = effectiveTool(tool, spaceHeld);
  const toolButton = (t: (typeof TOOLS)[number]) => (
    <button
      key={t.tool}
      data-tip={tipOf(t.label, t.tool)}
      aria-label={t.label}
      aria-keyshortcuts={
        tipOf("", t.tool).trim().replace(/[()]/g, "") || undefined
      }
      className={shown === t.tool ? "on" : ""}
      onClick={() => {
        setTool(t.tool);
        setFirst(null);
        setBoxEdit(null);
      }}
    >
      <t.Icon {...ICON} />
    </button>
  );
  const hint =
    shown === "hand"
      ? "Drag to move the page"
      : tool === "pick"
        ? pens.length
          ? "Click a highlighted line to deselect it · Ctrl + drag a box · click another line to pick its pen"
          : "Click one beam line"
        : tool === "crop"
          ? "Drag a box around the plan · Esc cancels"
          : tool === "view"
            ? "Drag the box of the new view · Esc cancels"
            : tool === "editBox"
              ? `Drag a handle of ${view?.name ?? "the view"}'s box · Esc when done`
              : tool === "exclude"
                ? "Drag a box over a title block, detail, table or legend · click a box to select it"
                : tool === "beam" || tool === "measure"
                  ? first
                    ? "Click the second point"
                    : "Click the first point"
                  : tool === "column"
                    ? "Click the column centre"
                    : null;
  const deselected = view?.deselections.length ?? 0;
  const unmatched = view?.deselections_unmatched ?? 0;
  const suggested = (view?.exclusions ?? []).filter(
    (e) => e.status === "suggested",
  );
  const exSel =
    (view?.exclusions ?? []).find((e) => e.id === exclusionOn) ?? null;
  const several = views.length > 1;
  const editing =
    tool === "editBox" && view?.box ? (boxEdit?.box ?? view.box) : null;

  return (
    <div className="center" ref={centre} data-testid="canvas-area">
      <div className="canvas-bar" data-testid="canvas-bar">
        <b className="title">
          Page {page.page_number}
          {page.sheet_number ? ` · ${page.sheet_number}` : ""}
          {several && view ? ` · ${view.name}` : ""}
        </b>
        {issueList.length > 0 && (
          <div className="navigator" data-testid="navigator">
            <button
              aria-label="previous issue"
              title="Previous issue (Shift+N)"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              <b className="n-attention">{nAttention}</b> need attention ·{" "}
              <b className="n-review">{nReview}</b> to review
            </span>
            <button
              aria-label="next issue"
              title="Next issue (N)"
              onClick={() => step(1)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        )}
        {hint && <span className="hint">{hint}</span>}
        {measure && ratio && (
          <span className="measure" data-testid="measure">
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
        <span className="grow" />
        {props.building && (
          <span className="building" data-testid="canvas-building">
            <LoaderCircle size={14} className="spin" /> Building…
          </span>
        )}
        <div className="zoom-group">
          <button
            aria-label="zoom out"
            title="Zoom out (Ctrl+wheel)"
            onClick={() => zoomTo(zoom / 1.25)}
          >
            <Minus size={15} />
          </button>
          <input
            aria-label="zoom percent"
            className="zoom-box"
            value={zoomText ?? `${Math.round(zoom * 100)}%`}
            onFocus={(e) => {
              setZoomText(String(Math.round(zoom * 100)));
              e.target.select();
            }}
            onChange={(e) => setZoomText(e.target.value)}
            onBlur={() => {
              const z = zoomText === null ? null : parseZoom(zoomText);
              if (z !== null && Math.abs(z - zoom) > 1e-9) zoomTo(z);
              setZoomText(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setZoomText(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <button
            aria-label="zoom in"
            title="Zoom in (Ctrl+wheel)"
            onClick={() => zoomTo(zoom * 1.25)}
          >
            <Plus size={15} />
          </button>
          <button
            className="fit"
            aria-label="Fit"
            title="Fit the page"
            onClick={fit}
          >
            <Maximize size={14} /> Fit
          </button>
        </div>
        <button
          className="help"
          aria-label="keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setHelp(!help)}
        >
          <CircleHelp size={16} />
        </button>
      </div>
      {help && (
        <div
          className="shortcuts"
          data-testid="shortcuts"
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <div className="row">
            <b>Keyboard shortcuts</b>
            <span className="grow" />
            <button className="link" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
          <table>
            <tbody>
              {SHORTCUTS.map((k) => (
                <tr key={k.keys}>
                  <td>
                    <kbd>{k.keys}</kbd>
                  </td>
                  <td>{k.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tool === "pick" && (
        <div className="tool-bar" data-testid="pick-bar">
          <div className="seg light">
            <button
              className={pickMode === "replace" ? "on" : ""}
              onClick={() => setPickMode("replace")}
              title="The next picked line's pen replaces the view's beam pens"
            >
              Replace pen
            </button>
            <button
              className={pickMode === "add" ? "on" : ""}
              onClick={() => setPickMode("add")}
              title="The next picked line's pen is added (e.g. girders drawn heavier than infill)"
            >
              Add pen
            </button>
          </div>
          {pens.map((pen) => (
            <span key={pen} className="pen-chip" title={pen}>
              {pen.split("|").slice(0, 2).join(" ")}
              {pens.length > 1 && props.onRemovePen && (
                <button
                  aria-label={`remove pen ${pen}`}
                  onClick={() => props.onRemovePen!(pen)}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {deselected > 0 && (
            <button className="link" onClick={() => props.onResetDeselect?.()}>
              Reset deselections ({deselected})
            </button>
          )}
          {unmatched > 0 && (
            <span className="warn" data-testid="unmatched">
              {unmatched} deselected line{unmatched === 1 ? "" : "s"} not found
            </span>
          )}
        </div>
      )}
      {tool === "exclude" && (
        <div className="tool-bar" data-testid="exclude-bar">
          <button onClick={() => props.onSuggestExcludes?.()}>
            Suggest excludes
          </button>
          {suggested.length > 0 && (
            <button
              className="primary"
              onClick={() => props.onAcceptExclusions?.("all")}
            >
              Accept all ({suggested.length})
            </button>
          )}
          {exSel && exSel.status === "suggested" && (
            <button onClick={() => props.onAcceptExclusions?.([exSel.id])}>
              Accept
            </button>
          )}
          {exSel && (
            <button
              className="danger"
              onClick={() => {
                props.onDeleteExclusion?.(exSel.id);
                setExclusionOn(null);
              }}
            >
              Delete box
            </button>
          )}
        </div>
      )}
      {tool === "editBox" && (
        <div className="tool-bar" data-testid="editbox-bar">
          <span>
            Editing <b>{view?.name ?? "the view"}</b>: each drag is saved (Undo
            puts it back)
          </span>
          <button onClick={cancel}>Done</button>
        </div>
      )}
      <div className="toolbar" data-testid="toolbar">
        {toolButton(TOOLS[0]!)}
        {toolButton(TOOLS[1]!)}
        <span style={{ position: "relative" }}>
          <button
            data-tip={layersOpen ? undefined : "Layers"}
            aria-label="Layers"
            className={layersOpen ? "on" : ""}
            onClick={() => setLayersOpen(!layersOpen)}
          >
            <Filter {...ICON} />
          </button>
          {layersOpen && (
            <LayerFilter
              layers={layers}
              onChange={onLayers}
              fade={props.fade ?? 0}
              onFade={props.onFade}
            />
          )}
        </span>
        <div className="sep" />
        {TOOLS.slice(2).map(toolButton)}
        <div className="sep" />
        <button
          data-tip="Undo (Ctrl+Z)"
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
      <div
        className="viewport"
        ref={viewport}
        data-testid="viewport"
        onContextMenu={(e) => e.preventDefault()}
        // the middle button pans here, not the browser's autoscroll
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
      >
        {pdf ? (
          <PageView
            pdf={pdf}
            pageIndex={page.page_index}
            widthPt={w}
            heightPt={h}
            zoom={zoom}
            dimPlan={!layers.plan}
            fade={props.fade ?? 0}
            scroller={viewport}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            cursor={
              tool === "editBox" && !panning && (boxEdit || overHandle)
                ? HANDLE_CURSOR[boxEdit?.handle ?? overHandle!]
                : cursorFor(tool, spaceHeld, panning)
            }
          >
            <defs>
              <pattern
                id="hatch"
                width={8 * px}
                height={8 * px}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={8 * px}
                  stroke="#9aa1b2"
                  strokeWidth={1.2 * px}
                />
              </pattern>
            </defs>
            {!several && crop && !editing && (
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
            {several &&
              views.map((v) =>
                v.box && !(editing && v.id === view?.id) ? (
                  <ViewBox
                    key={v.id}
                    v={v}
                    px={px}
                    active={v.id === view?.id}
                    onPick={() => props.onActiveView?.(v.id)}
                  />
                ) : null,
              )}
            {editing && <EditBox b={editing} px={px} />}
            {/* suggestions show only while the Exclude tool is on; accepted boxes always */}
            {(view?.exclusions ?? [])
              .filter((e) => e.status === "accepted" || tool === "exclude")
              .map((e) => (
                <ExclusionBox
                  key={e.id}
                  e={e}
                  px={px}
                  on={e.id === exclusionOn}
                  strong={tool === "exclude" || tool === "pick"}
                />
              ))}
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
            {preview.map((l) => (
              <PreviewLine key={`pen${l.index}`} l={l} px={px} />
            ))}
            {pieces
              .filter((p) => visible(p, layers))
              .map((p) => (
                <PieceMark
                  key={p.id}
                  p={p}
                  px={px}
                  on={selected.has(p.id)}
                  hover={p.id === hoverId}
                  labels={layers.labels}
                  allSizes={layers.allSizes}
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
                      stroke="var(--select)"
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
                  tool === "exclude"
                    ? "url(#hatch)"
                    : tool === "crop" || tool === "view"
                      ? "rgba(61,107,245,0.08)"
                      : "rgba(41,121,255,0.08)"
                }
                stroke={tool === "exclude" ? "#6b7280" : "var(--crop)"}
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

/** The active view's box while Edit box is on: solid, with eight square handles. */
const EditBox: React.FC<{ b: Box; px: number }> = ({ b, px }) => (
  <g data-testid="edit-box" pointerEvents="none">
    <rect
      x={b.x0}
      y={b.y0}
      width={b.x1 - b.x0}
      height={b.y1 - b.y0}
      fill="rgba(61,107,245,0.05)"
      stroke="var(--crop)"
      strokeWidth={2 * px}
    />
    {Object.entries(handlePoints(b)).map(([k, q]) => (
      <rect
        key={k}
        x={q[0] - 5 * px}
        y={q[1] - 5 * px}
        width={10 * px}
        height={10 * px}
        fill="#fff"
        stroke="var(--crop)"
        strokeWidth={1.5 * px}
      />
    ))}
  </g>
);

/** A view's box with its name; the active view solid, the others dashed. */
const ViewBox: React.FC<{
  v: BuildView;
  px: number;
  active: boolean;
  onPick: () => void;
}> = ({ v, px, active, onPick }) => {
  const b = v.box!;
  return (
    <g data-testid={`view-box-${v.position}`}>
      <rect
        x={b.x0}
        y={b.y0}
        width={b.x1 - b.x0}
        height={b.y1 - b.y0}
        fill={active ? "rgba(61,107,245,0.04)" : "none"}
        stroke="var(--crop)"
        strokeWidth={(active ? 2.5 : 1.2) * px}
        strokeDasharray={active ? undefined : `${8 * px} ${5 * px}`}
        pointerEvents="none"
      />
      <g
        transform={`translate(${b.x0} ${b.y0})`}
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        <rect
          width={(v.name.length * 7 + 14) * px}
          height={18 * px}
          fill={active ? "var(--crop)" : "#fff"}
          stroke="var(--crop)"
          strokeWidth={1 * px}
        />
        <text
          x={7 * px}
          y={13 * px}
          fontSize={11 * px}
          fontWeight={700}
          fill={active ? "#fff" : "var(--crop)"}
        >
          {v.name}
        </text>
      </g>
    </g>
  );
};

/** An exclude area: accepted = grey hatched box; suggested = dashed box marked "suggested". */
const ExclusionBox: React.FC<{
  e: { id: string; box: Box; status: string; rule: string | null };
  px: number;
  on: boolean;
  strong: boolean;
}> = ({ e, px, on, strong }) => {
  const b = e.box;
  const sug = e.status === "suggested";
  return (
    <g
      pointerEvents="none"
      data-testid={sug ? "exclusion-suggested" : "exclusion"}
    >
      <rect
        x={b.x0}
        y={b.y0}
        width={b.x1 - b.x0}
        height={b.y1 - b.y0}
        fill={sug ? "rgba(255,145,0,0.06)" : "url(#hatch)"}
        fillOpacity={sug ? 1 : strong ? 0.9 : 0.45}
        stroke={on ? "var(--accent)" : sug ? "var(--review)" : "#6b7280"}
        strokeWidth={(on ? 2.5 : 1.5) * px}
        strokeDasharray={sug ? `${7 * px} ${4 * px}` : undefined}
      />
      {sug && (
        <text
          x={b.x0 + 4 * px}
          y={b.y0 + 13 * px}
          fontSize={11 * px}
          fill="var(--review)"
          fontWeight={700}
        >
          suggested{e.rule ? ` · ${e.rule.replace("_", " ")}` : ""}
        </text>
      )}
    </g>
  );
};

/** A line of the pen preview: highlighted, or grey and struck through once deselected. */
const PreviewLine: React.FC<{ l: PenLine; px: number }> = ({ l, px }) => {
  const [x0, y0, x1, y1] = l.line;
  const off = l.deselected || l.excluded;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const s = 5 * px;
  return (
    <g pointerEvents="none" data-testid={l.deselected ? "pen-off" : "pen-on"}>
      <line
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke="#fff"
        strokeWidth={6 * px}
        strokeLinecap="round"
      />
      <line
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={off ? "#9aa1b2" : "var(--pick)"}
        strokeWidth={(off ? 2 : 4) * px}
        strokeDasharray={off ? `${4 * px} ${3 * px}` : undefined}
        strokeLinecap="round"
      />
      {l.deselected && (
        <path
          d={`M ${mx - s} ${my - s} L ${mx + s} ${my + s} M ${mx - s} ${my + s} L ${mx + s} ${my - s}`}
          stroke="#6b7280"
          strokeWidth={1.6 * px}
        />
      )}
    </g>
  );
};

/** One piece on the page, drawn whole in its state colour (attention red, needs review orange,
 * else the kind colour: beams magenta, columns blue) with a thin white halo so it reads over any
 * linework. Only attention glows (a soft red band; a red ring on a column). The width follows the
 * zoom (MARK_PT on paper, MARK_MIN_PX..MARK_MAX_PX on screen, MARK_ON_PX hovered or selected);
 * undefined beams are dashed with dashes scaled to the width; a column is an I of COLUMN_PX on
 * screen at every zoom. The read size is written along the beam only where it differs from the
 * drawing's label, on hover or selection, or with "Show all read sizes". */
export const PieceMark: React.FC<{
  p: Piece;
  /** One screen pixel in page points (1 / zoom). */
  px: number;
  on: boolean;
  hover?: boolean;
  labels: boolean;
  allSizes?: boolean;
  flags?: boolean;
}> = ({
  p,
  px,
  on,
  hover = false,
  labels,
  allSizes = false,
  flags = false,
}) => {
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
  const colour = markColour(p);
  const glow = hasGlow(p);
  const mid: Pt2 = p.b ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2] : p.a;
  const flag = flags ? flagOf(p) : null;
  const wide = on || hover;
  const zoom = 1 / px;
  const swPx = markWidthPx(zoom, wide);
  const sw = swPx * px;
  const halo = sw + Math.min(2, swPx * 0.6 + 0.8) * px;
  // the label runs along the beam, upright, just under it
  let angle = p.b
    ? (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI
    : 0;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const state = p.ignored
    ? "ignored"
    : p.approved
      ? "approved"
      : (p.build_state ?? "found");
  if (isColumn(p)) {
    const t = (COLUMN_PX / 2) * px;
    const cw = Math.min(swPx, 2.5) * px;
    const I = `M ${p.a[0] - t} ${p.a[1] - t} L ${p.a[0] + t} ${p.a[1] - t} M ${p.a[0] - t} ${p.a[1] + t} L ${p.a[0] + t} ${p.a[1] + t} M ${p.a[0]} ${p.a[1] - t} L ${p.a[0]} ${p.a[1] + t}`;
    const showTag = labels && p.tag && (allSizes || wide);
    return (
      <g
        data-testid={`piece-${p.tag ?? p.id}`}
        data-state={state}
        data-glow={glow ? "1" : undefined}
        data-flag={flag ?? undefined}
      >
        <title>{tip}</title>
        {glow && (
          <circle
            data-testid="glow"
            cx={p.a[0]}
            cy={p.a[1]}
            r={t * 1.75}
            fill="none"
            stroke="var(--attention)"
            strokeWidth={1.5 * px}
            opacity={0.75}
          />
        )}
        {on && (
          <circle
            cx={p.a[0]}
            cy={p.a[1]}
            r={t * 1.7}
            fill="none"
            stroke="var(--select)"
            strokeWidth={2.5 * px}
          />
        )}
        <path
          d={I}
          stroke="#fff"
          strokeWidth={cw + 2 * px}
          fill="none"
          strokeLinecap="square"
        />
        <path
          d={I}
          stroke={colour}
          strokeWidth={wide ? cw + 1 * px : cw}
          fill="none"
          strokeLinecap="square"
        />
        {/* a wide transparent box makes the column easy to hover */}
        <rect
          x={p.a[0] - 1.6 * t}
          y={p.a[1] - 1.6 * t}
          width={3.2 * t}
          height={3.2 * t}
          fill="transparent"
        />
        {showTag && (
          <text
            x={p.a[0] + t + 3 * px}
            y={p.a[1] + t + 9 * px}
            fontSize={10 * px}
            fill="var(--column-id)"
            stroke="#fff"
            strokeWidth={3 * px}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {p.tag}
          </text>
        )}
        {flag && <FlagMark at={mid} px={px} colour={flag} />}
      </g>
    );
  }
  const seg = { x1: p.a[0], y1: p.a[1], x2: p.b![0], y2: p.b![1] };
  const [dash, gap] = dashPx(swPx);
  const label =
    labels && showSizeLabel(p, { hover, on, allSizes }) ? beamLabel(p) : "";
  return (
    <g
      data-testid={`piece-${p.tag ?? p.id}`}
      data-state={state}
      data-glow={glow ? "1" : undefined}
      data-flag={flag ?? undefined}
    >
      <title>{tip}</title>
      {glow && (
        <line
          data-testid="glow"
          {...seg}
          stroke="var(--attention)"
          strokeOpacity={0.22}
          strokeWidth={sw + 5 * px}
          strokeLinecap="round"
        />
      )}
      {on && (
        <line
          {...seg}
          stroke="var(--select)"
          strokeWidth={sw + 5 * px}
          strokeOpacity={0.7}
          strokeLinecap="round"
        />
      )}
      <line {...seg} stroke="#fff" strokeWidth={halo} strokeLinecap="round" />
      <line
        {...seg}
        stroke={colour}
        strokeWidth={sw}
        strokeDasharray={
          isUndefinedBeam(p) ? `${dash * px} ${gap * px}` : undefined
        }
        strokeLinecap="round"
      />
      {/* a wide transparent line makes the beam easy to hover */}
      <line {...seg} stroke="transparent" strokeWidth={12 * px} />
      {label && (
        <text
          data-testid="size-label"
          transform={`translate(${mid[0]} ${mid[1]}) rotate(${angle})`}
          y={11 * px}
          fontSize={10 * px}
          textAnchor="middle"
          fill="var(--beam-label)"
          stroke="#fff"
          strokeWidth={3 * px}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {label}
        </text>
      )}
      {flag && <FlagMark at={mid} px={px} colour={flag} />}
    </g>
  );
};

/** A small flag standing on a point: a pole and a pennant, red or amber (optional layer). */
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
        fill={colour === "red" ? "var(--attention)" : "var(--review)"}
        stroke="#fff"
        strokeWidth={0.6 * px}
      />
    </g>
  );
};

const LayerFilter: React.FC<{
  layers: Layers;
  onChange: (l: Layers) => void;
  fade: number;
  onFade?: (f: number) => void;
}> = ({ layers, onChange, fade, onFade }) => {
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
      <label className="fade">
        <span>Drawing fade</span>
        <input
          type="range"
          aria-label="drawing fade"
          min={0}
          max={100}
          step={5}
          value={Math.round(fade * 100)}
          onChange={(e) => onFade?.(Number(e.target.value) / 100)}
        />
        <span className="muted">{Math.round(fade * 100)}%</span>
      </label>
      {box("plan", "Plan")}
      {box("grids", "Grids")}
      {box("beams", "Beams")}
      {box("undefinedBeams", "Undefined Beams")}
      {box("columns", "Columns")}
      {box("labels", "Labels")}
      {box("allSizes", "Show all read sizes")}
      {box("onlyProblems", "Only problems")}
      {box("hideApproved", "Hide approved")}
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
