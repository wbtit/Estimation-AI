// The API's label rules equal the worker's: the same cases (fixtures/synthetic/profile-link-cases.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  linkPoint,
  resolveProfile,
  typicalFor,
  type Box,
  type LabelRow,
  type Pt,
} from '../review/profile-link.js';

interface Case {
  name: string;
  fn: 'link' | 'typical' | 'resolve';
  point: Pt;
  box?: Box | null;
  example?: string | null;
  labels: {
    canonical: string;
    family: string;
    x: number;
    y: number;
    typical: boolean;
    valid: boolean;
    leaders: Pt[];
  }[];
  expect: {
    method?: string | null;
    canonical: string | null;
    confidence?: string;
    competitor?: string;
    source?: string | null;
    note?: string | null;
  };
}
const cases = (
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/synthetic/profile-link-cases.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: Case[] }
).cases;

const rows = (c: Case): LabelRow[] =>
  c.labels.map((l) => ({
    id: null,
    canonical: l.canonical,
    raw: l.canonical,
    family: l.family,
    kind: 'profile',
    valid: l.valid,
    flags: l.typical ? ['typical'] : [],
    box: [l.x - 10, l.y - 4, l.x + 10, l.y + 4],
    leaders: l.leaders,
  }));

describe('profile link rules (shared cases with the worker)', () => {
  for (const c of cases)
    it(c.name, () => {
      if (c.fn === 'resolve') {
        const got = resolveProfile(
          c.point,
          rows(c),
          { profile: c.example ?? null, raw: null },
          'view_family',
        );
        expect(got.source).toBe(c.expect.source);
        expect(got.profile).toBe(c.expect.canonical);
        expect((got.link as { note?: string } | null)?.note ?? null).toBe(c.expect.note);
        return;
      }
      const got =
        c.fn === 'link'
          ? linkPoint(c.point, c.box ?? null, rows(c))
          : typicalFor(c.point, rows(c), 'column');
      expect(got.method).toBe(c.expect.method);
      expect(got.label?.canonical ?? null).toBe(c.expect.canonical);
      if (c.expect.confidence) expect(got.confidence).toBe(c.expect.confidence);
      if (c.expect.competitor) expect(got.competitor).toBe(c.expect.competitor);
    });
});
