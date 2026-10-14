import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nearestLine,
  pointSegmentDistance,
  segmentIntersection,
  snapCandidates,
  snapPoint,
  snapTier,
} from '../review/snap.js';

const cases = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../fixtures/synthetic/snap-cases.json',
    ),
    'utf8',
  ),
) as {
  lines: number[][];
  classes: string[];
  ranked_lines: number[][];
  legacy_lines: number[][];
  candidates: {
    name: string;
    lines: 'ranked' | 'legacy';
    click: [number, number];
    radius: number;
    expect: number[];
  }[];
  nearest: {
    name: string;
    click: [number, number];
    radius: number;
    expect: { index: number } | null;
  }[];
  point: {
    name: string;
    click: [number, number];
    radius: number;
    expect: { kind: string; x: number; y: number } | null;
  }[];
};

describe('snap: the shared cases', () => {
  for (const c of cases.nearest) {
    it(`nearest line: ${c.name}`, () => {
      const got = nearestLine(cases.lines, c.click[0], c.click[1], c.radius);
      if (c.expect === null) expect(got).toBeNull();
      else expect(got?.index).toBe(c.expect.index);
    });
  }
  for (const c of cases.point) {
    it(`snap point: ${c.name}`, () => {
      const got = snapPoint(cases.lines, c.click[0], c.click[1], c.radius);
      if (c.expect === null) expect(got).toBeNull();
      else {
        expect(got?.kind).toBe(c.expect.kind);
        expect(got?.x).toBeCloseTo(c.expect.x, 6);
        expect(got?.y).toBeCloseTo(c.expect.y, 6);
      }
    });
  }
});

describe('snap: ranked candidates (Phase 9)', () => {
  for (const c of cases.candidates) {
    it(c.name, () => {
      const lines = c.lines === 'ranked' ? cases.ranked_lines : cases.legacy_lines;
      const got = snapCandidates(lines, cases.classes, c.click[0], c.click[1], c.radius);
      expect(got.map((g) => g.index)).toEqual(c.expect);
    });
  }

  it('never offers hatch or a dimension line, even when they are the only lines near', () => {
    const got = snapCandidates(cases.ranked_lines, cases.classes, 250, 98.5, 3);
    expect(got.map((g) => g.index)).not.toContain(3);
    expect(got.map((g) => g.index)).not.toContain(4);
  });

  it('tiers: solid medium or heavy 0, solid thin 1, dashed 2', () => {
    expect(snapTier(cases.ranked_lines[0] as number[], cases.classes)).toBe(0);
    expect(snapTier(cases.ranked_lines[1] as number[], cases.classes)).toBe(1);
    expect(snapTier(cases.ranked_lines[2] as number[], cases.classes)).toBe(2);
  });

  it('offers at most eight candidates and is deterministic', () => {
    const many = Array.from({ length: 20 }, (_, k) => [0, k * 0.5, 100, k * 0.5, 0, 1, 2, 0]);
    const a = snapCandidates(many, cases.classes, 50, 5, 24);
    expect(a).toHaveLength(8);
    expect(snapCandidates(many, cases.classes, 50, 5, 24)).toEqual(a);
  });
});

describe('snap: geometry', () => {
  it('distance to a segment, including past its ends and a degenerate segment', () => {
    expect(pointSegmentDistance(5, 3, [0, 0, 10, 0])).toBeCloseTo(3);
    expect(pointSegmentDistance(13, 4, [0, 0, 10, 0])).toBeCloseTo(5);
    expect(pointSegmentDistance(3, 4, [0, 0, 0, 0])).toBeCloseTo(5);
  });

  it('intersections: crossing, touching at an end, parallel and apart', () => {
    expect(segmentIntersection([0, 0, 10, 0], [5, -5, 5, 5])).toEqual([5, 0]);
    expect(segmentIntersection([0, 0, 10, 0], [10, 0, 10, 5])).toEqual([10, 0]);
    expect(segmentIntersection([0, 0, 10, 0], [0, 1, 10, 1])).toBeNull();
    expect(segmentIntersection([0, 0, 10, 0], [20, -5, 20, 5])).toBeNull();
  });

  it('is deterministic and does not change its input', () => {
    const copy = JSON.stringify(cases.lines);
    const a = snapPoint(cases.lines, 204, 104, 12);
    const b = snapPoint(cases.lines, 204, 104, 12);
    expect(a).toEqual(b);
    expect(JSON.stringify(cases.lines)).toBe(copy);
  });

  it('an empty sheet snaps to nothing', () => {
    expect(nearestLine([], 1, 1, 24)).toBeNull();
    expect(snapPoint([], 1, 1, 12)).toBeNull();
  });
});
