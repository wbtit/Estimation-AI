// The kind list of the palette and the properties panel: GET /api/member-kinds.
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection } from '../db/client.js';

const app = buildApp();

afterAll(async () => {
  await closeDatabaseConnection();
});

describe('member kinds', () => {
  it('lists the 38 kinds for the dropdown, main first', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/member-kinds' })).json();
    expect(res.kinds).toHaveLength(38);
    expect(res.kinds[0]).toMatchObject({ kind: 'Column', scope: 'main' });
    expect(res.kinds.at(-1)).toMatchObject({ kind: 'Other trades', scope: 'excluded' });
  });
});
