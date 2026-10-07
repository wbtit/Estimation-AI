import { describe, expect, it } from 'vitest';
import { kgToLb, lbPerFtToKgPerM, mmToFeetInches } from '../units/index.js';

describe('mmToFeetInches', () => {
  it.each([
    [0, `0'-0"`],
    [25.4, `0'-1"`],
    [12.7, `0'-1/2"`],
    [6.35, `0'-1/4"`],
    [304.8, `1'-0"`],
    [3810, `12'-6"`],
    [6000, `19'-8 1/4"`],
    [5000, `16'-4 7/8"`],
  ])('formats %s mm as %s', (mm, expected) => {
    expect(mmToFeetInches(mm)).toBe(expected);
  });

  it('carries into the next foot when inches round up to 12', () => {
    expect(mmToFeetInches(304.7)).toBe(`1'-0"`);
  });

  it('keeps the sign, but not for a value that rounds to zero', () => {
    expect(mmToFeetInches(-3810)).toBe(`-12'-6"`);
    expect(mmToFeetInches(-0.1)).toBe(`0'-0"`);
  });

  it('honours a different denominator', () => {
    expect(mmToFeetInches(10, 8)).toBe(`0'-3/8"`);
  });

  it('rejects non-finite input and bad denominators', () => {
    expect(() => mmToFeetInches(Number.NaN)).toThrow(RangeError);
    expect(() => mmToFeetInches(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => mmToFeetInches(10, 0)).toThrow(RangeError);
  });
});

describe('weight conversions', () => {
  it('converts lb/ft to kg/m with the exact definitional factor', () => {
    expect(lbPerFtToKgPerM(1)).toBeCloseTo(1.488163944, 8);
    expect(lbPerFtToKgPerM(100)).toBeCloseTo(148.8163944, 6);
  });

  it('converts kg to lb', () => {
    expect(kgToLb(0.45359237)).toBeCloseTo(1, 12);
    expect(kgToLb(125)).toBeCloseTo(275.578, 3);
  });
});
