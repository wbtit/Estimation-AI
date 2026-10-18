import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { clientToPage, type Pt } from "../lib/geometry";

export interface PageViewProps {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  /** Displayed page size in points (rotation applied), from the scan. */
  widthPt: number;
  heightPt: number;
  zoom: number;
  /** SVG content in page points (viewBox is the page). */
  children?: React.ReactNode;
  /** Pointer events in page points. Return true to claim the pointer (draw tools). */
  onPointerDown?: (p: Pt, e: React.PointerEvent) => boolean | void;
  onPointerMove?: (p: Pt, e: React.PointerEvent) => void;
  onPointerUp?: (p: Pt, e: React.PointerEvent) => void;
  cursor?: string;
  /** Show the drawing faint (the "Plan" layer off). */
  dimPlan?: boolean;
  /** Drawing fade 0..1: the drawing is mixed toward white so the marks stand out. */
  fade?: number;
  /** The scrolling viewport: the sharp layer renders the part of the page it shows. */
  scroller?: React.RefObject<HTMLDivElement | null>;
}

/** Long side of the low-resolution full-page render, in device pixels. */
export const BASE_MAX_PX = 4096;
/** Wait this long after the last zoom or pan before rendering the sharp layer. */
export const SHARP_DELAY_MS = 200;
/** Render this much more than the visible area around it (a share of its size), for panning. */
const SHARP_MARGIN = 0.25;
/** The largest sharp canvas, in device pixels (browsers refuse much larger canvases). */
const SHARP_MAX_AREA = 4096 * 4096;

interface SharpRect {
  /** Page points covered by the sharp canvas. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One PDF page with an SVG overlay in displayed page points. Two canvases: underneath, the whole
 * page rendered once at low resolution (CSS-scaled, so panning and zooming never show a blank
 * area); on top, after zooming or panning stops, only the visible part rendered sharp at the
 * current zoom (no canvas is ever larger than the browser allows, even at 800%). */
export const PageView: React.FC<PageViewProps> = ({
  pdf,
  pageIndex,
  widthPt,
  heightPt,
  zoom,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursor,
  dimPlan,
  fade = 0,
  scroller,
}) => {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const sharpRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const [baseReady, setBaseReady] = useState(false);
  const [baseScale, setBaseScale] = useState(1);
  const [sharp, setSharp] = useState<SharpRect | null>(null);
  const [moved, setMoved] = useState(0);
  const cssW = widthPt * zoom;
  const cssH = heightPt * zoom;

  // the low-resolution full page: once per page
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setBaseReady(false);
    setSharp(null);
    pageRef.current = null;
    void pdf.getPage(pageIndex + 1).then((page) => {
      if (cancelled || !baseRef.current) return;
      pageRef.current = page;
      const one = page.getViewport({ scale: 1 });
      const scale = Math.min(BASE_MAX_PX / Math.max(one.width, one.height), 4);
      const viewport = page.getViewport({ scale });
      const canvas = baseRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      setBaseScale(scale);
      task = page.render({ canvasContext: ctx, viewport, canvas });
      task.promise.then(
        () => {
          if (cancelled) return;
          setBaseReady(true);
          setMoved((m) => m + 1);
        },
        () => undefined, // a cancelled render rejects
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageIndex]);

  // pans of the viewport ask for a new sharp render
  useEffect(() => {
    const el = scroller?.current;
    if (!el) return;
    const onScroll = () => setMoved((m) => m + 1);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scroller]);

  // the sharp visible part, after zooming or panning stops
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const timer = window.setTimeout(() => {
      const page = pageRef.current;
      const wrap = wrapRef.current;
      const out = sharpRef.current;
      if (!page || !wrap || !out) return;
      const dpr = window.devicePixelRatio || 1;
      if (zoom * dpr <= baseScale) {
        setSharp(null); // the full-page render is already sharp enough
        return;
      }
      const w = wrap.getBoundingClientRect();
      const s = scroller?.current?.getBoundingClientRect() ?? w;
      let x0 = Math.max(0, s.left - w.left);
      let y0 = Math.max(0, s.top - w.top);
      let x1 = Math.min(cssW, s.right - w.left);
      let y1 = Math.min(cssH, s.bottom - w.top);
      if (x1 <= x0 || y1 <= y0) return;
      const mx = (x1 - x0) * SHARP_MARGIN;
      const my = (y1 - y0) * SHARP_MARGIN;
      x0 = Math.max(0, x0 - mx);
      y0 = Math.max(0, y0 - my);
      x1 = Math.min(cssW, x1 + mx);
      y1 = Math.min(cssH, y1 + my);
      let k = dpr;
      const area = (x1 - x0) * (y1 - y0) * k * k;
      if (area > SHARP_MAX_AREA) k *= Math.sqrt(SHARP_MAX_AREA / area);
      const viewport = page.getViewport({
        scale: zoom * k,
        offsetX: -x0 * k,
        offsetY: -y0 * k,
      });
      // render off screen, then swap, so the old sharp part stays until the new one is ready
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.floor((x1 - x0) * k));
      off.height = Math.max(1, Math.floor((y1 - y0) * k));
      const ctx = off.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, canvas: off });
      task.promise.then(
        () => {
          if (cancelled) return;
          out.width = off.width;
          out.height = off.height;
          out.getContext("2d")?.drawImage(off, 0, 0);
          setSharp({
            x0: x0 / zoom,
            y0: y0 / zoom,
            x1: x1 / zoom,
            y1: y1 / zoom,
          });
        },
        () => undefined,
      );
    }, SHARP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [zoom, moved, baseScale, cssW, cssH, scroller]);

  const toPage = (e: React.PointerEvent): Pt => {
    const rect = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return clientToPage(e.clientX, e.clientY, rect, widthPt, heightPt);
  };
  const opacity = dimPlan ? 0.18 : 1 - Math.min(1, Math.max(0, fade));

  return (
    <div
      ref={wrapRef}
      className="page-wrap"
      style={{ width: cssW, height: cssH, cursor: cursor ?? "default" }}
      data-testid="page-wrap"
    >
      <canvas
        ref={baseRef}
        className="page-canvas"
        style={{ width: cssW, height: cssH, opacity }}
      />
      <canvas
        ref={sharpRef}
        className="page-canvas sharp"
        data-testid="sharp-layer"
        style={
          sharp
            ? {
                left: sharp.x0 * zoom,
                top: sharp.y0 * zoom,
                width: (sharp.x1 - sharp.x0) * zoom,
                height: (sharp.y1 - sharp.y0) * zoom,
                opacity,
              }
            : { display: "none" }
        }
      />
      <svg
        ref={svgRef}
        className="page-overlay"
        viewBox={`0 0 ${widthPt} ${heightPt}`}
        width={cssW}
        height={cssH}
        onPointerDown={(e) => {
          if (onPointerDown?.(toPage(e), e))
            (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => onPointerMove?.(toPage(e), e)}
        onPointerUp={(e) => onPointerUp?.(toPage(e), e)}
      >
        {children}
      </svg>
      {!baseReady && <div className="page-loading">rendering...</div>}
    </div>
  );
};
