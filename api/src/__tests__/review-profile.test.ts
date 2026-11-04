import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalNumber, numberValue, parseProfile } from '../review/profile.js';

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../fixtures/synthetic/profile-cases.json',
    ),
    'utf8',
  ),
) as { cases: { text: string; canonical: string | null; family: string | null }[] };

describe('profile parser parity with the Python parser', () => {
  it('reads the same cases as worker/src/text_layer/parsers/profile.py', () => {
    expect(fixture.cases.length).toBeGreaterThan(50);
    const wrong = fixture.cases
      .map((c) => ({ c, got: parseProfile(c.text) }))
      .filter(
        ({ c, got }) =>
          (got?.canonical ?? null) !== c.canonical || (got?.family ?? null) !== c.family,
      )
      .map(
        ({ c, got }) =>
          `${JSON.stringify(c.text)} -> ${got?.canonical ?? null} (expected ${c.canonical})`,
      );
    expect(wrong).toEqual([]);
  });

  it('numbers: fractions, decimals and mixed numbers', () => {
    expect(numberValue('1/4')).toBe(0.25);
    expect(numberValue('.250')).toBe(0.25);
    expect(numberValue('3 1/2')).toBe(3.5);
    expect(numberValue('3-1/2')).toBe(3.5);
    expect(numberValue('1/0')).toBeNull();
    expect(canonicalNumber('3 1/2')).toBe('3-1/2');
    expect(canonicalNumber('.25')).toBe('0.25');
  });
});
