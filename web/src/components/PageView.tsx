import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
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
}

/** One PDF page on a canvas with an SVG overlay in displayed page points. */
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [rendering, setRendering] = useState(true);
  const cssW = widthPt * zoom;
  const cssH = heightPt * zoom;

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setRendering(true);
    void pdf.getPage(pageIndex + 1).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, canvas });
      task.promise.then(
        () => !cancelled && setRendering(false),
        () => undefined, // a cancelled render rejects; the next render replaces it
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageIndex, zoom]);

  const toPage = (e: React.PointerEvent): Pt => {
    const rect = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return clientToPage(e.clientX, e.clientY, rect, widthPt, heightPt);
  };

  return (
    <div
      className="page-wrap"
      style={{ width: cssW, height: cssH, cursor: cursor ?? "default" }}
      data-testid="page-wrap"
    >
      <canvas
        ref={canvasRef}
        className={dimPlan ? "page-canvas dim" : "page-canvas"}
        style={{ width: cssW, height: cssH }}
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
      {rendering && <div className="page-loading">rendering...</div>}
    </div>
  );
};
