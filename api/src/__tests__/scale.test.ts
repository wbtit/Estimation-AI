import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeScaleText, parseScaleExact } from '../scale/index.js';

interface Cases {
  valid: { input: string; kind: 'ratio' | 'nts'; ratio: number | null }[];
  invalid: string[];
}

const cases = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../fixtures/synthetic/scale-cases.json',
    ),
    'utf8',
  ),
) as Cases;

describe('parseScaleExact: shared vectors (the Python scanner must agree)', () => {
  it.each(cases.valid)('parses $input', ({ input, kind, ratio }) => {
    const parsed = parseScaleExact(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe(kind);
    if (ratio === null) expect(parsed?.ratio).toBeNull();
    else expect(parsed?.ratio).toBeCloseTo(ratio, 9);
  });

  it.each(cases.invalid)('rejects %j', (input) => {
    expect(parseScaleExact(input)).toBeNull();
  });
});

describe('parseScaleExact', () => {
  it('ratio is real length / drawn length', () => {
    expect(parseScaleExact(`1/8" = 1'-0"`)?.ratio).toBe(96);
    expect(parseScaleExact(`1" = 20'`)?.ratio).toBe(240);
    expect(parseScaleExact('1:50')?.ratio).toBe(50);
    expect(parseScaleExact('NTS')?.ratio).toBeNull();
  });

  it('normalizes typographic quotes and dashes and keeps the text as the raw value', () => {
    const text = `1/8${String.fromCharCode(0x201d)} = 1${String.fromCharCode(0x2019)}${String.fromCharCode(0x2013)}0${String.fromCharCode(0x201d)}`;
    expect(normalizeScaleText(text)).toBe(`1/8" = 1'-0"`);
    expect(parseScaleExact(text)).toEqual({ raw: `1/8" = 1'-0"`, kind: 'ratio', ratio: 96 });
  });
});
