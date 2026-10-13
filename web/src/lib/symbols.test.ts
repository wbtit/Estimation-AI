import { describe, expect, it } from "vitest";
import {
  applyFilters,
  hasCountSymbol,
  listedApart,
  NO_FILTERS,
  symbolAnchor,
  symbolPath,
} from "./symbols";
import type { MemberView, SymbolColor } from "./types";

// SYNTHETIC members: only the fields these helpers read.
function member(
  over: Partial<MemberView> & Record<string, unknown> = {},
): MemberView {
  return {
    id: "m",
    deleted: false,
    merged_into: null,
    not_member: null,
    existing: false,
    counting: "counted",
    human: "unreviewed",
    changed_at: "2026-01-01T00:00:00.000Z",
    symbol_color: "green",
    status: { color: "green", confirmed: false, reasons: [] },
    kind: {
      name: "Beams",
      state: "guessed",
      source: "keyword",
      scope: "main",
      evidence: null,
    },
    link: {
      source: "rule",
      confidence: "high",
      margin: null,
      line: null,
      chosen_rank: 1,
      candidates: [],
    },
    bbox: null,
    ...over,
  } as unknown as MemberView;
}

describe("symbolAnchor", () => {
  it("is the middle of the linked line when the label is far from it", () => {
    const m = member({
      link: { line: { p: [0, 0], q: [200, 0] } } as MemberView["link"],
      bbox: { x0: 0, y0: 100, x1: 20, y1: 110 },
    });
    expect(symbolAnchor(m, 12)).toEqual({ x: 100, y: 0 });
  });

  it("slides along the line, away from the label, when the label sits on the middle", () => {
    const m = member({
      link: { line: { p: [0, 0], q: [400, 0] } } as MemberView["link"],
      bbox: { x0: 190, y0: -12, x1: 230, y1: -2 }, // just above the middle, slightly right
    });
    const a = symbolAnchor(m, 12);
    expect(a?.y).toBe(0); // still on the line
    expect(a!.x).toBeLessThan(200); // moved to the side away from the label
    expect(Math.abs(a!.x - 200)).toBeGreaterThan(12);
  });

  it("falls back to the right of the label when there is no line, and to null with neither", () => {
    expect(
      symbolAnchor(member({ bbox: { x0: 10, y0: 10, x1: 30, y1: 20 } }), 12),
    ).toEqual({ x: 42, y: 15 });
    expect(symbolAnchor(member(), 12)).toBeNull();
  });
});

describe("symbolPath", () => {
  it("circle for linear, triangle for column, square for plate, diamond for other, none for excluded", () => {
    expect(symbolPath("linear", 5)).toBeNull(); // drawn as a circle by the caller
    expect(symbolPath("column", 5)).toMatch(/^M0 -5 L/);
    expect(symbolPath("plate", 5)).toContain("H");
    expect(symbolPath("other", 5)).toBe("M0 -5 L5 0 L0 5 L-5 0 Z");
    expect(symbolPath("none", 5)).toBeNull();
  });
});

describe("filters", () => {
  const ms = [
    member({ id: "a", symbol_color: "green" as SymbolColor }),
    member({
      id: "b",
      symbol_color: "amber" as SymbolColor,
      human: "confirmed",
    }),
    member({
      id: "c",
      symbol_color: "grey" as SymbolColor,
      kind: {
        name: null,
        state: "missing",
        source: null,
        scope: null,
        evidence: null,
      },
      changed_at: "2026-03-01T00:00:00.000Z",
    }),
  ];
  const ids = (f: Parameters<typeof applyFilters>[1]) =>
    applyFilters(ms, f, "2026-02-01T00:00:00.000Z").map((m) => m.id);

  it("passes everything with no filter", () =>
    expect(ids(NO_FILTERS)).toEqual(["a", "b", "c"]));
  it("filters by colour", () =>
    expect(
      ids({ ...NO_FILTERS, colours: new Set<SymbolColor>(["amber", "grey"]) }),
    ).toEqual(["b", "c"]));
  it("filters by kind, including no kind", () => {
    expect(ids({ ...NO_FILTERS, kind: "Beams" })).toEqual(["a", "b"]);
    expect(ids({ ...NO_FILTERS, kind: "(none)" })).toEqual(["c"]);
  });
  it("only unreviewed and only changed since the last run", () => {
    expect(ids({ ...NO_FILTERS, onlyUnreviewed: true })).toEqual(["a", "c"]);
    expect(ids({ ...NO_FILTERS, onlyChanged: true })).toEqual(["c"]);
  });
});

describe("what gets a count symbol", () => {
  it("counts main kinds and pieces without a kind; not excluded, misc, existing or unlinked", () => {
    expect(hasCountSymbol(member())).toBe(true);
    expect(hasCountSymbol(member({ counting: "not_counted" }))).toBe(false);
    expect(hasCountSymbol(member({ counting: "misc_reserved" }))).toBe(false);
    expect(hasCountSymbol(member({ existing: true }))).toBe(false);
    expect(hasCountSymbol(member({ deleted: true }))).toBe(false);
    expect(
      hasCountSymbol(
        member({
          status: { color: "unlinked", confirmed: false, reasons: [] },
        }),
      ),
    ).toBe(false);
  });
  it("lists excluded and misc pieces apart", () => {
    const r = listedApart([
      member({ id: "x", counting: "not_counted" }),
      member({ id: "y", counting: "misc_reserved" }),
      member({ id: "z" }),
    ]);
    expect([r.notCounted.map((m) => m.id), r.misc.map((m) => m.id)]).toEqual([
      ["x"],
      ["y"],
    ]);
  });
});
