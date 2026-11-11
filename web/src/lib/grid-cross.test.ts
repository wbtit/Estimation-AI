// Phase 0 column capture: grid crossings and the off-grid flag (SYNTHETIC).
import { describe, expect, it } from "vitest";
import { crossings, offGrid, type GridSeg } from "./grid-cross";

const h = (y: number): GridSeg => ({ a: [0, y], b: [1000, y] });
const v = (x: number): GridSeg => ({ a: [x, 0], b: [x, 800] });

describe("grid crossings", () => {
  it("every horizontal line crosses every vertical one; parallel lines never cross", () => {
    const c = crossings([h(100), h(300), v(200), v(500), v(700)]);
    expect(c).toHaveLength(6);
    expect(c).toContainEqual([500, 300]);
  });
  it("a skewed grid crosses too, and lines that do not reach each other do not", () => {
    const c = crossings([
      { a: [0, 0], b: [100, 100] },
      { a: [100, 0], b: [0, 100] },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]![0]).toBeCloseTo(50);
    expect(
      crossings([
        { a: [0, 0], b: [10, 0] },
        { a: [50, -5], b: [50, 5] },
      ]),
    ).toHaveLength(0);
  });
  it("only where a grid was detected: no crossing means never amber; otherwise more than 2 in away", () => {
    const ratio = 128; // 2 in = 1.12 pt
    expect(offGrid([5, 5], [], ratio)).toBe(false);
    const cross = crossings([h(100), v(200)]);
    expect(offGrid([200, 100], cross, ratio)).toBe(false);
    expect(offGrid([201, 100], cross, ratio)).toBe(false); // 1.8 in
    expect(offGrid([201.5, 100], cross, ratio)).toBe(true); // 2.7 in
    expect(offGrid([230, 140], cross, ratio)).toBe(true);
  });
});
