import { describe, expect, it } from 'vitest';
import { parseTagText } from '../review/member-ops.js';

describe('tags', () => {
  it('parses a tag as letters and a number', () => {
    expect(parseTagText('B7')).toEqual({ prefix: 'B', number: 7 });
    expect(parseTagText(' hss12 ')).toEqual({ prefix: 'hss', number: 12 });
    expect(parseTagText('7')).toEqual({ prefix: null, number: 7 });
    expect(parseTagText('B')).toBeNull();
    expect(parseTagText('B-7')).toBeNull();
    expect(parseTagText('')).toBeNull();
  });
});
