import { describe, expect, it } from "vitest";
import { piecesText, rowLabelsNote } from "./pieces";

describe("count basis text", () => {
  it("says nothing extra when pieces and labels agree", () => {
    expect(piecesText(5, 5)).toBe("5 pieces");
    expect(rowLabelsNote(2, 2)).toBe("");
  });

  it("shows the label count when labels share a line", () => {
    expect(piecesText(3, 4)).toContain(
      "3 pieces (one per linked line; 4 labels",
    );
    expect(rowLabelsNote(0, 1)).toBe("(1 label)");
    expect(rowLabelsNote(1, 3)).toBe("(3 labels)");
  });
});
