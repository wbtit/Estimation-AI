import { describe, expect, it } from 'vitest';
import {
  boxProblem,
  lengthMm,
  MM_PER_PT,
  planFrameOf,
  planXY,
  realMm,
  suggestScale,
  type ScaleItem,
} from '../review/geometry.js';

describe('scale conversion', () => {
  it('converts points to paper mm and then to real mm', () => {
    expect(MM_PER_PT).toBeCloseTo(0.352778, 5);
    // 72 pt = 1 inch of paper; at 1/8" = 1'-0" (ratio 96) that is 96 inches = 2438.4 mm
    expect(realMm(72, 96)).toBeCloseTo(2438.4, 6);
    expect(lengthMm({ x: 0, y: 0 }, { x: 36, y: 0 }, 48)).toBeCloseTo(609.6, 6);
    expect(lengthMm({ x: 10, y: 10 }, { x: 10, y: 82 }, 96)).toBeCloseTo(2438.4, 6);
  });

  it('plan frame: origin lower-left of the box, y up', () => {
    const box = { x0: 100, y0: 200, x1: 500, y1: 600 };
    expect(planFrameOf(box)).toEqual({ origin_pt: [100, 600], y_up: true });
    const [x, y] = planXY(box, 96, { x: 172, y: 528 }); // 72 pt right and 72 pt above the origin
    expect(x).toBeCloseTo(2438.4, 6);
    expect(y).toBeCloseTo(2438.4, 6);
    expect(planXY(box, 96, { x: 100, y: 600 })).toEqual([0, 0]);
  });
});

describe('view box checks', () => {
  it('accepts a box on the page and rejects bad ones', () => {
    expect(boxProblem({ x0: 10, y0: 10, x1: 300, y1: 300 }, 1000, 800)).toBeNull();
    expect(boxProblem({ x0: 300, y0: 300, x1: 10, y1: 10 }, 1000, 800)).toBeNull(); // reversed corners
    expect(boxProblem({ x0: 10, y0: 10, x1: 15, y1: 300 }, 1000, 800)).toMatch(/at least/);
    expect(boxProblem({ x0: 10, y0: 10, x1: 1200, y1: 300 }, 1000, 800)).toMatch(/on the page/);
    expect(boxProblem({ x0: NaN, y0: 10, x1: 100, y1: 300 }, 1000, 800)).toMatch(/non-numeric/);
  });
});

const item = (x: number, y: number, raw: string, ratio: number | null): ScaleItem => ({
  bbox: { x0: x, y0: y, x1: x + 60, y1: y + 8 },
  raw,
  ratio,
});

describe('scale suggestion', () => {
  const box = { x0: 100, y0: 100, x1: 600, y1: 500 };

  it('prefers scale text inside the box', () => {
    const s = suggestScale(box, [
      item(120, 480, '1/8" = 1\'-0"', 96),
      item(700, 520, '1/4" = 1\'-0"', 48),
    ]);
    expect(s).toMatchObject({ ratio: 96, where: 'inside', ambiguous: false });
    expect(s?.alternatives[0]).toMatchObject({ ratio: 48 });
  });

  it('falls back to the nearest scale text near the box', () => {
    const s = suggestScale(box, [
      item(150, 510, '1/8" = 1\'-0"', 96),
      item(150, 700, '1/4" = 1\'-0"', 48),
    ]);
    expect(s).toMatchObject({ ratio: 96, where: 'near', ambiguous: false });
  });

  it('flags two different scales inside the box as ambiguous', () => {
    const s = suggestScale(box, [item(120, 480, 'a', 96), item(300, 300, 'b', 48)]);
    expect(s?.ambiguous).toBe(true);
  });

  it('flags two different scales at the same distance as ambiguous', () => {
    const s = suggestScale(box, [item(150, 510, 'a', 96), item(350, 512, 'b', 48)]);
    expect(s?.ambiguous).toBe(true);
  });

  it('ignores NTS and far away text, and suggests nothing then', () => {
    expect(suggestScale(box, [item(120, 480, 'NTS', null)])).toBeNull();
    expect(suggestScale(box, [item(2000, 2000, 'far', 96)])).toBeNull();
    expect(suggestScale(box, [])).toBeNull();
  });
});
