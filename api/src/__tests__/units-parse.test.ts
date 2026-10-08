import { describe, expect, it } from 'vitest';
import { parseLengthMm } from '../units/parse.js';

describe('typed lengths', () => {
  it.each([
    ['12\'-6 1/2"', 3822.7],
    ['12\'-6"', 3810],
    ['12\'6"', 3810],
    ['12\' - 6"', 3810],
    ['3\'-0"', 914.4],
    ["12'", 3657.6],
    ['6"', 152.4],
    ['1/2"', 12.7],
    ['6.5"', 165.1],
    ['-2\'-6"', -762],
    ['3000 mm', 3000],
    ['12\u2019-6\u201d', 3810],
    ["12''", 304.8],
  ])('%s -> %s mm', (text, mm) => {
    expect(parseLengthMm(text)).toBeCloseTo(mm, 3);
  });

  it.each(['', '12', 'about 12 feet', '12\'-6/0"', '1/0"', 'x', "12'-"])('rejects %j', (text) => {
    expect(parseLengthMm(text)).toBeNull();
  });
});
