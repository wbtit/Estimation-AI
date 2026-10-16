import { describe, expect, it } from "vitest";
import { formatFtIn, parseFtIn } from "./ftin";

const ft = (feet: number, inches = 0) => (feet * 12 + inches) * 25.4;

describe("parseFtIn", () => {
  it("reads the owner's three forms", () => {
    expect(parseFtIn(`13'-3 1/2"`)).toBeCloseTo(ft(13, 3.5), 6);
    expect(parseFtIn(`13'-3.5"`)).toBeCloseTo(ft(13, 3.5), 6);
    expect(parseFtIn(`13.29'`)).toBeCloseTo(13.29 * 304.8, 6);
  });

  it("reads other common ways of writing feet and inches", () => {
    expect(parseFtIn(`13' 3"`)).toBeCloseTo(ft(13, 3), 6);
    expect(parseFtIn(`13'3"`)).toBeCloseTo(ft(13, 3), 6);
    expect(parseFtIn(`13'-3`)).toBeCloseTo(ft(13, 3), 6);
    expect(parseFtIn(`13'-3-1/2"`)).toBeCloseTo(ft(13, 3.5), 6);
    expect(parseFtIn(`13'`)).toBeCloseTo(ft(13), 6);
    expect(parseFtIn(`3 1/2"`)).toBeCloseTo(3.5 * 25.4, 6);
    expect(parseFtIn(`1/2"`)).toBeCloseTo(12.7, 6);
    expect(parseFtIn(`6.5"`)).toBeCloseTo(6.5 * 25.4, 6);
    expect(parseFtIn(` 13 ' - 3 1/2 " `)).toBeCloseTo(ft(13, 3.5), 6);
  });

  it("accepts a sign, typographic quotes and two apostrophes for inches", () => {
    expect(parseFtIn(`-2'-0"`)).toBeCloseTo(-ft(2), 6);
    expect(parseFtIn(`+2'-0"`)).toBeCloseTo(ft(2), 6);
    expect(parseFtIn(`13’-3 1/2”`)).toBeCloseTo(ft(13, 3.5), 6);
    expect(parseFtIn(`13′ 3″`)).toBeCloseTo(ft(13, 3), 6);
    expect(parseFtIn(`13'-3 1/2''`)).toBeCloseTo(ft(13, 3.5), 6);
    expect(parseFtIn(`13′–3″`)).toBeCloseTo(ft(13, 3), 6);
  });

  it("refuses a bare number, 12 inches or more after feet, and anything else", () => {
    expect(parseFtIn("13")).toBeNull();
    expect(parseFtIn("4051")).toBeNull();
    expect(parseFtIn("")).toBeNull();
    expect(parseFtIn(`13'-12"`)).toBeNull();
    expect(parseFtIn(`13'-3/0"`)).toBeNull();
    expect(parseFtIn("T.O.S.")).toBeNull();
    expect(parseFtIn(`13ft`)).toBeNull();
  });
});

describe("formatFtIn", () => {
  it("shows feet-inches to 1/16 inch and a dash for no value", () => {
    expect(formatFtIn(ft(13, 3.5))).toBe(`13'-3 1/2"`);
    expect(formatFtIn(ft(12, 6))).toBe(`12'-6"`);
    expect(formatFtIn(ft(0, 0.0625))).toBe(`0'-1/16"`);
    expect(formatFtIn(-ft(2))).toBe(`-2'-0"`);
    expect(formatFtIn(null)).toBe("—");
  });

  it("round-trips what it shows", () => {
    for (const mm of [0, 25.4, 1000, 3810, 4051.3, 12345.6]) {
      const back = parseFtIn(formatFtIn(mm)) as number;
      expect(Math.abs(back - mm)).toBeLessThanOrEqual(25.4 / 32 + 1e-9);
    }
  });
});
