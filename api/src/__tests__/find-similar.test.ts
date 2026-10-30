// Phase 14b Find similar, pure (SYNTHETIC): the shared cases also run by the worker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findSimilar, sameKind, symbolAt, type StoredSymbol } from '../review/find-similar.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cases = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures/synthetic/find-similar-cases.json'), 'utf8'),
).cases as {
  example: { family: string; real_in: [number, number] };
  symbol: { family: string; real_in: [number, number] };
  match: boolean;
}[];

const sym = (x: number, y: number, family = 'hss_square', real: [number, number] = [12, 12]) =>
  ({
    family,
    box: [x - 4, y - 4, x + 4, y + 4],
    centre: [x, y],
    rotation_deg: 0,
    real_in: real,
  }) as StoredSymbol;

describe('find similar', () => {
  it('agrees with the worker on the shared cases', () => {
    for (const c of cases) expect(sameKind(c.symbol, c.example), JSON.stringify(c)).toBe(c.match);
  });

  it('takes the known symbol under a drawn column and skips symbols that are already columns', () => {
    const syms = [
      sym(100, 100, 'unknown'),
      sym(103, 100),
      sym(300, 100),
      sym(500, 50),
      sym(700, 100, 'hss_rect', [6, 12]),
      sym(900, 100, 'hss_square', [20, 20]),
    ];
    const ex = symbolAt([100, 100], syms)!;
    expect(ex.centre).toEqual([103, 100]); // the unknown one is nearer but never an example
    expect(symbolAt([200, 200], syms)).toBeNull();
    const got = findSimilar(ex, syms, [[300, 104]]);
    expect(got.map((s) => s.centre)).toEqual([[500, 50]]);
  });
});
