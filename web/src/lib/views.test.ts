// Phase 11c: the issue navigator order, member state colours, the pen preview (deselect / exclude)
// and the active view. Pure.
import { describe, expect, it } from "vitest";
import {
  activeView,
  ALL_LAYERS,
  issues,
  lineKey,
  markColour,
  nextIssue,
  penLineAt,
  penLinesInBox,
  penPreview,
  type Piece,
  type SheetLines,
} from "./lf";

function piece(over: Partial<Piece>): Piece {
  return {
    id: "p",
    member_id: "LF-B-1",
    sheet_id: "S",
    type: "beam",
    kind: "Beams",
    tag: "B1",
    quantity: 1,
    profile: "W16X26",
    profile_raw: "W16X26",
    studs: null,
    camber_raw: null,
    ignored: false,
    deleted: false,
    added: false,
    edited: false,
    a: [100, 100],
    b: [300, 100],
    ends_moved: false,
    length_mm: 6096,
    elevation_mm: null,
    build_state: "found",
    size_state: "sized",
    support_state: "both",
    piece_index: 1,
    scale_ratio: 96,
    evidence: null,
    build_view_id: null,
    ...over,
  };
}

describe("issue navigator", () => {
  const views = [
    { id: "v1", position: 1 },
    { id: "v2", position: 2 },
  ];
  const ps = [
    piece({ id: "found", build_state: "found" }),
    piece({
      id: "r-top",
      build_state: "needs_review",
      a: [500, 50],
      b: [600, 50],
    }),
    piece({
      id: "a-low",
      build_state: "attention",
      a: [50, 400],
      b: [90, 400],
    }),
    piece({
      id: "a-v2",
      build_state: "attention",
      a: [10, 10],
      b: [20, 10],
      build_view_id: "v2",
    }),
    piece({
      id: "a-left",
      build_state: "attention",
      a: [40, 200],
      b: [40, 300],
    }),
    piece({
      id: "a-right",
      build_state: "attention",
      a: [400, 200],
      b: [450, 200],
    }),
    piece({ id: "ignored", build_state: "attention", ignored: true }),
    piece({ id: "deleted", build_state: "attention", deleted: true }),
  ];

  it("attention first, then review; by view, then top to bottom, then left to right", () => {
    expect(issues(ps, views).map((x) => x.piece.id)).toEqual([
      "a-left",
      "a-right",
      "a-low",
      "a-v2",
      "r-top",
    ]);
  });

  it("Next and Previous wrap; after a fix Next goes on to the next unfixed one", () => {
    const list = issues(ps, views);
    const first = nextIssue(list, null, 1)!;
    expect(first.piece.id).toBe("a-left");
    const second = nextIssue(list, first.key, 1)!;
    expect(second.piece.id).toBe("a-right");
    expect(nextIssue(list, first.key, -1)!.piece.id).toBe("r-top"); // wraps back
    // a-right is fixed (now found): it drops out, Next goes on from where it was
    const fixed = issues(
      ps.map((p) =>
        p.id === "a-right" ? { ...p, build_state: "found" as const } : p,
      ),
      views,
    );
    expect(nextIssue(fixed, second.key, 1)!.piece.id).toBe("a-low");
    expect(nextIssue([], null, 1)).toBeNull();
  });

  it("hidden layers leave their members out", () => {
    const cols = [
      piece({ id: "c", type: "column", b: null, build_state: "attention" }),
    ];
    expect(issues(cols, views, { ...ALL_LAYERS, columns: false })).toEqual([]);
  });
});

describe("state colours", () => {
  it("colours the whole member by its state, else by its kind", () => {
    expect(markColour(piece({ build_state: "attention" }))).toBe(
      "var(--attention)",
    );
    expect(markColour(piece({ build_state: "needs_review" }))).toBe(
      "var(--review)",
    );
    expect(markColour(piece({}))).toBe("var(--beam)");
    expect(markColour(piece({ type: "column" }))).toBe("var(--column)");
    expect(markColour(piece({ ignored: true, build_state: "attention" }))).toBe(
      "var(--mark-ignored)",
    );
  });
});

describe("pen preview", () => {
  const lines: SheetLines = {
    version: "v",
    classes: ["thin", "heavy", "light"],
    lines: [
      [100, 100, 400, 100, 1, 2],
      [100, 300, 400, 300, 1, 2],
      [100, 500, 400, 500, 2, 1],
      [100, 700, 400, 700, 0, 0.5],
      [900, 100, 950, 100, 1, 2],
    ],
  };
  const box = { x0: 0, y0: 0, x1: 800, y1: 800 };

  it("shows the lines of every beam pen inside the view box, marked deselected or excluded", () => {
    const view = {
      deselections: [
        {
          id: "d",
          line: [100.004, 100, 400, 100] as [number, number, number, number],
        },
      ],
      exclusions: [
        {
          id: "e",
          box: { x0: 0, y0: 280, x1: 500, y1: 320 },
          status: "accepted" as const,
          rule: null,
        },
        {
          id: "s",
          box: { x0: 0, y0: 480, x1: 500, y1: 520 },
          status: "suggested" as const,
          rule: "table",
        },
      ],
    };
    const out = penPreview(lines, ["heavy", "light"], box, view);
    expect(out.map((l) => [l.index, l.deselected, l.excluded])).toEqual([
      [0, true, false],
      [1, false, true],
      [2, false, false], // a suggested box does not count
    ]);
    expect(penPreview(lines, [], box, view)).toEqual([]);
    expect(lineKey([100.004, 100, 400, 100])).toBe("100,100,400,100");
  });

  it("a click finds the nearest highlighted line; ctrl + drag takes the ones fully inside", () => {
    const out = penPreview(lines, ["heavy", "light"], box, null);
    expect(penLineAt(out, [200, 303], 6)!.index).toBe(1);
    expect(penLineAt(out, [200, 200], 6)).toBeNull();
    const inside = penLinesInBox(out, { x0: 50, y0: 50, x1: 450, y1: 350 });
    expect(inside.map((l) => l.index)).toEqual([0, 1]);
  });

  it("the active view is the chosen one, else the first", () => {
    const vs = [
      { id: "b", position: 2 },
      { id: "a", position: 1 },
    ];
    expect(activeView(vs, "b")!.id).toBe("b");
    expect(activeView(vs, null)!.id).toBe("a");
    expect(activeView(vs, "gone")!.id).toBe("a");
    expect(activeView([], null)).toBeNull();
  });
});
