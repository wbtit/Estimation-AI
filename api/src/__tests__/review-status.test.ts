import { describe, expect, it } from 'vitest';
import { REASONS, statusOf, type StatusInput } from '../review/status.js';

const base: StatusInput = {
  memberType: 'beam',
  linkConfidence: 'high',
  hasLine: true,
  humanConfirmed: false,
  scaleConfirmed: true,
  lengthMm: 3000,
  profileParsed: true,
  profileOnLabel: true,
  markStatus: null,
  columnBaseKnown: true,
};
const s = (over: Partial<StatusInput>) => statusOf({ ...base, ...over });

describe('color rules', () => {
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

  it('red: low confidence, no candidate, ambiguous mark, scale not confirmed, no length', () => {
    expect(s({ linkConfidence: 'low' })).toMatchObject({
      color: 'red',
      reasons: [REASONS.confidenceLow],
    });
    expect(s({ linkConfidence: 'low', hasLine: false, lengthMm: null })).toMatchObject({
      color: 'red',
      reasons: [REASONS.noLine],
    });
    expect(s({ markStatus: 'ambiguous', profileOnLabel: false }).reasons).toEqual([
      REASONS.markAmbiguous,
    ]);
    expect(s({ scaleConfirmed: false, lengthMm: null })).toMatchObject({
      color: 'red',
      reasons: [REASONS.scaleNotConfirmed],
    });
    expect(s({ lengthMm: null })).toMatchObject({ color: 'red', reasons: [REASONS.noLength] });
  });

  it('red conditions are listed together', () => {
    const r = s({ linkConfidence: 'low', scaleConfirmed: false, lengthMm: null });
    expect(r.color).toBe('red');
    expect(r.reasons).toEqual([REASONS.scaleNotConfirmed, REASONS.confidenceLow]);
  });

  it('a person confirming turns a medium or low proposal green, but not a missing scale or length', () => {
    expect(s({ humanConfirmed: true, linkConfidence: 'medium' })).toEqual({
      color: 'green',
      confirmed: true,
      reasons: [],
    });
    expect(s({ humanConfirmed: true, linkConfidence: 'low' }).color).toBe('green');
    expect(s({ humanConfirmed: true, profileParsed: false }).color).toBe('green');
    expect(s({ humanConfirmed: true, scaleConfirmed: false, lengthMm: null }).color).toBe('red');
    expect(s({ humanConfirmed: true, markStatus: 'ambiguous' }).color).toBe('red');
    expect(s({ humanConfirmed: true, hasLine: false, lengthMm: null }).color).toBe('red');
  });

  it('a link fixed by hand has no proposal confidence but is green', () => {
    expect(s({ humanConfirmed: true, linkConfidence: null }).color).toBe('green');
  });

  it('columns: no line needed, red without a determinable base elevation, green with one', () => {
    const col = {
      memberType: 'column',
      linkConfidence: null,
      hasLine: false,
      humanConfirmed: true,
      lengthMm: 4000,
    } as const;
    expect(s({ ...col, columnBaseKnown: true }).color).toBe('green');
    expect(s({ ...col, columnBaseKnown: false, lengthMm: null })).toMatchObject({
      color: 'red',
      reasons: [REASONS.columnBase],
    });
    // a column is never red for lacking a candidate line
    expect(s({ ...col }).reasons).not.toContain(REASONS.noLine);
  });
});
