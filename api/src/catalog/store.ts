import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { CatalogIndex } from '../validator/index.js';
import type { ParsedShape } from './parse.js';

export class CatalogEditionExistsError extends Error {
  constructor(edition: string) {
    super(`catalog edition "${edition}" already exists; editions are immutable, use a new label`);
  }
}

const BATCH_SIZE = 500;

/** Stores shapes under an edition label in one transaction. Existing editions are never modified. */
export async function importCatalog(
  db: Kysely<Database>,
  edition: string,
  shapes: readonly ParsedShape[],
): Promise<number> {
  const label = edition.trim();
  if (label === '') throw new Error('edition label must not be empty');
  if (shapes.length === 0) throw new Error('no shapes to import');
  for (const s of shapes) {
    if (!(s.weight_kg_per_m > 0)) throw new Error(`weight must be > 0 for "${s.shape_name}"`);
  }

  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('catalog_shapes')
      .select('id')
      .where('edition', '=', label)
      .limit(1)
      .executeTakeFirst();
    if (existing) throw new CatalogEditionExistsError(label);

    for (let i = 0; i < shapes.length; i += BATCH_SIZE) {
      await trx
        .insertInto('catalog_shapes')
        .values(
          shapes.slice(i, i + BATCH_SIZE).map((s) => ({
            edition: label,
            shape_name: s.shape_name,
            family: s.family,
            weight_kg_per_m: s.weight_kg_per_m,
            weight_lb_per_ft: s.weight_lb_per_ft,
            properties: JSON.stringify(s.properties),
          })),
        )
        .execute();
    }
  });
  return shapes.length;
}

/** Loads one edition as a name -> weight index, or null if the edition has no rows. */
export async function loadCatalogIndex(
  db: Kysely<Database>,
  edition: string,
): Promise<CatalogIndex | null> {
  const rows = await db
    .selectFrom('catalog_shapes')
    .select(['shape_name', 'weight_kg_per_m'])
    .where('edition', '=', edition)
    .execute();
  if (rows.length === 0) return null;
  return new Map(
    rows.map((r) => [
      r.shape_name,
      { shape_name: r.shape_name, weight_kg_per_m: Number(r.weight_kg_per_m) },
    ]),
  );
}
