// Phase 0-column-capture: the capture box (SYNTHETIC).
import { describe, expect, it } from "vitest";
import {
  boxAround,
  captureHit,
  dragCapture,
  sameBox,
  tightBox,
  toArray,
} from "./capture";

const page = { w: 1000, h: 800 };
describe("capture box", () => {
  it("the default is tight: the symbol's box plus a small margin, never a big window", () => {
    const b = tightBox([100, 100, 106, 112]);
    expect(b.x1 - b.x0).toBeLessThan(10);
    expect(b.y1 - b.y0).toBeLessThan(16);
    expect(b.x0).toBeLessThan(100);
    expect(toArray(b)).toHaveLength(4);
    expect(boxAround([50, 50], 8)).toEqual({ x0: 46, y0: 46, x1: 54, y1: 54 });
  });
  it("hits a handle, the body, or nothing", () => {
    const b = { x0: 100, y0: 100, x1: 120, y1: 130 };
    expect(captureHit(b, [100.5, 100.5], 2)).toBe("nw");
    expect(captureHit(b, [120, 115], 2)).toBe("e");
    expect(captureHit(b, [110, 115], 2)).toBe("move");
    expect(captureHit(b, [300, 300], 2)).toBeNull();
  });
  it("resizes by a handle and keeps a minimum size", () => {
    const b = { x0: 100, y0: 100, x1: 120, y1: 130 };
    expect(dragCapture(b, "e", 10, 0, page)).toEqual({
      x0: 100,
      y0: 100,
      x1: 130,
      y1: 130,
    });
    const tiny = dragCapture(b, "e", -50, 0, page);
    expect(tiny.x1 - tiny.x0).toBeGreaterThanOrEqual(2);
  });
  it("moves the whole box and keeps it on the page", () => {
    const b = { x0: 100, y0: 100, x1: 120, y1: 130 };
    expect(dragCapture(b, "move", 5, -5, page)).toEqual({
      x0: 105,
      y0: 95,
      x1: 125,
      y1: 125,
    });
    const off = dragCapture(b, "move", -500, 5000, page);
    expect(off.x0).toBe(0);
    expect(off.y1).toBe(800);
    expect(sameBox(b, { ...b })).toBe(true);
  });
});
