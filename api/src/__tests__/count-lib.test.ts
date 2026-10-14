import { describe, expect, it } from 'vitest';
import { pageTimes } from '../review/count-log.js';
import { measureTwoClicks, scaleViewFor, snapClick, type ScaledView } from '../review/measure.js';
import type { MemberView } from '../review/members.js';
import { fillSize } from '../review/size-fill.js';
import { parseTagText } from '../review/member-ops.js';

const view = (over: Partial<ScaledView> = {}): ScaledView => ({
  id: 'v1',
  box: { x0: 0, y0: 0, x1: 1000, y1: 800 },
  scale_ratio: 96,
  scale_confirmed: true,
  ...over,
});

describe('measure: scale conversion', () => {
  it('imperial 1/8" = 1\'-0" (ratio 96): 288 pt is 4 drawn inches, 32 feet', () => {
    const m = measureTwoClicks([], { x: 0, y: 0 }, { x: 288, y: 0 }, view());
    expect(m.length_mm).toBeCloseTo(9753.6, 1);
    expect(m.length_ft_in).toBe('32\'-0"');
  });

  it('imperial 1/4" = 1\'-0" (ratio 48): the same drawn length is half as long', () => {
    const m = measureTwoClicks([], { x: 0, y: 0 }, { x: 288, y: 0 }, view({ scale_ratio: 48 }));
    expect(m.length_ft_in).toBe('16\'-0"');
  });

  it('metric 1:100 and 1:50: 283.4646 pt is 100 mm drawn', () => {
    const a = measureTwoClicks(
      [],
      { x: 0, y: 0 },
      { x: 283.4646, y: 0 },
      view({ scale_ratio: 100 }),
    );
    expect(a.length_mm).toBeCloseTo(10000, 0);
    const b = measureTwoClicks(
      [],
      { x: 0, y: 0 },
      { x: 283.4646, y: 0 },
      view({ scale_ratio: 50 }),
    );
    expect(b.length_mm).toBeCloseTo(5000, 0);
  });

  it('a diagonal is the straight distance', () => {
    const m = measureTwoClicks([], { x: 0, y: 0 }, { x: 216, y: 288 }, view({ scale_ratio: 1 }));
    expect(m.length_mm).toBeCloseTo((360 * 25.4) / 72, 1); // 3-4-5: 360 pt
  });
});

describe('measure: which scale applies', () => {
  it('only a CONFIRMED scale is used, from the requested view or the one holding both points', () => {
    const guessed = view({ id: 'g', scale_confirmed: false });
    const ok = view({ id: 'ok' });
    const small = view({ id: 'small', box: { x0: 0, y0: 0, x1: 100, y1: 100 } });
    const a = { x: 50, y: 50 };
    const b = { x: 500, y: 500 };
    expect(scaleViewFor([guessed], a, b)).toBeNull();
    expect(scaleViewFor([guessed, ok], a, b)?.id).toBe('ok');
    expect(scaleViewFor([small, ok], a, b)?.id).toBe('ok'); // the small view does not hold b
    expect(scaleViewFor([ok], a, b, 'g')).toBeNull();
    expect(scaleViewFor([ok, small], a, { x: 60, y: 60 }, 'small')?.id).toBe('small');
    expect(scaleViewFor([view({ scale_ratio: null })], a, b)).toBeNull();
  });
});

describe('measure: snapping each click', () => {
  const lines = [
    [0, 0, 100, 0, 0, 1],
    [100, 0, 100, 100, 0, 1],
    [50, -20, 50, 20, 1, 0.5],
  ];
  it('snaps to an end point within the radius and to an intersection, and not beyond it', () => {
    expect(snapClick(lines, { x: 103, y: 4 }, 12).snap?.kind).toBe('endpoint');
    expect(snapClick(lines, { x: 103, y: 4 }, 12).point).toEqual({ x: 100, y: 0 });
    const x = snapClick(lines, { x: 53, y: 3 }, 12);
    expect(x.snap?.kind).toBe('intersection');
    expect(x.point).toEqual({ x: 50, y: 0 });
    const far = snapClick(lines, { x: 300, y: 300 }, 12);
    expect(far.snap).toBeNull();
    expect(far.point).toEqual({ x: 300, y: 300 });
  });

  it('a measurement uses the snapped points, so a click near a corner measures the corner', () => {
    const m = measureTwoClicks(
      lines,
      { x: 3, y: 4 },
      { x: 103, y: 4 },
      view({ scale_ratio: 1 }),
      12,
    );
    expect(m.a).toEqual({ x: 0, y: 0 });
    expect(m.b).toEqual({ x: 100, y: 0 });
    expect(m.length_mm).toBeCloseTo((100 * 25.4) / 72, 1);
    expect(m.a_snap?.kind).toBe('endpoint');
  });
});

function label(
  id: string,
  text: string,
  box: [number, number, number, number],
  line: number | null,
): MemberView {
  return {
    id,
    origin: 'extracted',
    deleted: false,
    merged_into: null,
    not_member: null,
    profile_raw: text,
    bbox: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] },
    link: {
      source: 'rule',
      line: line === null ? null : { p: [0, line], q: [500, line] },
    },
  } as unknown as MemberView;
}

describe('size autofill rules', () => {
  const members = [
    label('A', 'W12x26', [100, 90, 140, 98], 100), // linked to the line at y = 100
    label('B', 'HSS6x6x1/4', [300, 200, 340, 208], 400),
    label('C', 'W8x10', [900, 900, 940, 908], null),
  ];
  const snapped = { p: [0, 100] as [number, number], q: [500, 100] as [number, number] };

  it('1. the label linked to the snapped line, even when another label is nearer', () => {
    const r = fillSize({ x: 310, y: 203 }, snapped, members, 80); // click sits right on label B
    expect(r).toMatchObject({ profile_text: 'W12x26', source: 'linked_label' });
    expect(r.evidence?.member_id).toBe('A');
  });

  it('2. otherwise the nearest label within the radius, with its distance', () => {
    const r = fillSize({ x: 320, y: 215 }, null, members, 80);
    expect(r).toMatchObject({ profile_text: 'HSS6x6x1/4', source: 'nearest_label' });
    expect(r.evidence?.distance_pt).toBe(7);
    const none = fillSize({ x: 320, y: 215 }, null, members, 5);
    expect(none).toEqual({ profile_text: null, source: 'none', evidence: null });
  });

  it('3. blank when nothing is in range, and a deleted or not-a-member label is never used', () => {
    expect(fillSize({ x: 600, y: 600 }, null, members, 80).source).toBe('none');
    const gone = [{ ...members[1], deleted: true } as MemberView];
    expect(fillSize({ x: 320, y: 215 }, null, gone, 80).source).toBe('none');
    const notMember = [{ ...members[1], not_member: { reason: 'detail' } } as MemberView];
    expect(fillSize({ x: 320, y: 215 }, null, notMember, 80).source).toBe('none');
  });

  it('a person-made piece is not a label (only extracted labels give a size)', () => {
    const clicked = [{ ...members[1], origin: 'manual' } as MemberView];
    expect(fillSize({ x: 320, y: 215 }, null, clicked, 80).source).toBe('none');
  });

  it('is deterministic when two labels are equally near (lower id first)', () => {
    const twins = [
      label('b2', 'W10x12', [100, 100, 120, 110], null),
      label('b1', 'W14x30', [100, 100, 120, 110], null),
    ];
    expect(fillSize({ x: 110, y: 105 }, null, twins, 80).evidence?.member_id).toBe('b1');
  });
});

describe('tags and time per page', () => {
  it('parses a tag as letters and a number', () => {
    expect(parseTagText('B7')).toEqual({ prefix: 'B', number: 7 });
    expect(parseTagText(' hss12 ')).toEqual({ prefix: 'hss', number: 12 });
    expect(parseTagText('7')).toEqual({ prefix: null, number: 7 });
    expect(parseTagText('B')).toBeNull();
    expect(parseTagText('B-7')).toBeNull();
    expect(parseTagText('')).toBeNull();
  });

  it('time per page counts gaps up to five minutes as work and longer gaps as idle', () => {
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 8, 0, s));
    const out = pageTimes([
      { sheet_id: 's1', who: 'a', created_at: t(0) },
      { sheet_id: 's1', who: 'a', created_at: t(60) },
      { sheet_id: 's1', who: 'a', created_at: t(60 + 301) }, // idle gap
      { sheet_id: 's1', who: 'a', created_at: t(60 + 301 + 30) },
      { sheet_id: 's2', who: 'a', created_at: t(10) },
      { sheet_id: 's1', who: 'b', created_at: t(20) },
    ]);
    const a1 = out.find((x) => x.sheet_id === 's1' && x.who === 'a');
    expect(a1).toMatchObject({ actions: 4, active_seconds: 90 });
    expect(out.find((x) => x.sheet_id === 's2')?.actions).toBe(1);
    expect(out.find((x) => x.who === 'b')?.active_seconds).toBe(0);
  });
});
