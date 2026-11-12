import {
  loadPaletteChoice,
  markerSizePt,
  pieceSymbol,
  savePaletteChoice,
  STUD_KIND,
  symbolPath,
  type PaletteChoice,
  type SymbolFamily,
} from "../lib/columns";
import { ColumnPalette } from "./ColumnPalette";
import { SimilarMatches, type SimilarOverlay } from "./SimilarMatches";
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
import { ANGLE_OFFSET_PX, sideNormal } from "../lib/perimeter-angle";
import { snapPoint } from "../lib/snap";
import {
  boxAround,
  captureHit,
  dragCapture,
  tightBox,
  type CaptureBox,
  type CaptureDrag,
} from "../lib/capture";
import {
  glyphCentre,
  markerRotation,
  orientationFromRotation,
  ownSymbolSize,
  periodOf,
  probeBox,
  readOrientation,
  refineCentre,
  snapOrientation,
} from "../lib/orientation";
import { crossings, offGrid } from "../lib/grid-cross";
import {
  nearestSymbol,
  squareMarginPt,
  nudgeStep,
  placeColumn,
  type ColumnSymbol,
  type ColumnSymbols,
  type SnapSource,
} from "../lib/column-snap";
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

/** Phase 14b: a column drawn with the palette. */
export interface DrawOptions {
  symbol?: SymbolFamily;
  rotation_deg?: number;
  profile_text?: string | null;
  /** Phase 0-14g: the snapped symbol's real size [short, long] in inches (the marker's size
   * when the column has no section) and how the click was snapped (logged by the API) */
  real_in?: [number, number];
  snap?: {
    source: SnapSource;
    distance?: number;
    snapped: boolean;
    /** the centre was refined to the symbol's own centre by this many real inches */
    refined_in?: number;
  };
  /** Phase 0-column-capture: the orientation read at the click (web direction, ccw from +X, displayed
   * frame; see lib/orientation.ts) with its state, and the click-to-marker time in ms (logged) */
  orientation_deg?: number | null;
  orientation_state?: "clear" | "unsure" | "none";
  timing?: { click_to_marker_ms?: number };
}

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
  /** Confirm the view's pens as they are (a suggested pen that is already right). */
  onConfirmPen?: () => void;
  /** The view's pen is still the system's suggestion (no person confirmed it). */
  penNeedsConfirm?: boolean;
  onDraw: (
    kind: "Beams" | "Column" | "Stud/Post",
    a: Pt2,
    b: Pt2 | null,
    opts?: DrawOptions,
  ) => void;
  /** Phase 14b: who works (the palette remembers their last symbol). */
  who?: string;
  onEnds: (piece: Piece, a: Pt2, b: Pt2 | null) => void;
  onUndo: () => void;
  onDeleteSelected: () => void;
  /** Drawing visibility 0..1 (1 = darkest) and its change (the Layers slider). */
  drawing?: number;
  onDrawing?: (v: number) => void;
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
  /** Phase 14e: the Find similar preview's matches (ticked / unticked), drawn over the page. */
  similar?: SimilarOverlay | null;
  /** Phase 0-14g: the page's column symbols (the Draw column snap targets) and THE snap radius */
  symbols?: ColumnSymbols | null;
  /** Phase 0-14g: the column an arrow key nudges (the one just placed, before Find similar) */
  nudgeId?: string | null;
  onNudge?: (id: string, dx: number, dy: number) => void;
  /** the Draw column tool was picked: refresh the page's symbols */
  onColumnTool?: () => void;
  /** Phase 0-column-capture: the column just placed (the capture box and the rotate handle belong to
   * it), the capture box shown for Find similar (page points) and its changes (true = a person
   * dragged it), and the rotation of columns: turn clockwise by rotate_deg, or set the web direction */
  lastColumn?: string | null;
  capture?: { box: CaptureBox; edited: boolean } | null;
  onCapture?: (box: CaptureBox, edited: boolean) => void;
  onRotate?: (
    ids: string[],
    by: { rotate_deg?: number; orientation_deg?: number },
  ) => void;
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

/** Phase 14f: the tooltip of a tag another piece of the job also has (the tag is drawn red). */
const DUPLICATE_TAG = "duplicate tag";

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
  // Phase 14b: the column palette (symbol, Stud/Post, size typed, rotation)
  const [palette, setPaletteState] = useState<PaletteChoice>(() =>
    loadPaletteChoice(props.who ?? ""),
  );
  const setPalette = (c: PaletteChoice) => {
    setPaletteState(c);
    savePaletteChoice(props.who ?? "", c);
  };
  const [colSize, setColSize] = useState("");
  const [colRotation, setColRotation] = useState(0);
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
  // Phase 0-14g: the stored symbol a Draw column click would land on (highlighted)
  const [hoverSym, setHoverSym] = useState<ColumnSymbol | null>(null);
  // Phase 0-column-capture: the marker shown at once at the click (before the server answers), the
  // capture-box drag, and the rotate-handle drag
  const [ghost, setGhost] = useState<{
    at: Pt2;
    rotation: number;
    state: "clear" | "unsure" | "none";
    family: SymbolFamily;
    sizePt: [number, number] | null;
  } | null>(null);
  const capDrag = useRef<{
    how: CaptureDrag;
    from: Pt2;
    start: CaptureBox;
  } | null>(null);
  const [rotDrag, setRotDrag] = useState<{
    id: string;
    deg: number;
    at: Pt2;
  } | null>(null);
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
  // the server's piece replaces the ghost marker
  useEffect(() => {
    setGhost(null);
  }, [data]);
  // Phase 0-14g: the column tool asks for the page's current symbols (a Build may have changed them)
  const { onColumnTool } = props;
  useEffect(() => {
    if (tool === "column") onColumnTool?.();
  }, [tool, onColumnTool]);

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
        // (while a Find similar preview is open, A accepts it: the bar handles the key)
        if (props.similar) return;
        if (selected.size > 0) props.onApprove?.();
        return;
      }
      if (
        props.nudgeId &&
        props.onNudge &&
        e.key.startsWith("Arrow") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const k = nudgeStep(e.shiftKey);
        const [dx, dy] =
          e.key === "ArrowLeft"
            ? [-k, 0]
            : e.key === "ArrowRight"
              ? [k, 0]
              : e.key === "ArrowUp"
                ? [0, -k]
                : [0, k];
        e.preventDefault();
        props.onNudge(props.nudgeId, dx, dy);
        return;
      }
      if (
        (e.key === "r" || e.key === "R") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        // Phase 0-column-capture: R turns the selected columns (or the column just placed) 90
        // degrees, Shift+R 15 degrees; one recorded, undoable action. Nothing selected and no
        // column just placed: R is the palette's rotation for the next column, as before.
        const ids = rotateTargets();
        if (ids.length > 0 && props.onRotate) {
          props.onRotate(ids, { rotate_deg: e.shiftKey ? 15 : 90 });
          return;
        }
        if (tool === "column" && !e.shiftKey) {
          setColRotation((r) => (r + 90) % 360);
          return;
        }
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
  }, [selected, props, step, exclusionOn, help, cancel, tool]);

  // Phase 0-column-capture: the page's grid directions (degrees ccw), the columns R turns and the
  // rotate handle of a single column
  const gridAngles = useMemo(
    () =>
      (data?.grid_lines ?? []).map(
        (g) =>
          ((((Math.atan2(-(g.b[1] - g.a[1]), g.b[0] - g.a[0]) * 180) /
            Math.PI) %
            180) +
            180) %
          180,
      ),
    [data],
  );
  const gridCross = useMemo(() => crossings(data?.grid_lines ?? []), [data]);
  const rotateTargets = (): string[] => {
    const cols = pieces
      .filter((q) => selected.has(q.id) && q.type === "column" && !q.deleted)
      .map((q) => q.id);
    if (cols.length > 0) return cols;
    return props.lastColumn && pieces.some((q) => q.id === props.lastColumn)
      ? [props.lastColumn]
      : [];
  };
  const rotateHandle = (): { id: string; at: Pt2; deg: number } | null => {
    const ids = rotateTargets();
    if (ids.length !== 1) return null;
    const pc = pieces.find((q) => q.id === ids[0]);
    if (!pc?.a || periodOf(pc.symbol ?? "w_shape") === null) return null;
    const deg =
      pc.orientation_deg ?? orientationFromRotation(pc.rotation_deg ?? 0);
    const r = 18 * px;
    return {
      id: pc.id,
      deg,
      at: [
        pc.a[0] + Math.cos((deg * Math.PI) / 180) * r,
        pc.a[1] - Math.sin((deg * Math.PI) / 180) * r,
      ],
    };
  };
  const snap = (p: Pt2): Pt2 => {
    if (!lines) return p;
    const hit = snapPoint(lines.lines, p[0], p[1], SNAP_PX * px);
    return hit ? [hit.x, hit.y] : p;
  };

  const preview = useMemo(
    () => (tool === "pick" ? penPreview(lines, pens, crop, view) : []),
    [tool, lines, pens, crop, view],
  );

  // a perimeter angle's ends are its beam's: no end handles on it
  const single =
    selected.size === 1
      ? (pieces.find((p) => selected.has(p.id) && !p.parent_member_id) ?? null)
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
    // Phase 0-column-capture: the rotate handle and the capture box take the pointer first
    if (tool === "select" || tool === "column") {
      const rh = rotateHandle();
      if (rh && Math.hypot(rh.at[0] - p[0], rh.at[1] - p[1]) <= 7 * px) {
        setRotDrag({ id: rh.id, deg: rh.deg, at: p });
        return true;
      }
      if (props.capture) {
        const how = captureHit(props.capture.box, p, 7 * px);
        if (how) {
          capDrag.current = { how, from: p, start: props.capture.box };
          return true;
        }
      }
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
      // Phase 0-14g: land on the symbol under the cursor (its centre, its own angle and size);
      // no symbol near: the line / grid snap; Shift: the click as it is
      const t0 = performance.now();
      const pl = placeColumn({
        p,
        symbols: props.symbols?.symbols ?? [],
        radius: props.symbols?.snap_radius_pt ?? null,
        squareMargin: squareMarginPt(props.symbols?.square_margin_in, ratio),
        shift: e.shiftKey,
        line: (q) => {
          if (!lines) return null;
          const hit = snapPoint(lines.lines, q[0], q[1], SNAP_PX * px);
          return hit ? [hit.x, hit.y] : null;
        },
      });
      // Phase 0-column-capture: read the column symbol's orientation from the page's own lines, in a
      // window of the column family (never from a plate / pier around it), and show the marker at once
      const known =
        pl.symbol && pl.symbol.family !== "unknown" ? pl.symbol.family : null;
      const family = known ?? palette.family;
      const k = ratio ? 72 / ratio : null;
      // the reading window: a family-sized square around the snapped centre (never the box of a
      // neighbouring symbol, never a plate / pier around the column)
      const probe = ratio ? probeBox(pl.at, ratio) : null;
      let reading: ReturnType<typeof readOrientation> | null = null;
      if (!palette.stud && probe && ratio && lines) {
        reading = readOrientation({
          lines: lines.lines,
          box: probe as [number, number, number, number],
          family,
          ratio,
          // the column's OWN stored symbol only (its family, within 5 in): never a neighbour's size
          sizeIn: ownSymbolSize(
            props.symbols?.symbols ?? [],
            pl.at,
            family,
            ratio,
          ),
          grid: gridAngles,
        });
      }
      // the centre refined to the column symbol's own centre (the middle of its strokes) when it is
      // 2.5 to 5 in off; never with Shift, never when the reading is not clear; never snapped to a grid
      const refined =
        !e.shiftKey && reading?.state === "clear" && ratio
          ? refineCentre(pl.at, glyphCentre(reading), ratio)
          : { centre: pl.at, moved: false, offsetIn: 0 };
      const at = refined.centre;
      // the tight box: the stored symbol's own box, else the column symbol's own lines
      const captureBox: CaptureBox = pl.symbol
        ? tightBox(pl.symbol.box)
        : reading?.box
          ? tightBox(reading.box)
          : boxAround(pl.at, 12 * (k ?? 0.375));
      let orientation: number | null | undefined = reading?.deg;
      let ostate: "clear" | "unsure" | "none" = reading?.state ?? "unsure";
      if (palette.stud) {
        orientation = undefined;
      } else if (colRotation !== 0) {
        // a rotation the person set with R before the click is theirs: it replaces the reading
        const pr = periodOf(family) ?? 180;
        orientation = orientationFromRotation(colRotation + pl.turn) % pr;
        ostate = "unsure";
      }
      const rotation =
        orientation !== undefined && orientation !== null
          ? markerRotation(orientation)
          : (((colRotation + pl.turn) % 180) + 180) % 180;
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      setGhost({
        at,
        rotation,
        state:
          orientation === null || orientation === undefined ? "unsure" : ostate,
        family: family as SymbolFamily,
        sizePt:
          pl.symbol && k
            ? [pl.symbol.real_in[0] * k, pl.symbol.real_in[1] * k]
            : null,
      });
      props.onCapture?.(captureBox, false);
      props.onDraw(palette.stud ? STUD_KIND : "Column", at, null, {
        symbol: palette.family,
        rotation_deg: rotation,
        profile_text: colSize.trim() || null,
        ...(pl.symbol ? { real_in: pl.symbol.real_in } : {}),
        ...(orientation !== undefined
          ? { orientation_deg: orientation, orientation_state: ostate }
          : {}),
        timing: { click_to_marker_ms: ms },
        snap: {
          source: pl.source,
          snapped: pl.snapped,
          ...(refined.moved
            ? { refined_in: Math.round(refined.offsetIn * 10) / 10 }
            : {}),
          ...(pl.distance === null
            ? {}
            : { distance: Math.round(pl.distance * 100) / 100 }),
        },
      });
      setHoverSym(null);
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
    if (capDrag.current) {
      const d = capDrag.current;
      props.onCapture?.(
        dragCapture(d.start, d.how, p[0] - d.from[0], p[1] - d.from[1], {
          w,
          h,
        }),
        true,
      );
      return;
    }
    if (rotDrag) {
      const pc = pieces.find((q) => q.id === rotDrag.id);
      if (pc?.a) {
        let deg =
          ((Math.atan2(-(p[1] - pc.a[1]), p[0] - pc.a[0]) * 180) / Math.PI +
            360) %
          360;
        deg = deg % (periodOf(pc.symbol ?? "w_shape") ?? 180);
        // snaps to 0 / 90 / 45 and the grid directions within 3 degrees; Shift = free
        deg = e.shiftKey
          ? Math.round(deg)
          : snapOrientation(deg, pc.symbol ?? "w_shape", gridAngles);
        setRotDrag({ ...rotDrag, deg, at: p });
      }
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
    if (tool === "column") {
      const r = props.symbols?.snap_radius_pt;
      const near =
        e.shiftKey || r === undefined
          ? null
          : nearestSymbol(
              props.symbols?.symbols ?? [],
              p,
              r,
              squareMarginPt(props.symbols?.square_margin_in, ratio),
            );
      setHoverSym((cur) =>
        cur === (near?.symbol ?? null) ? cur : (near?.symbol ?? null),
      );
    } else if (hoverSym) setHoverSym(null);
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
    if (capDrag.current) {
      capDrag.current = null;
      return;
    }
    if (rotDrag) {
      const r = rotDrag;
      setRotDrag(null);
      props.onRotate?.([r.id], { orientation_deg: r.deg });
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
          {pens.length > 0 && props.penNeedsConfirm && (
            <button
              className="primary"
              data-testid="use-pen"
              title="The pen shown is only the system's suggestion: confirm it"
              onClick={() => props.onConfirmPen?.()}
            >
              Use this pen
            </button>
          )}
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
      {tool === "column" && (
        <ColumnPalette
          choice={palette}
          onChoice={setPalette}
          size={colSize}
          onSize={setColSize}
          rotation={colRotation}
        />
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
              drawing={props.drawing ?? 1}
              onDrawing={props.onDrawing}
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
            drawing={props.drawing ?? 1}
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
                  offGrid={
                    p.type === "column" && p.a && ratio
                      ? offGrid(p.a, gridCross, ratio)
                      : false
                  }
                  labels={layers.labels}
                  allSizes={layers.allSizes}
                  flags={layers.flags}
                />
              ))}
            {props.similar && (
              <SimilarMatches overlay={props.similar} px={px} />
            )}
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
            {tool === "column" && hoverSym && (
              <g data-testid="symbol-highlight" pointerEvents="none">
                {hoverSym.family === "hss_round" ||
                hoverSym.solid === "round" ? (
                  <ellipse
                    cx={hoverSym.centre[0]}
                    cy={hoverSym.centre[1]}
                    rx={(hoverSym.box[2] - hoverSym.box[0]) / 2 + 1 * px}
                    ry={(hoverSym.box[3] - hoverSym.box[1]) / 2 + 1 * px}
                    fill="rgba(255,145,0,0.12)"
                    stroke="var(--amber, #ff9100)"
                    strokeWidth={2 * px}
                  />
                ) : (
                  <rect
                    x={hoverSym.box[0] - 1 * px}
                    y={hoverSym.box[1] - 1 * px}
                    width={hoverSym.box[2] - hoverSym.box[0] + 2 * px}
                    height={hoverSym.box[3] - hoverSym.box[1] + 2 * px}
                    fill="rgba(255,145,0,0.12)"
                    stroke="var(--amber, #ff9100)"
                    strokeWidth={2 * px}
                  />
                )}
                <path
                  d={`M ${hoverSym.centre[0] - 3 * px} ${hoverSym.centre[1]} H ${hoverSym.centre[0] + 3 * px} M ${hoverSym.centre[0]} ${hoverSym.centre[1] - 3 * px} V ${hoverSym.centre[1] + 3 * px}`}
                  stroke="var(--amber, #ff9100)"
                  strokeWidth={1.5 * px}
                />
              </g>
            )}
            {props.capture && (
              <g data-testid="capture-box" pointerEvents="none">
                <rect
                  x={props.capture.box.x0}
                  y={props.capture.box.y0}
                  width={props.capture.box.x1 - props.capture.box.x0}
                  height={props.capture.box.y1 - props.capture.box.y0}
                  fill="rgba(255,145,0,0.10)"
                  stroke="var(--amber, #ff9100)"
                  strokeWidth={2 * px}
                  strokeDasharray={
                    props.capture.edited ? undefined : `${4 * px} ${2 * px}`
                  }
                />
                {Object.entries(handlePoints(props.capture.box)).map(
                  ([hk, [hx, hy]]) => (
                    <rect
                      key={hk}
                      data-handle={hk}
                      x={hx - 3.5 * px}
                      y={hy - 3.5 * px}
                      width={7 * px}
                      height={7 * px}
                      fill="#fff"
                      stroke="var(--amber, #ff9100)"
                      strokeWidth={1.5 * px}
                    />
                  ),
                )}
              </g>
            )}
            {ghost && (
              <g
                data-testid="ghost-marker"
                data-state={ghost.state}
                opacity={0.7}
                pointerEvents="none"
                transform={`translate(${ghost.at[0]} ${ghost.at[1]}) rotate(${ghost.rotation})`}
              >
                <path
                  d={symbolPath(
                    ghost.family,
                    ghost.sizePt ? ghost.sizePt[0] : COLUMN_PX * px,
                    ghost.sizePt ? ghost.sizePt[1] : COLUMN_PX * px,
                  )}
                  fill="none"
                  stroke="var(--column-id, #2979ff)"
                  strokeWidth={2 * px}
                />
                {ghost.family !== "hss_round" && (
                  <line
                    x1={0}
                    x2={0}
                    y1={-(COLUMN_PX * 0.9) * px}
                    y2={COLUMN_PX * 0.9 * px}
                    stroke={
                      ghost.state === "clear"
                        ? "var(--ok, #00c853)"
                        : "var(--amber, #ff9100)"
                    }
                    strokeWidth={2 * px}
                  />
                )}
              </g>
            )}
            {(() => {
              const rh = rotateHandle();
              if (!rh) return null;
              const pc = pieces.find((q) => q.id === rh.id)!;
              const at = rotDrag
                ? ([
                    pc.a![0] +
                      Math.cos((rotDrag.deg * Math.PI) / 180) * 18 * px,
                    pc.a![1] -
                      Math.sin((rotDrag.deg * Math.PI) / 180) * 18 * px,
                  ] as Pt2)
                : rh.at;
              return (
                <g data-testid="rotate-handle" pointerEvents="none">
                  <line
                    x1={pc.a![0]}
                    y1={pc.a![1]}
                    x2={at[0]}
                    y2={at[1]}
                    stroke="var(--select, #2563eb)"
                    strokeWidth={1.5 * px}
                  />
                  <circle
                    cx={at[0]}
                    cy={at[1]}
                    r={4.5 * px}
                    fill="#fff"
                    stroke="var(--select, #2563eb)"
                    strokeWidth={2 * px}
                  />
                  {rotDrag && (
                    <text
                      x={at[0] + 7 * px}
                      y={at[1] - 7 * px}
                      fontSize={11 * px}
                      fill="var(--select, #2563eb)"
                      stroke="#fff"
                      strokeWidth={3 * px}
                      paintOrder="stroke"
                    >
                      {Math.round(rotDrag.deg)}°
                    </text>
                  )}
                </g>
              );
            })()}
            {first && hover && (
              <line
                x1={first[0]}
                y1={first[1]}
                x2={hover[0]}
                y2={hover[1]}
                stroke={tool === "beam" ? "var(--beam)" : "#111"}
                strokeWidth={2 * px}
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

/** An exclude area: accepted = grey hatched box; suggested = orange box marked "suggested". */
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
 * undefined beams are solid red with a "?" badge at the middle (Phase 12a); a column is an I of COLUMN_PX on
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
  /** Phase 0: a column more than 2 in from every grid crossing of a page that has a grid (amber). */
  offGrid?: boolean;
}> = ({
  p,
  px,
  on,
  hover = false,
  labels,
  allSizes = false,
  flags = false,
  offGrid: off = false,
}) => {
  if (!p.a) return null;
  const tip = [
    `${p.tag ?? ""} ${p.profile ?? "no size"}`.trim(),
    p.duplicate_tag ? DUPLICATE_TAG : "",
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
    // Phase 14b: the column's symbol (from its profile, else the drawn family), rotated like the
    // drawing and sized from the real section; an unknown column is a neutral amber marker
    const fam = pieceSymbol(p);
    const real = markerSizePt(p);
    const least = COLUMN_PX * 0.6 * px; // never smaller than this on screen
    const [sw0, sh0] = real
      ? [Math.max(real[0], least), Math.max(real[1], least)]
      : [COLUMN_PX * px, COLUMN_PX * px];
    const t = Math.max(sw0, sh0) / 2;
    const cw = Math.min(swPx, 2.5) * px * (real ? 0.6 : 1);
    const rot = p.rotation_deg ?? 0;
    const shape = fam
      ? symbolPath(fam, sw0, sh0)
      : `M ${-t} ${-t} L ${t} ${t} M ${-t} ${t} L ${t} ${-t} M ${-t} ${-t} H ${t} V ${t} H ${-t} Z`;
    const I = shape;
    const markColourOf = p.symbol_flag
      ? "var(--attention)"
      : !fam
        ? "var(--amber)"
        : p.kind === STUD_KIND
          ? "var(--stud)"
          : colour;
    const tf = `translate(${p.a[0]} ${p.a[1]}) rotate(${rot})`;
    const showTag = labels && p.tag && (allSizes || wide);
    return (
      <g
        data-testid={`piece-${p.tag ?? p.id}`}
        data-state={state}
        data-glow={glow ? "1" : undefined}
        data-flag={flag ?? undefined}
        data-reference={p.reference ? "1" : undefined}
        opacity={p.reference ? 0.55 : undefined}
      >
        <title>
          {[
            p.symbol_flag ? `${tip}\n${p.symbol_flag}` : tip,
            p.reference
              ? "Reference: counted on the column plan (tick Count this column to count it here)"
              : "",
          ]
            .filter(Boolean)
            .join("\n")}
        </title>
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
          transform={tf}
          data-testid="column-symbol"
          data-symbol={fam ?? "unknown"}
          stroke="#fff"
          strokeWidth={cw + 2 * px}
          fill="none"
          strokeLinecap="square"
        />
        <path
          d={I}
          transform={tf}
          stroke={markColourOf}
          strokeWidth={wide ? cw + 1 * px : cw}
          fill="none"
          strokeLinecap="square"
        />
        {off && (
          // Phase 0: more than 2 in from every grid crossing of a page that has a grid (never moved)
          <circle
            data-testid="off-grid"
            cx={p.a[0]}
            cy={p.a[1]}
            r={t * 1.45}
            fill="none"
            stroke="var(--amber, #ff9100)"
            strokeWidth={1.5 * px}
            strokeDasharray={`${3 * px} ${2 * px}`}
          >
            <title>Off the grid crossing by more than 2 in</title>
          </circle>
        )}
        {fam !== "hss_round" && p.kind !== STUD_KIND && (
          // Phase 0-column-capture: the web direction, green when read clearly (or set by a person),
          // amber when unsure or not read yet (a column from before the orientation was stored)
          <line
            data-testid="orientation-tick"
            data-state={p.orientation_state ?? "legacy"}
            transform={tf}
            x1={0}
            x2={0}
            y1={-t * 1.55}
            y2={t * 1.55}
            stroke={
              p.orientation_state === "clear" ||
              p.orientation_state === "manual"
                ? "var(--ok, #00c853)"
                : "var(--amber, #ff9100)"
            }
            strokeWidth={Math.max(1.5, swPx * 0.8) * px}
            strokeLinecap="round"
          />
        )}
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
            fill={p.duplicate_tag ? "var(--attention)" : "var(--column-id)"}
            stroke="#fff"
            strokeWidth={3 * px}
            paintOrder="stroke"
            pointerEvents={p.duplicate_tag ? "auto" : "none"}
            data-duplicate={p.duplicate_tag ? "true" : undefined}
          >
            {p.duplicate_tag && <title>{DUPLICATE_TAG}</title>}
            {p.tag}
          </text>
        )}
        {flag && <FlagMark at={mid} px={px} colour={flag} />}
      </g>
    );
  }
  if (p.parent_member_id && p.b) {
    // Phase 0 perimeter angle: a thin line of its own colour beside its beam, on the slab-edge side
    const [nx, ny] = sideNormal(p.a, p.b, p.slab_edge_side ?? null);
    const o = ANGLE_OFFSET_PX * px;
    const aseg = {
      x1: p.a[0] + nx * o,
      y1: p.a[1] + ny * o,
      x2: p.b[0] + nx * o,
      y2: p.b[1] + ny * o,
    };
    const aw = (wide ? 3 : 2) * px;
    const atip = [
      `Perimeter angle ${p.tag ?? ""} ${p.profile ?? "no size"}`.trim(),
      p.length_mm !== null ? formatFtIn(p.length_mm) : "",
      p.parent_tag ? `on beam ${p.parent_tag}` : "",
      p.slab_edge_side ? `slab edge: ${p.slab_edge_side} of the beam` : "",
      p.vertical_leg ? `vertical leg: ${p.vertical_leg}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <g
        data-testid={`angle-${p.tag ?? p.id}`}
        data-angle="1"
        data-state={state}
      >
        <title>{atip}</title>
        {on && (
          <line
            {...aseg}
            stroke="var(--select)"
            strokeWidth={aw + 4 * px}
            strokeOpacity={0.7}
            strokeLinecap="round"
          />
        )}
        <line {...aseg} stroke="#fff" strokeWidth={aw + 1.5 * px} />
        <line {...aseg} stroke="var(--angle)" strokeWidth={aw} />
        <line {...aseg} stroke="transparent" strokeWidth={8 * px} />
      </g>
    );
  }
  const seg = { x1: p.a[0], y1: p.a[1], x2: p.b![0], y2: p.b![1] };
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
      <line {...seg} stroke={colour} strokeWidth={sw} strokeLinecap="round" />
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
      {isUndefinedBeam(p) && !p.ignored && <UndefinedBadge at={mid} px={px} />}
      {flag && <FlagMark at={mid} px={px} colour={flag} />}
    </g>
  );
};

/** The "?" badge at the middle of a beam without a size (Phase 12a: never a dashed line). */
const UndefinedBadge: React.FC<{ at: Pt2; px: number }> = ({ at, px }) => (
  <g pointerEvents="none" data-testid="undefined-badge">
    <circle
      cx={at[0]}
      cy={at[1]}
      r={6 * px}
      fill="#fff"
      stroke="var(--attention)"
      strokeWidth={1.5 * px}
    />
    <text
      x={at[0]}
      y={at[1] + 3.5 * px}
      fontSize={9.5 * px}
      fontWeight={700}
      textAnchor="middle"
      fill="var(--attention)"
    >
      ?
    </text>
  </g>
);

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
  drawing: number;
  onDrawing?: (v: number) => void;
}> = ({ layers, onChange, drawing, onDrawing }) => {
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
        <span title="100% = the drawing at its darkest, 0% = faded out">
          Drawing
        </span>
        <input
          type="range"
          aria-label="drawing visibility"
          min={0}
          max={100}
          step={5}
          value={Math.round(drawing * 100)}
          onChange={(e) => onDrawing?.(Number(e.target.value) / 100)}
        />
        <span className="muted">{Math.round(drawing * 100)}%</span>
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
