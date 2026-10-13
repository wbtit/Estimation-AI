import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { countingOf, loadKinds, parseAbbreviationCsv, typeOfKind } from '../review/kinds.js';

describe('member kinds table', () => {
  afterAll(() => closeDatabaseConnection());

  it('holds the 21 main, 12 misc and 3 excluded kinds with distinct tag prefixes', async () => {
    const kinds = await loadKinds(getDb());
    const by = (s: string) => [...kinds.values()].filter((k) => k.scope === s);
    expect([by('main').length, by('misc').length, by('excluded').length]).toEqual([21, 12, 3]);
    expect(new Set([...kinds.values()].map((k) => k.prefix)).size).toBe(36);
    expect([...kinds.values()].every((k) => k.provisional)).toBe(true); // the owner's list is empty
    expect([...kinds.keys()].slice(0, 2)).toEqual(['Column', 'Beams']); // owner's order
  });

  it('derives the provisional prefix from the name (initials, two letters for one word)', async () => {
    const kinds = await loadKinds(getDb());
    const initials = (name: string) => {
      const words = name.split(/[^A-Za-z]+/).filter(Boolean);
      return (
        words.length === 1 ? words[0]!.slice(0, 2) : words.map((w) => w[0]).join('')
      ).toUpperCase();
    };
    for (const k of kinds.values()) expect(k.prefix).toBe(initials(k.kind));
  });

  it('follows the symbol group and keeps the type compatible', async () => {
    const kinds = await loadKinds(getDb());
    expect(kinds.get('Column')?.symbol_group).toBe('column');
    expect(kinds.get('Beams')?.symbol_group).toBe('linear');
    expect(kinds.get('Embed Plate/Bearing Plates')?.symbol_group).toBe('plate');
    expect(kinds.get('Truss')?.symbol_group).toBe('other');
    expect(kinds.get('Joist')?.symbol_group).toBe('none');
    expect(typeOfKind(kinds.get('Column'), 'beam')).toBe('column');
    expect(typeOfKind(kinds.get('Posts/Pipe'), 'beam')).toBe('column');
    expect(typeOfKind(kinds.get('Vertical Brace'), 'beam')).toBe('brace');
    expect(typeOfKind(kinds.get('Beams'), 'other')).toBe('beam');
    expect(typeOfKind(kinds.get('Joist'), 'beam')).toBe('joist');
    expect(typeOfKind(kinds.get('Hangers'), 'beam')).toBe('other');
    expect(typeOfKind(undefined, 'brace')).toBe('brace'); // no kind: the stored type stays
  });

  it('counts main kinds, reserves misc and lists excluded kinds apart', async () => {
    const kinds = await loadKinds(getDb());
    expect(countingOf(kinds.get('Beams'))).toBe('counted');
    expect(countingOf(undefined)).toBe('counted');
    expect(countingOf(kinds.get('Stair'))).toBe('misc_reserved');
    for (const k of ['Joist', 'Wall', 'Other trades'])
      expect(countingOf(kinds.get(k))).toBe('not_counted');
  });
});

describe('abbreviation CSV', () => {
  const known = new Set(['Column', 'Beams', 'Stair']);
  it('accepts kind,abbreviation rows and upper-cases the abbreviation', () => {
    const r = parseAbbreviationCsv('kind,abbreviation\nColumn,za1\n"Beams",zb2\n', known);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { kind: 'Column', abbreviation: 'ZA1' },
      { kind: 'Beams', abbreviation: 'ZB2' },
    ]);
  });
  it('refuses a wrong header, unknown or repeated kinds, repeats and bad characters', () => {
    expect(parseAbbreviationCsv('a,b\n', known).errors[0]).toMatch(/first row/);
    const r = parseAbbreviationCsv(
      'kind,abbreviation\nColumn,zz\nColumn,zy\nNope,zx\nBeams,zz\nStair,a b\nStair,\n',
      known,
    );
    expect(r.rows).toEqual([{ kind: 'Column', abbreviation: 'ZZ' }]);
    expect(r.errors.map((e) => e.replace(/^row \d+: /, ''))).toEqual([
      'kind "Column" appears twice',
      'unknown kind "Nope"',
      'abbreviation of "Beams" repeats that of "Column"',
      'abbreviation for "Stair" must be 1 to 8 letters, digits or -',
      'empty abbreviation for "Stair"',
    ]);
  });
});
