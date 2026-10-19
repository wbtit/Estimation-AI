// Zoom and pan of the canvas (Phase 11c). The page sits in a scrolling viewport at an offset (the
// page margins); a view is the zoom and the viewport's scroll offsets. Pure.
import type { Box, Pt2 } from "./lf";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
/** Wheel zoom speed: a wheel notch (deltaY 100 px) zooms by e^0.2 = 1.22. */
export const WHEEL_ZOOM_K = 0.002;
/** Lines and pages of a wheel event (deltaMode 1, 2) in pixels. */
const DELTA_PX = [1, 16, 800];

export interface View {
  zoom: number;
  /** Scroll offsets of the viewport in CSS pixels. */
  left: number;
  top: number;
}

export interface Offset {
  x: number;
  y: number;
}

export const clampZoom = (z: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** The page point under a point of the viewport (CSS pixels from its top-left corner). */
export function pageAt(v: View, at: Pt2, off: Offset): Pt2 {
  return [(v.left + at[0] - off.x) / v.zoom, (v.top + at[1] - off.y) / v.zoom];
}

/** Zoom to `zoom` (clamped) keeping the page point under `at` where it is. */
export function zoomAround(v: View, zoom: number, at: Pt2, off: Offset): View {
  const z = clampZoom(zoom);
  const [x, y] = pageAt(v, at, off);
  return { zoom: z, left: x * z + off.x - at[0], top: y * z + off.y - at[1] };
}

/** The zoom factor of a wheel event (ctrl + wheel, or a trackpad pinch, which browsers send as
 * ctrl + wheel with small deltas). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  return Math.exp(-deltaY * (DELTA_PX[deltaMode] ?? 1) * WHEEL_ZOOM_K);
}

/** The zoom anchor of a wheel event, in CSS px from the page area's corner: the pointer, moved to
 * the nearest point of the area when it is over the toolbar or the bar above the canvas. */
export function anchorIn(
  r: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Pt2 {
  return [
    Math.min(Math.max(clientX - r.left, 0), r.width),
    Math.min(Math.max(clientY - r.top, 0), r.height),
  ];
}

/** Pixels a wheel event scrolls (plain wheel: vertical; shift + wheel: horizontal). */
export function wheelPan(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
}): { dx: number; dy: number } {
  const k = DELTA_PX[e.deltaMode] ?? 1;
  if (e.shiftKey) return { dx: (e.deltaY || e.deltaX) * k, dy: 0 };
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/** The view that shows a box (a member) with context around it: the box grown to at least
 * `minSide` page points and padded by `pad` CSS pixels, centred, never zoomed past `maxZoom`. */
export function viewOfBox(
  box: Box,
  size: { w: number; h: number },
  off: Offset,
  minSide = 240,
  pad = 80,
  maxZoom = 4,
): View {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const bw = Math.max(box.x1 - box.x0, minSide);
  const bh = Math.max(box.y1 - box.y0, minSide);
  const z = clampZoom(
    Math.min(
      maxZoom,
      Math.max(1, size.w - 2 * pad) / bw,
      Math.max(1, size.h - 2 * pad) / bh,
    ),
  );
  return {
    zoom: z,
    left: cx * z + off.x - size.w / 2,
    top: cy * z + off.y - size.h / 2,
  };
}

/** Parse the zoom box: "150", "150%" or "1.5x" -> 1.5; null when it is not a number. */
export function parseZoom(text: string): number | null {
  const t = text.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(%|x)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  if (!isFinite(v) || v <= 0) return null;
  return clampZoom(m[2] === "x" ? v : v / 100);
}
