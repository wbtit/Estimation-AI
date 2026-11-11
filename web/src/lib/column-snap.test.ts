// Phase 0-14g: Draw column lands on the symbol (SYNTHETIC symbols).
import { describe, expect, it } from "vitest";
import {
  nearestSymbol,
  squareMarginPt,
  nudgeStep,
  placeColumn,
  signedTurn,
  type ColumnSymbol,
} from "./column-snap";

const sym = (
  cx: number,
  cy: number,
  over: Partial<ColumnSymbol> = {},
): ColumnSymbol => ({
  centre: [cx, cy],
  box: [cx - 3, cy - 3, cx + 3, cy + 3],
  rotation_deg: 0,
  real_in: [16, 16],
  family: "hss_square",
  solid: null,
  ...over,
});
const R = 14;
const noLine = () => null;

describe("nearestSymbol", () => {
  it("takes the nearest known-family centre inside the radius, none beyond it", () => {
    expect(
      nearestSymbol([sym(100, 100)], [113.9, 100], R)?.distance,
    ).toBeCloseTo(13.9);
    expect(nearestSymbol([sym(100, 100)], [114.5, 100], R)).toBeNull();
  });
  it("with two inside the radius picks the nearest", () => {
    const a = sym(100, 100);
    const b = sym(106, 100);
    expect(nearestSymbol([a, b], [104, 100], R)?.symbol).toBe(b);
    expect(nearestSymbol([b, a], [101, 100], R)?.symbol).toBe(a);
  });
  it("a known family wins over a nearer solid shape (the worker's vector_example)", () => {
    const solid = sym(100, 100, { family: "unknown", solid: "square" });
    const known = sym(108, 100);
    expect(nearestSymbol([solid, known], [100, 100], R)?.symbol).toBe(known);
    expect(nearestSymbol([solid], [100, 100], R)?.symbol).toBe(solid);
  });
  it("ignores an unknown symbol that is not a solid shape", () => {
    expect(
      nearestSymbol([sym(100, 100, { family: "unknown" })], [100, 100], R),
    ).toBeNull();
  });
});

describe("an unknown 45 degree square", () => {
  const sq = sym(100, 100, {
    family: "unknown",
    square45: true,
    rotation_deg: 45,
    box: [90, 90, 110, 110],
  });
  it("is the click's symbol only inside its box plus the margin", () => {
    const m = squareMarginPt(5, 128); // 5 real inches at 1:128 = 2.8 pt
    expect(m).toBeCloseTo(2.8125, 4);
    expect(squareMarginPt(5, 64)).toBeCloseTo(5.625, 4);
    expect(squareMarginPt(5, null)).toBe(0);
    expect(nearestSymbol([sq], [105, 108], R, m)?.symbol).toBe(sq);
    expect(nearestSymbol([sq], [112, 100], R, m)?.symbol).toBe(sq); // 2 pt outside
    expect(nearestSymbol([sq], [114, 100], R, m)).toBeNull(); // 4 pt outside
    expect(nearestSymbol([sq], [100, 113.5], R, m)).toBeNull(); // 13.5 away, outside the box
  });
});

describe("placeColumn", () => {
  const base = { symbols: [sym(100, 100)], radius: R, line: noLine };
  it("an off-centre click lands on the symbol's centre and logs the distance", () => {
    const p = placeColumn({ ...base, p: [105, 96], shift: false });
    expect(p.at).toEqual([100, 100]);
    expect(p.source).toBe("symbol");
    expect(p.snapped).toBe(true);
    expect(p.distance).toBeCloseTo(Math.hypot(5, 4));
    expect(p.symbol?.real_in).toEqual([16, 16]);
  });
  it("Shift places the click as it is (and still logs the distance)", () => {
    const p = placeColumn({ ...base, p: [105, 96], shift: true });
    expect(p.at).toEqual([105, 96]);
    expect(p.source).toBe("shift_off");
    expect(p.snapped).toBe(false);
    expect(p.symbol).toBeNull();
    expect(p.distance).toBeCloseTo(Math.hypot(5, 4));
  });
  it("no symbol near: the line snap, else the click", () => {
    const far = { ...base, p: [200, 200] as [number, number], shift: false };
    const onLine = placeColumn({ ...far, line: () => [201, 199] });
    expect(onLine.source).toBe("line");
    expect(onLine.at).toEqual([201, 199]);
    const none = placeColumn(far);
    expect(none.source).toBe("none");
    expect(none.snapped).toBe(false);
    expect(none.at).toEqual([200, 200]);
  });
  it("before the symbols are loaded (no radius) the symbol snap is off", () => {
    const p = placeColumn({
      ...base,
      radius: null,
      p: [101, 100],
      shift: false,
    });
    expect(p.source).toBe("none");
  });
  it("a diagonal symbol gives its own turn; an upright one gives none", () => {
    const d = placeColumn({
      ...base,
      symbols: [sym(100, 100, { rotation_deg: 40 })],
      p: [102, 100],
      shift: false,
    });
    expect(d.turn).toBe(40);
    const e = placeColumn({
      ...base,
      symbols: [sym(100, 100, { rotation_deg: 50 })],
      p: [102, 100],
      shift: false,
    });
    expect(e.turn).toBe(-40);
    const u = placeColumn({
      ...base,
      symbols: [sym(100, 100, { rotation_deg: 1.2 })],
      p: [102, 100],
      shift: false,
    });
    expect(u.turn).toBe(0);
  });
});

describe("turns and nudges", () => {
  it("signedTurn reduces an edge direction mod 90 to (-45, 45]", () => {
    expect(signedTurn(0)).toBe(0);
    expect(signedTurn(45)).toBe(45);
    expect(signedTurn(46)).toBe(-44);
    expect(signedTurn(88)).toBe(-2);
    expect(signedTurn(130)).toBe(40);
  });
  it("an arrow key nudges 1 pt, Shift 5 pt", () => {
    expect(nudgeStep(false)).toBe(1);
    expect(nudgeStep(true)).toBe(5);
  });
});
