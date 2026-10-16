import { describe, expect, it } from "vitest";
import {
  ALL_LAYERS,
  beamLabel,
  bomOrder,
  common,
  flagOf,
  linesOfClass,
  MIXED,
  nameFromFile,
  parseRoute,
  pieceAt,
  piecesInBox,
  routeHash,
  stateReason,
  summary,
  visible,
  type BomRow,
  type Piece,
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
    ...over,
  };
}

function row(over: Partial<BomRow>): BomRow {
  return {
    main: 1,
    category: "Beams",
    piecemark: "B1",
    qty: 1,
    section_type: "W",
    section: "W16X26",
    length_mm: 6096,
    grade: null,
    weight_kg: 100,
    weight_lb: 1000,
    member: "m",
    sheet_id: "S",
    build_state: "found",
    in_main_total: true,
    ...over,
  };
}

describe("layers", () => {
  it("hides by layer, isolates undefined beams and filters by length", () => {
    const beam = piece({});
    const undef = piece({ profile: null });
    const col = piece({ type: "column", kind: "Column", b: null });
    expect([beam, undef, col].map((p) => visible(p, ALL_LAYERS))).toEqual([
      true,
      true,
      true,
    ]);
    const iso = { ...ALL_LAYERS, isolateUndefined: true };
    expect([beam, undef, col].map((p) => visible(p, iso))).toEqual([
      false,
      true,
      false,
    ]);
    expect(visible(beam, { ...ALL_LAYERS, beams: false })).toBe(false);
    expect(visible(undef, { ...ALL_LAYERS, beams: false })).toBe(true);
    expect(visible(beam, { ...ALL_LAYERS, minMm: 7000 })).toBe(false);
    expect(visible(beam, { ...ALL_LAYERS, maxMm: 7000 })).toBe(true);
    expect(visible(piece({ deleted: true }), ALL_LAYERS)).toBe(false);
  });
});

describe("overlay marks", () => {
  it("flags only needs review (amber) and attention (red)", () => {
    expect(flagOf(piece({ build_state: "found" }))).toBeNull();
    expect(flagOf(piece({ build_state: "needs_review" }))).toBe("amber");
    expect(flagOf(piece({ build_state: "attention" }))).toBe("red");
    expect(
      flagOf(piece({ build_state: "attention", ignored: true })),
    ).toBeNull();
  });

  it("writes the size in small letters with the studs", () => {
    expect(beamLabel(piece({ profile: "W18X35", studs: 10 }))).toBe(
      "w18x35 <10>",
    );
    expect(beamLabel(piece({ profile: "W16X26" }))).toBe("w16x26");
    expect(beamLabel(piece({ profile: null }))).toBe("");
  });
});

describe("hit tests", () => {
  it("finds the nearest visible piece; a column wins a tie", () => {
    const beam = piece({ id: "beam" });
    const col = piece({ id: "col", type: "column", a: [200, 100], b: null });
    expect(pieceAt([beam, col], [200, 101], 5)!.id).toBe("col");
    expect(pieceAt([beam, col], [150, 103], 5)!.id).toBe("beam");
    expect(pieceAt([beam, col], [150, 120], 5)).toBeNull();
    expect(
      pieceAt([beam], [150, 100], 5, { ...ALL_LAYERS, beams: false }),
    ).toBeNull();
  });

  it("selects pieces fully inside a box", () => {
    const a = piece({ id: "a" });
    const b = piece({ id: "b", a: [100, 400], b: [600, 400] });
    expect(
      piecesInBox([a, b], { x0: 50, y0: 50, x1: 350, y1: 450 }).map(
        (p) => p.id,
      ),
    ).toEqual(["a"]);
  });

  it("keeps the lines of the picked pen class", () => {
    const lines = {
      version: "v",
      classes: ["thin", "heavy"],
      lines: [
        [0, 0, 1, 1, 0, 0.5],
        [0, 0, 2, 2, 1, 2],
      ],
    };
    expect(linesOfClass(lines, "heavy")).toEqual([[0, 0, 2, 2, 1, 2]]);
    expect(linesOfClass(lines, "none")).toEqual([]);
    expect(linesOfClass(null, "heavy")).toEqual([]);
  });
});

describe("properties and summary", () => {
  it("shows one value or Mixed", () => {
    expect(common(["W16X26", "W16X26"])).toBe("W16X26");
    expect(common(["W16X26", "W18X35"])).toBe(MIXED);
    expect(common([])).toBeNull();
    expect(common([null, null])).toBeNull();
  });

  it("counts every piece, attention included, and sums US short tons of the main total", () => {
    const rows = [
      row({ qty: 2, weight_lb: 3000 }),
      row({ category: "Column", weight_lb: 1000 }),
      row({ category: "Vertical Brace", weight_lb: null }),
      row({ category: "Beams", sheet_id: "T", weight_lb: 500 }),
      row({ in_main_total: false, weight_lb: 99999 }),
    ];
    expect(summary(rows)).toEqual({
      columns: 1,
      beams: 4,
      braces: 1,
      tons: 2.25,
    });
    expect(summary(rows, "S")).toEqual({
      columns: 1,
      beams: 3,
      braces: 1,
      tons: 2,
    });
  });

  it("counts columns that all need attention (a column plan with no sizes read)", () => {
    const cols = Array.from({ length: 27 }, (_, i) =>
      row({
        category: "Column",
        piecemark: `C${i + 1}`,
        section: null,
        weight_lb: null,
        build_state: "attention",
        in_main_total: false,
      }),
    );
    expect(summary([...cols, row({ sheet_id: "T" })], "S")).toEqual({
      columns: 27,
      beams: 0,
      braces: 0,
      tons: 0,
    });
  });

  it("says why a piece is amber or red", () => {
    expect(
      stateReason(piece({ size_state: "inferred", support_state: "one" })),
    ).toBe("size from a nearby label; one end not supported");
    expect(stateReason(piece({ profile: null, size_state: "undefined" }))).toBe(
      "no size read",
    );
  });
});

describe("BOM", () => {
  it("sorts by category, then section, then piecemark", () => {
    const rows = [
      row({ category: "Column", section: null, piecemark: "C1" }),
      row({ section: "W16X26", piecemark: "B10" }),
      row({ section: "W16X26", piecemark: "B2" }),
      row({ section: "W12X14", piecemark: "B7" }),
    ];
    expect(
      rows
        .sort(bomOrder)
        .map((r) => `${r.category} ${r.section} ${r.piecemark}`),
    ).toEqual([
      "Beams W12X14 B7",
      "Beams W16X26 B2",
      "Beams W16X26 B10",
      "Column null C1",
    ]);
  });
});

describe("misc", () => {
  it("names a project from its file", () => {
    expect(nameFromFile("Job_42 structural set.pdf")).toBe(
      "Job 42 structural set",
    );
  });

  it("parses and writes hash routes", () => {
    expect(parseRoute("")).toEqual({ view: "projects" });
    expect(parseRoute("#/p/abc")).toEqual({
      view: "workspace",
      projectId: "abc",
      tab: "plans",
      sheetId: null,
    });
    expect(parseRoute("#/p/abc/plans/s1")).toEqual({
      view: "workspace",
      projectId: "abc",
      tab: "plans",
      sheetId: "s1",
    });
    expect(parseRoute("#/p/abc/bom").view).toBe("workspace");
    for (const h of [
      "#/",
      "#/p/abc",
      "#/p/abc/plans/s1",
      "#/p/abc/bom",
      "#/p/abc/report",
    ])
      expect(routeHash(parseRoute(h))).toBe(h);
  });
});
