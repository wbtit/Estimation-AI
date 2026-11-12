import { describe, expect, it } from "vitest";
import {
  anchorIn,
  clampZoom,
  freeSpan,
  pageAt,
  parseZoom,
  viewOfBox,
  wheelFactor,
  wheelPan,
  zoomAround,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./zoom";

const OFF = { x: 72, y: 16 };

describe("zoom maths", () => {
  it("zooming around a point keeps that point fixed", () => {
    const v = { zoom: 0.5, left: 120, top: 40 };
    for (const at of [
      [0, 0],
      [300, 200],
      [911, 433],
    ] as [number, number][]) {
      for (const z of [0.25, 1, 2.5, 8]) {
        const before = pageAt(v, at, OFF);
        const after = pageAt(zoomAround(v, z, at, OFF), at, OFF);
        expect(after[0]).toBeCloseTo(before[0], 9);
        expect(after[1]).toBeCloseTo(before[1], 9);
      }
    }
  });

  it("zooming in then out by the same factor comes back", () => {
    const v = { zoom: 1.3, left: 500, top: 250 };
    const at: [number, number] = [640, 360];
    const back = zoomAround(zoomAround(v, 2.6, at, OFF), 1.3, at, OFF);
    expect(back.left).toBeCloseTo(v.left, 9);
    expect(back.top).toBeCloseTo(v.top, 9);
  });

  it("clamps to 10% .. 800% and still keeps the point when clamped", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(20)).toBe(ZOOM_MAX);
    const v = { zoom: 7, left: 1000, top: 1000 };
    const at: [number, number] = [400, 300];
    const out = zoomAround(v, 50, at, OFF);
    expect(out.zoom).toBe(8);
    expect(pageAt(out, at, OFF)[0]).toBeCloseTo(pageAt(v, at, OFF)[0], 9);
  });

  it("wheel: up zooms in, down zooms out, lines count as 16 px; pan by axis", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1, 12);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0), 12);
    expect(
      wheelPan({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: false }),
    ).toEqual({
      dx: 0,
      dy: 40,
    });
    expect(
      wheelPan({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true }),
    ).toEqual({
      dx: 40,
      dy: 0,
    });
  });

  it("a member is shown centred with context, never past the zoom cap", () => {
    const size = { w: 1200, h: 800 };
    const v = viewOfBox({ x0: 1000, y0: 500, x1: 1010, y1: 500 }, size, OFF);
    expect(v.zoom).toBeCloseTo((800 - 160) / 240, 9);
    const centre = pageAt(v, [600, 400], OFF);
    expect(centre[0]).toBeCloseTo(1005, 9);
    expect(centre[1]).toBeCloseTo(500, 9);
    expect(viewOfBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, size, OFF, 1).zoom).toBe(
      4,
    );
  });

  it("reads the zoom box", () => {
    expect(parseZoom("150")).toBe(1.5);
    expect(parseZoom("150 %")).toBe(1.5);
    expect(parseZoom("2x")).toBe(2);
    expect(parseZoom("5000")).toBe(8);
    expect(parseZoom("abc")).toBeNull();
  });
});

describe("anchorIn", () => {
  it("is the pointer inside the page area, else the nearest point of it", () => {
    const r = { left: 100, top: 50, width: 800, height: 600 };
    expect(anchorIn(r, 300, 200)).toEqual([200, 150]);
    expect(anchorIn(r, 120, 20)).toEqual([20, 0]); // over the bar above the canvas
    expect(anchorIn(r, 60, 300)).toEqual([0, 250]); // left of the area
    expect(anchorIn(r, 2000, 2000)).toEqual([800, 600]);
  });
});

describe("floating panel: the free span and the view of a box", () => {
  it("the free span is the wider side of the covered strip, or everything", () => {
    expect(freeSpan(1000, null)).toEqual({ x0: 0, x1: 1000 });
    expect(freeSpan(1000, { left: 700, right: 1000 })).toEqual({
      x0: 0,
      x1: 700,
    });
    expect(freeSpan(1000, { left: 0, right: 300 })).toEqual({
      x0: 300,
      x1: 1000,
    });
    // both sides narrower than 200: the whole width (nothing sensible to keep clear)
    expect(freeSpan(1000, { left: 150, right: 850 })).toEqual({
      x0: 0,
      x1: 1000,
    });
    expect(freeSpan(1000, { left: 1200, right: 1300 })).toEqual({
      x0: 0,
      x1: 1000,
    });
  });

  it("a box is centred in the free span, so it stays beside the panel", () => {
    const off = { x: 72, y: 16 };
    const span = { x0: 0, x1: 700 };
    const box = { x0: 400, y0: 300, x1: 500, y1: 340 };
    const v = viewOfBox(box, { w: 1000, h: 600 }, off, 240, 80, 4, span);
    // the box centre (450, 320) lands at the middle of the span (350) horizontally
    expect(Math.round(450 * v.zoom + off.x - v.left)).toBe(350);
    expect(Math.round(320 * v.zoom + off.y - v.top)).toBe(300);
    // the whole box (grown to 240 pt) lies inside the span, clear of the covered strip
    expect(380 * v.zoom + off.x - v.left).toBeGreaterThan(0);
    expect(520 * v.zoom + off.x - v.left).toBeLessThan(700);
    // without a span the same box centres in the whole viewport
    const w = viewOfBox(box, { w: 1000, h: 600 }, off);
    expect(Math.round(450 * w.zoom + off.x - w.left)).toBe(500);
  });
});
