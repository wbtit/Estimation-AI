import { describe, expect, it } from "vitest";
import {
  nearestLine,
  nextToReview,
  pointSegmentDistance,
  type Seg,
} from "./pick";

describe("picking a line", () => {
  const lines: Seg[] = [
    [0, 100, 500, 100],
    [0, 130, 500, 130],
    [300, 0, 300, 500],
  ];
  it("measures the distance to a segment, including past its ends", () => {
    expect(pointSegmentDistance(250, 110, lines[0])).toBe(10);
    expect(pointSegmentDistance(550, 100, lines[0])).toBe(50);
    expect(pointSegmentDistance(5, 5, [10, 10, 10, 10])).toBeCloseTo(7.07, 2);
  });
  it("returns the nearest line within the tolerance and nothing beyond it", () => {
    expect(nearestLine(250, 104, lines, 8)).toEqual(lines[0]);
    expect(nearestLine(250, 126, lines, 8)).toEqual(lines[1]);
    expect(nearestLine(298, 50, lines, 8)).toEqual(lines[2]);
    expect(nearestLine(250, 115, lines, 8)).toBeNull();
    expect(nearestLine(0, 0, [], 8)).toBeNull();
  });
});

describe("next member to review", () => {
  const m = (
    id: string,
    color: string,
    confirmed = false,
    deleted = false,
  ) => ({
    id,
    deleted,
    status: { color, confirmed },
  });
  it("goes red first, then amber, skipping green, confirmed and deleted, and wraps", () => {
    const list = [
      m("a", "amber"),
      m("b", "green"),
      m("c", "red"),
      m("d", "amber", true),
      m("e", "red", false, true),
    ];
    expect(nextToReview(list, null)).toBe("c");
    expect(nextToReview(list, "c")).toBe("a");
    expect(nextToReview(list, "a")).toBe("c");
    expect(nextToReview([m("x", "green")], null)).toBeNull();
  });
});
