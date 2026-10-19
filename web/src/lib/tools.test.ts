import { describe, expect, it } from "vitest";
import {
  cursorFor,
  dragHandle,
  effectiveTool,
  handleAt,
  pressPans,
  tipOf,
  toolForKey,
} from "./tools";

describe("hand tool and Space", () => {
  it("the hand tool pans with the left button; other tools do not", () => {
    expect(pressPans(0, "hand", false)).toBe(true);
    expect(pressPans(0, "select", false)).toBe(false);
    expect(pressPans(0, "beam", false)).toBe(false);
  });

  it("Space held turns any tool into the hand until released", () => {
    for (const t of ["select", "crop", "pick", "beam", "measure"] as const) {
      expect(effectiveTool(t, true)).toBe("hand");
      expect(pressPans(0, t, true)).toBe(true);
      expect(effectiveTool(t, false)).toBe(t); // released: back to the tool
    }
  });

  it("the middle (and right) button always pans", () => {
    expect(pressPans(1, "select", false)).toBe(true);
    expect(pressPans(1, "beam", false)).toBe(true);
    expect(pressPans(2, "crop", false)).toBe(true);
  });

  it("cursor: grab for the hand, grabbing while panning", () => {
    expect(cursorFor("hand", false, false)).toBe("grab");
    expect(cursorFor("select", true, false)).toBe("grab");
    expect(cursorFor("hand", false, true)).toBe("grabbing");
    expect(cursorFor("select", false, true)).toBe("grabbing");
    expect(cursorFor("select", false, false)).toBe("default");
    expect(cursorFor("crop", false, false)).toBe("crosshair");
  });

  it("keys pick tools (no modifier); tooltips carry the key", () => {
    expect(toolForKey("h")).toBe("hand");
    expect(toolForKey("H")).toBe("hand");
    expect(toolForKey("v")).toBe("select");
    expect(toolForKey("k")).toBe("column");
    expect(toolForKey("x")).toBe("exclude");
    expect(toolForKey("z", { ctrl: true })).toBeNull();
    expect(toolForKey("c", { meta: true })).toBeNull();
    expect(toolForKey("q")).toBeNull();
    expect(tipOf("Hand", "hand")).toBe("Hand (H)");
    expect(tipOf("Add view", "view")).toBe("Add view");
  });
});

describe("Edit box handles", () => {
  const box = { x0: 100, y0: 100, x1: 300, y1: 200 };

  it("finds a corner before an edge, within the tolerance", () => {
    expect(handleAt(box, [101, 99], 5)).toBe("nw");
    expect(handleAt(box, [200, 202], 5)).toBe("s");
    expect(handleAt(box, [300, 150], 5)).toBe("e");
    expect(handleAt(box, [200, 150], 5)).toBeNull();
  });

  it("a handle moves only its sides, keeps a minimum size and stays on the page", () => {
    expect(dragHandle(box, "se", 50, 20, { w: 1000, h: 800 })).toEqual({
      x0: 100,
      y0: 100,
      x1: 350,
      y1: 220,
    });
    expect(dragHandle(box, "n", 30, -40, { w: 1000, h: 800 })).toEqual({
      ...box,
      y0: 60,
    });
    expect(dragHandle(box, "w", 500, 0, { w: 1000, h: 800 }).x0).toBe(290);
    expect(dragHandle(box, "nw", -500, -500, { w: 1000, h: 800 })).toEqual({
      ...box,
      x0: 0,
      y0: 0,
    });
  });
});
