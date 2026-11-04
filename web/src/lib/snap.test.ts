import { describe, expect, it } from "vitest";
import cases from "../../../fixtures/synthetic/snap-cases.json";
import { pointSegmentDistance, snapPoint } from "./snap";

type Case<T> = {
  name: string;
  click: [number, number];
  radius: number;
  expect: T | null;
};

describe("snap (same cases as the API)", () => {
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
});
