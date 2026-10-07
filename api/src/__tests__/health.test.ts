import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection } from '../db/client.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

describe('GET /health', () => {
  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('returns 200 and db connected against the real database (requires `make up`)', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 503 without leaking the error when the database check fails', async () => {
    const app = buildApp({
      healthOptions: { checkDb: async () => ({ ok: false, error: 'connection refused' }) },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', db: 'disconnected' });
    expect(res.body).not.toContain('connection refused');
  });
});
