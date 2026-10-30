// Phase 14b/14c Find similar, pure (SYNTHETIC): the shared cases also run by the worker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  exampleName,
  findSimilar,
  sameKind,
  SYMBOL_FAMILIES,
  symbolAt,
  type StoredSymbol,
} from '../review/find-similar.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
type Case = {
  example: Pick<StoredSymbol, 'family' | 'real_in' | 'solid'>;
  symbol: Pick<StoredSymbol, 'family' | 'real_in' | 'solid'>;
  match: boolean;
};
const shared = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures/synthetic/find-similar-cases.json'), 'utf8'),
) as { cases: Case[]; solid_click_cases: Case[] };
const cases = shared.cases;

const sym = (
  x: number,
  y: number,
  family = 'hss_square',
  real: [number, number] = [12, 12],
  solid: StoredSymbol['solid'] = null,
) =>
  ({
    family,
    box: [x - 4, y - 4, x + 4, y + 4],
    centre: [x, y],
    rotation_deg: 0,
    real_in: real,
    solid,
  }) as StoredSymbol;

describe('find similar', () => {
  it('agrees with the worker on the shared cases', () => {
    for (const c of cases) expect(sameKind(c.symbol, c.example), JSON.stringify(c)).toBe(c.match);
    for (const c of shared.solid_click_cases)
      expect(sameKind(c.symbol, c.example, true), JSON.stringify(c)).toBe(c.match);
  });

  it('knows only the five column families', () => {
    expect([...SYMBOL_FAMILIES]).toEqual([
      'w_shape',
      'w_cover_plates',
      'hss_square',
      'hss_rect',
      'hss_round',
    ]);
  });

  it('a solid shape under a drawn column is an example for the same solid shape and size only', () => {
    const syms = [
      sym(100, 100, 'unknown', [12, 12], 'square'),
      sym(300, 100, 'unknown', [12, 12], 'square'),
      sym(500, 100, 'unknown', [8, 8], 'square'), // another size
      sym(700, 100, 'unknown', [12, 12], 'round'), // another shape
      sym(900, 100), // a hollow square
    ];
    const ex = symbolAt([101, 100], syms)!;
    expect(exampleName(ex)).toBe('solid_square');
    expect(findSimilar(ex, syms, []).map((s) => s.centre)).toEqual([[300, 100]]);
    // a known family under the column wins over a nearer solid shape
    const mixed = [sym(100, 100, 'unknown', [12, 12], 'square'), sym(108, 100)];
    expect(symbolAt([100, 100], mixed)!.family).toBe('hss_square');
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
