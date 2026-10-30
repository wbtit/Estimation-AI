// Phase 14b/14c column symbols (pure).
import { describe, expect, it, vi } from "vitest";
import {
  ALL_FAMILIES,
  loadPaletteChoice,
  markerSizePt,
  PALETTE,
  pieceSymbol,
  savePaletteChoice,
  symbolForProfile,
  symbolPath,
} from "./columns";

describe("column symbols", () => {
  it("the palette holds only the five column types", () => {
    expect(PALETTE.map((g) => [g.group, g.items.length])).toEqual([
      ["Column type", 5],
    ]);
    expect(ALL_FAMILIES).toEqual([
      "w_shape",
      "w_cover_plates",
      "hss_square",
      "hss_rect",
      "hss_round",
    ]);
  });

  it("maps a profile to its symbol", () => {
    expect(symbolForProfile("W14X90")).toBe("w_shape");
    expect(symbolForProfile("HP12X53")).toBe("w_shape");
    expect(symbolForProfile("HSS12X12X3/8")).toBe("hss_square");
    expect(symbolForProfile("hss 12x6x1/2")).toBe("hss_rect");
    expect(symbolForProfile("HSS6.625X.280")).toBe("hss_round");
    expect(symbolForProfile("PIPE6STD")).toBe("hss_round");
    expect(symbolForProfile("W14X90 W/ PL3/4X16")).toBe("w_cover_plates");
    expect(symbolForProfile("W12X40 COVER PLATES")).toBe("w_cover_plates");
    expect(symbolForProfile("HSS12X13.5X3/8")).toBe("hss_rect");
    // anything else is unknown (the amber marker)
    expect(symbolForProfile("PL3/4X12")).toBeNull();
    expect(symbolForProfile("2C10X15.3")).toBeNull();
    expect(symbolForProfile("2MC12X10.6")).toBeNull();
    expect(symbolForProfile("L4X4X1/4")).toBeNull();
    expect(symbolForProfile("")).toBeNull();
  });

  it("draws from the profile first, else the drawn family, else unknown", () => {
    const base = { kind: "Column", scale_ratio: 96 };
    expect(
      pieceSymbol({ ...base, profile: "W14X90", symbol: "hss_square" }),
    ).toBe("w_shape");
    expect(pieceSymbol({ ...base, profile: null, symbol: "hss_rect" })).toBe(
      "hss_rect",
    );
    // a 14b family no longer drawn: unknown
    expect(
      pieceSymbol({ ...base, profile: null, symbol: "welded_box" }),
    ).toBeNull();
    expect(
      pieceSymbol({ ...base, profile: null, symbol: "unknown" }),
    ).toBeNull();
  });

  it("sizes the marker from the section at the page scale", () => {
    const p = { kind: "Column", profile: "W14X90", scale_ratio: 96 };
    expect(markerSizePt({ ...p, section_in: [14.5, 14] })).toEqual([
      10.875, 10.5,
    ]);
    expect(markerSizePt({ ...p, symbol_real_in: [12, 12] })).toEqual([9, 9]);
    expect(markerSizePt({ ...p })).toBeNull();
    expect(
      markerSizePt({ ...p, section_in: [1, 1], scale_ratio: null }),
    ).toBeNull();
  });

  it("has an outline for every family, HSS as a double outline", () => {
    for (const f of ALL_FAMILIES) {
      const d = symbolPath(f, 10, 12);
      expect(d.startsWith("M "), f).toBe(true);
      expect(d.includes("NaN"), f).toBe(false);
    }
    const subpaths = (f: (typeof ALL_FAMILIES)[number]) =>
      symbolPath(f, 10, 12).split("M ").length - 1;
    expect(subpaths("hss_square")).toBe(2);
    expect(subpaths("hss_rect")).toBe(2);
    expect(subpaths("hss_round")).toBe(2);
    expect(subpaths("w_shape")).toBe(1);
    expect(subpaths("w_cover_plates")).toBe(3);
    expect(symbolPath("hss_square", 10, 10)).toContain(" A "); // rounded corners
  });

  it("remembers the last symbol per person", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    expect(loadPaletteChoice("ann")).toEqual({
      family: "w_shape",
      stud: false,
    });
    savePaletteChoice("ann", { family: "hss_square", stud: true });
    expect(loadPaletteChoice("ann")).toEqual({
      family: "hss_square",
      stud: true,
    });
    expect(loadPaletteChoice("bob").family).toBe("w_shape");
    vi.unstubAllGlobals();
  });
});
