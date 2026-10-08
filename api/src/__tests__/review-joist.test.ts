import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findJoists, parseJoist } from '../review/joist.js';
import { parseProfile } from '../review/profile.js';

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../fixtures/synthetic/joist-cases.json',
    ),
    'utf8',
  ),
) as {
  cases: { text: string; canonical: string | null; series: string | null }[];
  find: { text: string; canonicals: string[] }[];
};

describe('joist parser parity with the Python parser', () => {
  it('reads the same whole-text cases as worker/src/text_layer/parsers/joist.py', () => {
    expect(fixture.cases.length).toBeGreaterThan(20);
    for (const c of fixture.cases) {
      const got = parseJoist(c.text);
      expect([c.text, got?.canonical ?? null, got?.series ?? null]).toEqual([
        c.text,
        c.canonical,
        c.series,
      ]);
    }
  });

  it('finds the same designations inside a line', () => {
    expect(fixture.find.length).toBeGreaterThan(5);
    for (const c of fixture.find) {
      expect([c.text, findJoists(c.text).map((j) => j.canonical)]).toEqual([c.text, c.canonicals]);
    }
  });

  it('a joist designation is never a steel profile', () => {
    for (const c of fixture.cases.filter((x) => x.canonical !== null)) {
      expect(parseProfile(c.text)).toBeNull();
    }
  });
});
