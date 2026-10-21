import { describe, expect, it } from 'vitest';
import {
  cardCounts,
  sortByLastOpened,
  thumbnailSheet,
  type CardSheet,
} from '../review/project-cards.js';

const sheet = (page_index: number, o: Partial<CardSheet> = {}): CardSheet => ({
  id: `s${page_index}`,
  page_index,
  thumbnail_path: `t/${page_index}.png`,
  page_type_guess: null,
  behaviour: null,
  built: false,
  reviewed: false,
  ...o,
});

describe('project cards', () => {
  it('the picture is the first plan page, not the cover sheet', () => {
    const sheets = [
      sheet(0, { page_type_guess: 'general_notes', behaviour: 'none' }),
      sheet(3, { behaviour: 'framing' }),
      sheet(2, { behaviour: 'column_plan' }),
    ];
    expect(thumbnailSheet(sheets)?.page_index).toBe(2);
  });

  it('without a plan role it takes a plan page type guess, else page 1', () => {
    expect(
      thumbnailSheet([sheet(0), sheet(4, { page_type_guess: 'framing_plan' })])?.page_index,
    ).toBe(4);
    expect(thumbnailSheet([sheet(1), sheet(0)])?.page_index).toBe(0);
    // a plan page without a thumbnail is skipped
    expect(
      thumbnailSheet([sheet(0), sheet(2, { behaviour: 'framing', thumbnail_path: null })])
        ?.page_index,
    ).toBe(0);
    expect(thumbnailSheet([])).toBeNull();
  });

  it('counts plans, built and reviewed pages', () => {
    expect(
      cardCounts([
        sheet(0, { behaviour: 'none', reviewed: true }),
        sheet(1, { behaviour: 'framing', built: true, reviewed: true }),
        sheet(2, { behaviour: 'column_plan', built: true }),
        sheet(3, { behaviour: 'framing' }),
      ]),
    ).toEqual({ plans: 3, built: 2, reviewed: 2 });
  });

  it('sorts by last opened, else created, newest first', () => {
    const ps = [
      { name: 'a', created_at: '2026-10-01T00:00:00Z', last_opened_at: null },
      { name: 'b', created_at: '2026-09-01T00:00:00Z', last_opened_at: '2026-10-20T00:00:00Z' },
      { name: 'c', created_at: '2026-10-10T00:00:00Z', last_opened_at: null },
    ];
    expect(sortByLastOpened(ps).map((p) => p.name)).toEqual(['b', 'c', 'a']);
  });
});
