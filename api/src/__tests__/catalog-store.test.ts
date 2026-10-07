import { afterAll, describe, expect, it } from 'vitest';
import { parseCatalogTable } from '../catalog/parse.js';
import { CatalogEditionExistsError, importCatalog, loadCatalogIndex } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteEdition, uniqueLabel } from './helpers.js';

const editions: string[] = [];
function newEdition(): string {
  const label = uniqueLabel('TEST-EDITION');
  editions.push(label);
  return label;
}

const { shapes } = parseCatalogTable(
  {
    headers: ['shape', 'lb_ft', 'comment'],
    rows: [
      { rowNumber: 2, values: ['TEST-101', '100', 'synthetic'] },
      { rowNumber: 3, values: ['TEST-102', '50', 'synthetic'] },
    ],
  },
  { name: 'shape', weight: 'lb_ft', weightUnit: 'lb/ft' },
);

describe('catalog store (real database)', () => {
  afterAll(async () => {
    for (const e of editions) await deleteEdition(getDb(), e);
    await closeDatabaseConnection();
  });

  it('imports an edition and loads it back as a weight index', async () => {
    const edition = newEdition();
    expect(await importCatalog(getDb(), edition, shapes)).toBe(2);

    const index = await loadCatalogIndex(getDb(), edition);
    expect(index?.size).toBe(2);
    expect(index?.get('TEST-101')?.weight_kg_per_m).toBeCloseTo(148.8163944, 6);
    expect(typeof index?.get('TEST-101')?.weight_kg_per_m).toBe('number');
  });

  it('stores both the source lb/ft weight and the kg/m weight, plus extra columns as JSON', async () => {
    const edition = newEdition();
    await importCatalog(getDb(), edition, shapes);
    const row = await getDb()
      .selectFrom('catalog_shapes')
      .selectAll()
      .where('edition', '=', edition)
      .where('shape_name', '=', 'TEST-102')
      .executeTakeFirstOrThrow();
    expect(Number(row.weight_lb_per_ft)).toBe(50);
    expect(Number(row.weight_kg_per_m)).toBeCloseTo(74.4081972, 6);
    expect(row.properties).toEqual({ comment: 'synthetic' });
    expect(row.family).toBe('TEST');
  });

  it('refuses to re-import an existing edition and leaves it untouched', async () => {
    const edition = newEdition();
    await importCatalog(getDb(), edition, shapes);
    await expect(importCatalog(getDb(), edition, [shapes[0]!])).rejects.toThrow(
      CatalogEditionExistsError,
    );
    expect((await loadCatalogIndex(getDb(), edition))?.size).toBe(2);
  });

  it('refuses a non-positive weight before writing anything', async () => {
    const edition = newEdition();
    const bad = { ...shapes[0]!, weight_kg_per_m: 0 };
    await expect(importCatalog(getDb(), edition, [shapes[1]!, bad])).rejects.toThrow(
      /weight must be > 0/,
    );
    expect(await loadCatalogIndex(getDb(), edition)).toBeNull();
  });

  it('the database itself also rejects a non-positive weight (CHECK constraint)', async () => {
    const edition = newEdition();
    await expect(
      getDb()
        .insertInto('catalog_shapes')
        .values({
          edition,
          shape_name: 'TEST-ZERO',
          family: 'TEST',
          weight_kg_per_m: 0,
          weight_lb_per_ft: null,
          properties: '{}',
        })
        .execute(),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects an empty label and an empty shape list; an unknown edition loads as null', async () => {
    await expect(importCatalog(getDb(), '   ', shapes)).rejects.toThrow(/edition label/);
    await expect(importCatalog(getDb(), newEdition(), [])).rejects.toThrow(/no shapes/);
    expect(await loadCatalogIndex(getDb(), uniqueLabel('NO-SUCH-EDITION'))).toBeNull();
  });
});
