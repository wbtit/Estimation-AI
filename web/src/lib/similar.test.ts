// Phase 14e: the preview's strictness filter and ticks (pure).
import { describe, expect, it } from "vitest";
import {
  matchKey,
  scoreLabel,
  shownAt,
  ticked,
  toggle,
  untickedShown,
  type SimilarMatch,
} from "./similar";

const ms: SimilarMatch[] = [
  { centre: [1, 1], source: "vector", score: null },
  { centre: [2, 1], source: "image", score: 0.95 },
  { centre: [3, 1], source: "image", score: 0.8 },
  { centre: [4, 1], source: "image", score: 0.62 },
];

describe("similar preview", () => {
  it("shows vector matches always and image matches at or above the strictness", () => {
    expect(shownAt(ms, 0.8).map(matchKey)).toEqual(["1,1", "2,1", "3,1"]);
    expect(shownAt(ms, 0.6)).toHaveLength(4);
    expect(shownAt(ms, 0.9).map(matchKey)).toEqual(["1,1", "2,1"]);
  });
  it("Accept takes the shown, ticked ones; only shown unticks are sent", () => {
    const off = new Set(["3,1", "4,1"]);
    expect(ticked(ms, 0.8, off).map(matchKey)).toEqual(["1,1", "2,1"]);
    expect(untickedShown(ms, 0.8, off)).toEqual([[3, 1]]); // 4,1 is hidden at 0.8
    expect(toggle(toggle(off, "1,1"), "1,1")).toEqual(off);
  });
  it("labels the score, or shape for a vector match", () => {
    expect(ms.map(scoreLabel)).toEqual(["shape", "0.95", "0.80", "0.62"]);
  });
});
