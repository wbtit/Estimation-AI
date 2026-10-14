import { describe, expect, it } from "vitest";
import cases from "../../../fixtures/synthetic/snap-cases.json";
import { nearestLine, pointSegmentDistance, snapPoint } from "./snap";

type Case<T> = {
  name: string;
  click: [number, number];
  radius: number;
  expect: T | null;
};

describe("snap (same cases as the API)", () => {
  for (const c of cases.nearest as Case<{ index: number }>[]) {
    it(`nearest line: ${c.name}`, () => {
      const got = nearestLine(cases.lines, c.click[0], c.click[1], c.radius);
      if (c.expect === null) expect(got).toBeNull();
      else expect(got?.index).toBe(c.expect.index);
    });
  }
  for (const c of cases.point as Case<{
    kind: string;
    x: number;
    y: number;
  }>[]) {
    it(`snap point: ${c.name}`, () => {
      const got = snapPoint(cases.lines, c.click[0], c.click[1], c.radius);
      if (c.expect === null) expect(got).toBeNull();
      else {
        expect(got?.kind).toBe(c.expect.kind);
        expect(got?.x).toBeCloseTo(c.expect.x, 6);
        expect(got?.y).toBeCloseTo(c.expect.y, 6);
      }
    });
  }
  it("distance past the end of a segment", () => {
    expect(pointSegmentDistance(13, 4, [0, 0, 10, 0])).toBeCloseTo(5);
  });
  it("handles a large sheet quickly (50 000 lines, one query)", () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => [
      (i % 500) * 6,
      Math.floor(i / 500) * 6,
      (i % 500) * 6 + 5,
      Math.floor(i / 500) * 6,
      0,
      1,
    ]);
    const t0 = performance.now();
    nearestLine(lines, 1500, 300, 24);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
