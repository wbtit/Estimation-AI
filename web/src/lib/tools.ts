// The canvas tools, their keys and the pan state (Phase 11c polish round). Pure, so the hand tool and
// the temporary hand (Space held) are unit-tested.

export type Tool =
  | "select"
  | "hand"
  | "crop"
  | "pick"
  | "exclude"
  | "view"
  | "editBox"
  | "beam"
  | "column"
  | "measure";

/** One key per tool (no modifier), shown in the tooltips and the shortcut sheet. */
export const TOOL_KEYS: Partial<Record<Tool, string>> = {
  select: "V",
  hand: "H",
  crop: "C",
  pick: "P",
  exclude: "X",
  beam: "B",
  column: "K",
  measure: "M",
};

/** Everything the shortcut sheet ("?") lists, in order. */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "V", what: "Select" },
  { keys: "H", what: "Hand (drag to pan)" },
  { keys: "Space (hold)", what: "Hand while held, in any tool" },
  { keys: "C", what: "Crop the active view" },
  { keys: "P", what: "Pick beam" },
  { keys: "X", what: "Exclude area" },
  { keys: "B", what: "Draw beam" },
  { keys: "K", what: "Draw column" },
  { keys: "M", what: "Measure" },
  { keys: "N / Shift+N", what: "Next / previous issue" },
  { keys: "A", what: "Approve the selected members" },
  { keys: "Ctrl+Z", what: "Undo" },
  {
    keys: "Delete",
    what: "Delete the selection (or the selected exclude box)",
  },
  { keys: "Esc", what: "Cancel what is being drawn, back to Select" },
  { keys: "Wheel / Shift+wheel", what: "Pan up-down / left-right" },
  { keys: "Ctrl+wheel, pinch", what: "Zoom at the pointer" },
  { keys: "Middle drag", what: "Pan" },
  { keys: "?", what: "This sheet" },
];

/** The tool a plain key picks, or null (a modifier, or not a tool key). */
export function toolForKey(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): Tool | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  const k = key.toUpperCase();
  for (const [tool, letter] of Object.entries(TOOL_KEYS))
    if (letter === k) return tool as Tool;
  return null;
}

/** The tool in effect: Space held turns any tool into the hand until it is released. */
export function effectiveTool(tool: Tool, spaceHeld: boolean): Tool {
  return spaceHeld ? "hand" : tool;
}

/** Does a pointer press start a pan? The middle (and right) button always; the left button with
 * the hand tool or while Space is held. */
export function pressPans(
  button: number,
  tool: Tool,
  spaceHeld: boolean,
): boolean {
  if (button === 1 || button === 2) return true;
  return button === 0 && effectiveTool(tool, spaceHeld) === "hand";
}

/** The canvas cursor: grabbing while panning, grab for the hand, an arrow for Select, a cross for
 * the drawing tools. */
export function cursorFor(
  tool: Tool,
  spaceHeld: boolean,
  panning: boolean,
): string {
  if (panning) return "grabbing";
  const t = effectiveTool(tool, spaceHeld);
  if (t === "hand") return "grab";
  if (t === "select" || t === "editBox") return "default";
  return "crosshair";
}

/** A tooltip with its key: "Hand (H)". */
export function tipOf(label: string, tool?: Tool): string {
  const k = tool ? TOOL_KEYS[tool] : undefined;
  return k ? `${label} (${k})` : label;
}

// ---- Edit box: the handles of a view's box --------------------------------------------------------
export type BoxHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where each handle sits on a box. */
export function handlePoints(b: Box4): Record<BoxHandle, [number, number]> {
  const mx = (b.x0 + b.x1) / 2;
  const my = (b.y0 + b.y1) / 2;
  return {
    nw: [b.x0, b.y0],
    n: [mx, b.y0],
    ne: [b.x1, b.y0],
    e: [b.x1, my],
    se: [b.x1, b.y1],
    s: [mx, b.y1],
    sw: [b.x0, b.y1],
    w: [b.x0, my],
  };
}

/** The handle within `tol` page points of a point (corners first), or null. */
export function handleAt(
  b: Box4,
  p: [number, number],
  tol: number,
): BoxHandle | null {
  const pts = handlePoints(b);
  const order: BoxHandle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];
  for (const h of order) {
    const q = pts[h];
    if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) return h;
  }
  return null;
}

/** The box after dragging a handle by (dx, dy) page points, kept at least `min` wide and tall and
 * inside the page. */
export function dragHandle(
  start: Box4,
  h: BoxHandle,
  dx: number,
  dy: number,
  page: { w: number; h: number },
  min = 10,
): Box4 {
  const b = { ...start };
  if (h.includes("w"))
    b.x0 = Math.max(0, Math.min(start.x0 + dx, start.x1 - min));
  if (h.includes("e"))
    b.x1 = Math.min(page.w, Math.max(start.x1 + dx, start.x0 + min));
  if (h.includes("n"))
    b.y0 = Math.max(0, Math.min(start.y0 + dy, start.y1 - min));
  if (h.includes("s"))
    b.y1 = Math.min(page.h, Math.max(start.y1 + dy, start.y0 + min));
  return b;
}

/** The cursor over a handle. */
export const HANDLE_CURSOR: Record<BoxHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};
