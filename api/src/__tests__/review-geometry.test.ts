import { describe, expect, it } from 'vitest';
import { lengthMm, MM_PER_PT, realMm } from '../review/geometry.js';

describe('scale conversion', () => {
  it('converts points to paper mm and then to real mm', () => {
    expect(MM_PER_PT).toBeCloseTo(0.352778, 5);
    // 72 pt = 1 inch of paper; at 1/8" = 1'-0" (ratio 96) that is 96 inches = 2438.4 mm
    expect(realMm(72, 96)).toBeCloseTo(2438.4, 6);
    expect(lengthMm({ x: 0, y: 0 }, { x: 36, y: 0 }, 48)).toBeCloseTo(609.6, 6);
    expect(lengthMm({ x: 10, y: 10 }, { x: 10, y: 82 }, 96)).toBeCloseTo(2438.4, 6);
  });
});
