import { describe, expect, it } from "vitest";
import {
  boxHeight,
  boxWidth,
  clientToPage,
  fitZoom,
  lengthMm,
  mmToFeetInches,
  normaliseBox,
  realMm,
} from "./geometry";

describe("scale conversion", () => {
  it('72 pt of paper at 1/8" = 1\'-0" (ratio 96) is 2438.4 mm', () => {
    expect(realMm(72, 96)).toBeCloseTo(2438.4, 6);
    expect(lengthMm({ x: 0, y: 0 }, { x: 36, y: 0 }, 48)).toBeCloseTo(609.6, 6);
  });
});

describe("boxes and pointer mapping", () => {
  it("normalises a box drawn in any direction", () => {
    expect(normaliseBox({ x: 300, y: 200 }, { x: 100, y: 50 })).toEqual({
      x0: 100,
      y0: 50,
      x1: 300,
      y1: 200,
    });
    const b = normaliseBox({ x: 10, y: 10 }, { x: 40, y: 90 });
    expect([boxWidth(b), boxHeight(b)]).toEqual([30, 80]);
  });

  it("maps a pointer to page points for any zoom", () => {
    const rect = { left: 100, top: 50, width: 600, height: 400 }; // a 1200 x 800 pt page at 0.5
    expect(clientToPage(100, 50, rect, 1200, 800)).toEqual({ x: 0, y: 0 });
    expect(clientToPage(400, 250, rect, 1200, 800)).toEqual({ x: 600, y: 400 });
    expect(clientToPage(700, 450, rect, 1200, 800)).toEqual({
      x: 1200,
      y: 800,
    });
  });

  it("fits a page to a container", () => {
    expect(fitZoom(1000, 516)).toBeCloseTo(0.5, 6);
    expect(fitZoom(100000, 100)).toBeGreaterThan(0);
  });
});

describe("feet-inch display", () => {
  it("matches the API formatter", () => {
    expect(mmToFeetInches(3810)).toBe("12'-6\"");
    expect(mmToFeetInches(304.8)).toBe("1'-0\"");
    expect(mmToFeetInches(12.7)).toBe("0'-1/2\"");
    expect(mmToFeetInches(0)).toBe("0'-0\"");
    expect(mmToFeetInches(-3810)).toBe("-12'-6\"");
    expect(mmToFeetInches(Number.NaN)).toBe("");
  });
});
