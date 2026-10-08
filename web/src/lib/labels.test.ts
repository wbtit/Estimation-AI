import { describe, expect, it } from "vitest";
import { countByCategory, labelsOf } from "./labels";
import { highlight, searchLines } from "./notes";
import type { TextItem } from "./types";

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
const item = (over: Partial<TextItem>): TextItem => ({
  id: "i",
  item_key: "k",
  bbox: box,
  text: "t",
  level: "line",
  angle_deg: 0,
  orientation: "horizontal",
  methods: ["pdf_text"],
  parsed: null,
  ...over,
});

describe("overlay labels", () => {
  it("uses line items for profiles, dimensions, elevations and scales and word items for marks and sheet numbers", () => {
    const labels = labelsOf([
      item({
        item_key: "a",
        parsed: [
          { kind: "profile", canonical: "W12X26", raw: "W12x26" },
          { kind: "dimension", raw: "12'-6\"", mm: 3810 },
          { kind: "elevation", raw: "T.O.S. EL. 100'-0\"", value_mm: 30480 },
          { kind: "scale", raw: '1/8" = 1\'-0"', ratio: 96 },
        ],
      }),
      item({
        item_key: "b",
        level: "word",
        parsed: [
          { kind: "mark_candidate", raw: "B1" },
          { kind: "sheet_number", raw: "S4.1" },
        ],
      }),
      item({
        item_key: "c",
        level: "word",
        parsed: [{ kind: "profile", canonical: "W1X1" }],
      }), // wrong level
      item({ item_key: "d", parsed: null }),
    ]);
    expect(countByCategory(labels)).toEqual({
      profile: 1,
      mark: 1,
      dimension: 1,
      elevation: 1,
      scale: 1,
      sheet_number: 1,
    });
    expect(labels.find((l) => l.category === "profile")?.title).toBe(
      "profile W12X26",
    );
    expect(labels.find((l) => l.category === "mark")?.title).toContain(
      "not a member claim",
    );
    expect(new Set(labels.map((l) => l.key)).size).toBe(labels.length);
  });
});

describe("notes highlighting and search", () => {
  it("highlights steel grades, finishes and bolts without matching inside longer numbers", () => {
    const pieces = highlight(
      "Use A992 steel, A365 plate, galvanized after shop paint; A325 bolts.",
    );
    const hits = pieces.filter((p) => p.hit).map((p) => p.text);
    expect(hits).toEqual(["A992", "galvaniz", "shop paint", "A325", "bolt"]);
    expect(pieces.map((p) => p.text).join("")).toBe(
      "Use A992 steel, A365 plate, galvanized after shop paint; A325 bolts.",
    );
  });

  it("returns the text unchanged when nothing matches, and searches case-insensitively", () => {
    expect(highlight("nothing here")).toEqual([
      { text: "nothing here", hit: false },
    ]);
    const lines = [{ text: "Shop PAINT all steel" }, { text: "decking" }];
    expect(searchLines(lines, "paint")).toEqual([lines[0]]);
    expect(searchLines(lines, "  ")).toEqual(lines);
  });
});
