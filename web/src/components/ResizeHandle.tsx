import React, { useRef, useState } from "react";

/** The drag handle between a side panel and the canvas: drag to resize (the canvas starts where the
 * panel ends), arrow keys resize by 16 px (Shift: 64), double-click resets to the default.
 *   side "right": the handle is on the RIGHT edge of a left panel (dragging right widens it)
 *   side "left":  the handle is on the LEFT edge of a right panel (dragging left widens it) */
export const ResizeHandle: React.FC<{
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  label: string;
  /** during a drag / key press: the new width (not yet remembered) */
  onChange: (w: number) => void;
  /** the drag ended or a key was released: remember this width */
  onCommit: (w: number) => void;
  onReset: () => void;
}> = ({ side, width, min, max, label, onChange, onCommit, onReset }) => {
  const [active, setActive] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);
  last.current = width;
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const sign = side === "right" ? 1 : -1;
  return (
    <div
      className={`resize-handle${active ? " active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, w: last.current };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onChange(clamp(d.w + sign * (e.clientX - d.x)));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const d = drag.current;
        drag.current = null;
        setActive(false);
        onCommit(clamp(d.w + sign * (e.clientX - d.x)));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        let next: number | null = null;
        if (e.key === "ArrowRight") next = last.current + sign * step;
        else if (e.key === "ArrowLeft") next = last.current - sign * step;
        else if (e.key === "Home") next = min;
        else if (e.key === "End") next = max;
        else if (e.key === "Enter") return onReset();
        if (next === null) return;
        e.preventDefault();
        const w = clamp(next);
        onChange(w);
        onCommit(w);
      }}
    />
  );
};
