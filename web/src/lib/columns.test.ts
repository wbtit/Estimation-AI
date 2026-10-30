// Phase 14b column symbols (pure).
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
  it("the palette holds the 14 symbols in three groups", () => {
    expect(PALETTE.map((g) => [g.group, g.items.length])).toEqual([
      ["W family", 5],
      ["HSS", 4],
      ["Built-up", 5],
    ]);
    expect(new Set(ALL_FAMILIES).size).toBe(14);
  });

  it("maps a profile to its symbol", () => {
    expect(symbolForProfile("W14X90")).toBe("w_shape");
    expect(symbolForProfile("HP12X53")).toBe("w_shape");
    expect(symbolForProfile("HSS12X12X3/8")).toBe("hss_square");
    expect(symbolForProfile("hss 12x6x1/2")).toBe("hss_rect");
    expect(symbolForProfile("HSS6.625X.280")).toBe("hss_round");
    expect(symbolForProfile("PIPE6STD")).toBe("hss_round");
    expect(symbolForProfile("PL3/4X12")).toBe("built_up_3plates");
    expect(symbolForProfile("2C10X15.3")).toBe("2c_back_to_back");
    expect(symbolForProfile("2MC12X10.6")).toBe("2c_back_to_back");
    expect(symbolForProfile("L4X4X1/4")).toBeNull();
    expect(symbolForProfile("")).toBeNull();
  });

  it("draws from the profile first, else the drawn family, else unknown", () => {
    const base = { kind: "Column", scale_ratio: 96 };
    expect(
      pieceSymbol({ ...base, profile: "W14X90", symbol: "hss_square" }),
    ).toBe("w_shape");
    expect(pieceSymbol({ ...base, profile: null, symbol: "welded_box" })).toBe(
      "welded_box",
    );
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

  it("has an outline for every family", () => {
    for (const f of ALL_FAMILIES) {
      const d = symbolPath(f, 10, 12);
      expect(d.startsWith("M "), f).toBe(true);
      expect(d.includes("NaN"), f).toBe(false);
    }
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
