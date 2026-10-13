import { describe, expect, it } from 'vitest';
import { CatalogLookup, shapeKey, type CatalogShape } from '../catalog/lookup.js';

// SYNTHETIC catalog rows (made-up weights); only the spelling rules are under test.
const shapes: CatalogShape[] = [
  { shape_name: 'W12X26', family: 'W', weight_lb_per_ft: 26, weight_kg_per_m: 38.7 },
  { shape_name: 'HSS6X4X1/4', family: 'HSS', weight_lb_per_ft: 15.62, weight_kg_per_m: 23.2 },
  { shape_name: 'HSS6.625X0.250', family: 'HSS', weight_lb_per_ft: 17.04, weight_kg_per_m: 25.3 },
  { shape_name: 'L4X4X1/4', family: 'L', weight_lb_per_ft: 6.6, weight_kg_per_m: 9.8 },
  { shape_name: 'L3-1/2X3X1/4', family: 'L', weight_lb_per_ft: 5.8, weight_kg_per_m: 8.6 },
  { shape_name: '2L4X4X1/4', family: '2L', weight_lb_per_ft: 13.2, weight_kg_per_m: 19.6 },
  { shape_name: 'Pipe4STD', family: 'PIPE', weight_lb_per_ft: 10.8, weight_kg_per_m: 16.1 },
  { shape_name: 'HSS5X5X1/4', family: 'HSS', weight_lb_per_ft: 12, weight_kg_per_m: 17.9 },
  { shape_name: 'HSS5X5X0.250', family: 'HSS', weight_lb_per_ft: 13, weight_kg_per_m: 19.4 },
];
const lookup = new CatalogLookup(shapes);
const name = (t: string) => {
  const r = lookup.find(t);
  return r.found ? r.shape.shape_name : r.reason;
};

describe('catalog lookup by drawing spelling', () => {
  it('forgives case, spaces, x/X/times sign and WF', () => {
    for (const t of ['W12X26', 'w12x26', 'W 12 x 26', 'W12\u00d726', 'WF12x26', 'wf 12 X 26'])
      expect(name(t)).toBe('W12X26');
  });
  it('matches a fraction with its decimal by exact numeric equality', () => {
    for (const t of ['HSS6X4X1/4', 'HSS 6 x 4 x .25', 'HSS6x4x0.250', 'hss6X4X0.25'])
      expect(name(t)).toBe('HSS6X4X1/4');
    expect(name('HSS6.625x.25')).toBe('HSS6.625X0.250');
    expect(name('HSS6.625X1/4')).toBe('HSS6.625X0.250');
  });
  it('handles angles with mixed numbers and double angles', () => {
    expect(name('L4x4x.25')).toBe('L4X4X1/4');
    expect(name('L 3 1/2 x 3 x 1/4')).toBe('L3-1/2X3X1/4');
    expect(name('2L4x4x1/4')).toBe('2L4X4X1/4');
  });
  it('matches pipe by exact normalised name only', () => {
    expect(name('PIPE 4 STD')).toBe('Pipe4STD');
    expect(name('PIPE4XS')).toBe('not_in_catalog');
  });
  it('does not guess: near sizes, other families and unreadable text are not found', () => {
    expect(name('W12X27')).toBe('not_in_catalog');
    expect(name('HSS6X4X0.3')).toBe('not_in_catalog');
    expect(name('')).toBe('no_profile');
    expect(name('beam')).toBe('not_in_catalog');
  });
  it('reports two catalog shapes with the same normalised name as ambiguous', () => {
    expect(name('HSS5X5X1/4')).toBe('HSS5X5X1/4'); // exact spelling still wins
    expect(name('HSS5X5X.25')).toBe('ambiguous');
    expect(shapeKey('W12X26')).toBe(shapeKey('wf12 x 26.0'));
  });
  it('reports how it matched', () => {
    const a = lookup.find('WF12x26');
    const b = lookup.find('W12X26');
    expect(a.found && a.via).toBe('numeric');
    expect(b.found && b.via).toBe('exact');
  });
});
