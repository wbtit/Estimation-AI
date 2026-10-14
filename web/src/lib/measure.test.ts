import { describe, expect, it } from "vitest";
import { feetInches, lengthMm, metric } from "./measure";

describe("scale conversion", () => {
  it("imperial 1/8 inch = 1 foot (ratio 96): 300 pt is 33 feet 4 inches", () => {
    const mm = lengthMm({ x: 100, y: 300 }, { x: 400, y: 300 }, 96);
    expect(mm).toBeCloseTo((300 * 25.4 * 96) / 72, 6);
    expect(feetInches(mm)).toBe("33'-4\"");
  });

  it("imperial: one drawn inch at 1/8 scale is 8 feet; at 1/4 scale (ratio 48) it is 4 feet", () => {
    expect(feetInches(lengthMm({ x: 0, y: 0 }, { x: 72, y: 0 }, 96))).toBe(
      "8'-0\"",
    );
    expect(feetInches(lengthMm({ x: 0, y: 0 }, { x: 72, y: 0 }, 48))).toBe(
      "4'-0\"",
    );
  });

  it("metric 1:100: 283.4646 pt (100 mm drawn) is 10 000 mm", () => {
    const mm = lengthMm({ x: 0, y: 0 }, { x: 283.4646, y: 0 }, 100);
    expect(mm).toBeCloseTo(10000, 0);
    expect(metric(mm)).toBe("10 000 mm (10.00 m)");
    expect(feetInches(mm)).toBe("32'-9 11/16\"");
  });

  it("metric 1:50 and a diagonal", () => {
    const mm = lengthMm({ x: 0, y: 0 }, { x: 144 * 0.6, y: 144 * 0.8 }, 50); // 144 pt = 2 in = 50.8 mm
    expect(mm).toBeCloseTo(2540, 4);
  });

  it("feet-inches rolls 11 15/16 inches up and keeps fractions reduced", () => {
    expect(feetInches(304.8 - 1)).toBe("0'-11 15/16\"");
    expect(feetInches(304.8 - 0.2)).toBe("1'-0\"");
    expect(feetInches(25.4 * 6.5)).toBe("0'-6 1/2\"");
    expect(feetInches(0)).toBe("0'-0\"");
  });

  it("is symmetric in the two clicks", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 310, y: 420 };
    expect(lengthMm(a, b, 96)).toBe(lengthMm(b, a, 96));
  });
});
