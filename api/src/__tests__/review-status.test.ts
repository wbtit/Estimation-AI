import { describe, expect, it } from 'vitest';
import { REASONS, statusOf, type StatusInput } from '../review/status.js';

const base: StatusInput = {
  memberType: 'beam',
  linkConfidence: 'high',
  hasLine: true,
  humanConfirmed: false,
  profileParsed: true,
  profileOnLabel: true,
  markStatus: null,
};
const s = (over: Partial<StatusInput>) => statusOf({ ...base, ...over });

describe('color rules (Stage 1: identification only; length and scale are not part of it)', () => {
  it('green: high confidence, parsed profile, profile on the label', () => {
    expect(s({})).toEqual({ color: 'green', confirmed: false, reasons: [] });
  });

  it('green: high confidence, parsed profile, mark linked to a legend row', () => {
    expect(s({ profileOnLabel: false, markStatus: 'linked' }).color).toBe('green');
  });

  it('amber: medium confidence', () => {
    expect(s({ linkConfidence: 'medium' })).toMatchObject({
      color: 'amber',
      reasons: [REASONS.confidenceMedium],
    });
  });

  it('amber: high confidence with a missing piece (profile not parsed, or mark not linked)', () => {
    expect(s({ profileParsed: false })).toMatchObject({
      color: 'amber',
      reasons: [REASONS.profileNotParsed],
    });
    expect(s({ profileOnLabel: false, markStatus: 'no_legend_row' })).toMatchObject({
      color: 'amber',
      reasons: [REASONS.markNotLinked],
    });
    expect(s({ profileOnLabel: false, markStatus: null }).color).toBe('amber');
  });

  it('red: low confidence or an ambiguous mark; nothing about the scale or the length', () => {
    expect(s({ linkConfidence: 'low' })).toMatchObject({
      color: 'red',
      reasons: [REASONS.confidenceLow],
    });
    expect(s({ markStatus: 'ambiguous', profileOnLabel: false }).reasons).toEqual([
      REASONS.markAmbiguous,
    ]);
  });

  it('red conditions are listed together', () => {
    const r = s({ linkConfidence: 'low', markStatus: 'ambiguous', profileOnLabel: false });
    expect(r.color).toBe('red');
    expect(r.reasons).toEqual([REASONS.confidenceLow, REASONS.markAmbiguous]);
  });

  it('a person confirming turns a medium or low proposal green, but not an ambiguous mark', () => {
    expect(s({ humanConfirmed: true, linkConfidence: 'medium' })).toEqual({
      color: 'green',
      confirmed: true,
      reasons: [],
    });
    expect(s({ humanConfirmed: true, linkConfidence: 'low' }).color).toBe('green');
    expect(s({ humanConfirmed: true, profileParsed: false }).color).toBe('green');
    expect(s({ humanConfirmed: true, markStatus: 'ambiguous' }).color).toBe('red');
  });

  it('unlinked: a profile label with no candidate line is not a red member', () => {
    expect(s({ linkConfidence: 'low', hasLine: false })).toEqual({
      color: 'unlinked',
      confirmed: false,
      reasons: [REASONS.noLine],
    });
    expect(s({ hasLine: false, humanConfirmed: true }).color).toBe('unlinked');
  });

  it('a typed length makes a label without a line a member (green once a person set it)', () => {
    expect(s({ hasLine: false, manualLength: true, humanConfirmed: true })).toEqual({
      color: 'green',
      confirmed: true,
      reasons: [],
    });
  });

  it('a link fixed by hand has no proposal confidence but is green', () => {
    expect(s({ humanConfirmed: true, linkConfidence: null }).color).toBe('green');
  });

  it('columns need no line and no elevations in Stage 1', () => {
    const col = {
      memberType: 'column',
      linkConfidence: null,
      hasLine: false,
      humanConfirmed: true,
    } as const;
    expect(s({ ...col }).color).toBe('green');
    expect(s({ ...col }).reasons).not.toContain(REASONS.noLine);
  });
});

describe('kind doubts', () => {
  it('an ambiguous kind makes a sure member amber until a person chooses', () => {
    expect(s({ kind: { state: 'ambiguous', weak: true } })).toMatchObject({
      color: 'amber',
      reasons: [REASONS.kindAmbiguous],
    });
    expect(s({ kind: { state: 'ambiguous', weak: true }, humanConfirmed: true }).color).toBe(
      'green',
    );
  });

  it("a kind guessed from the label's own line does not change the colour, a weaker one does", () => {
    expect(s({ kind: { state: 'guessed', weak: false } }).color).toBe('green');
    expect(s({ kind: { state: 'guessed', weak: true } })).toMatchObject({
      color: 'amber',
      reasons: [REASONS.kindWeak],
    });
  });

  it('a missing kind is a grey symbol and a flag, not a change of the confidence colour', () => {
    expect(s({ kind: { state: 'missing', weak: true } }).color).toBe('green');
    expect(s({ kind: { state: 'confirmed', weak: false } }).color).toBe('green');
  });
});
