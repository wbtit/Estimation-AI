// Drawing spelling -> catalog shape. Deterministic and exact: case, spaces, "x" or the times sign,
// "WF" for "W", and a fraction against its decimal (1/4 = .250 = 0.25) are the only differences
// that are forgiven, and only by exact numeric equality (to 4 decimals). Nothing else is guessed.
// A name that two catalog shapes share after normalisation is reported as ambiguous, not chosen.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { numberValue, parseProfile } from '../review/profile.js';

const NUMERIC_FAMILIES = new Set(['W', 'M', 'S', 'HP', 'C', 'MC', 'L', 'WT', 'MT', 'ST', 'HSS']);

export interface CatalogShape {
  shape_name: string;
  /** The catalog's own type column (W, HSS, L, 2L, C, ...), which is the workbook's SHAPE. */
  family: string;
  weight_lb_per_ft: number | null;
  weight_kg_per_m: number;
}

export type LookupResult =
  | { found: true; shape: CatalogShape; via: 'exact' | 'numeric' }
  | { found: false; reason: 'no_profile' | 'not_in_catalog' | 'ambiguous' };

/** Normalised key of a shape name; equal keys mean the same shape written differently. */
export function shapeKey(text: string): string {
  const p = parseProfile(text);
  if (p && NUMERIC_FAMILIES.has(p.family)) {
    const parts = p.canonical.slice(p.family.length).split('X');
    const nums = parts.map((x) => numberValue(x));
    if (nums.every((n): n is number => n !== null)) {
      return `${p.family}|${nums.map((n) => n.toFixed(4)).join('|')}`;
    }
  }
  return (p ? p.canonical : text)
    .toUpperCase()
    .replace(/[\s"']/g, '')
    .replace(/[\u00d7\u2715\u2716]/g, 'X');
}

export class CatalogLookup {
  private readonly exact = new Map<string, CatalogShape>();
  private readonly byKey = new Map<string, CatalogShape[]>();

  constructor(shapes: readonly CatalogShape[]) {
    for (const s of shapes) {
      this.exact.set(s.shape_name.toUpperCase().replace(/\s+/g, ''), s);
      const k = shapeKey(s.shape_name);
      this.byKey.set(k, [...(this.byKey.get(k) ?? []), s]);
    }
  }

  get size(): number {
    return this.exact.size;
  }

  find(text: string | null | undefined): LookupResult {
    if (text == null || text.trim() === '') return { found: false, reason: 'no_profile' };
    const direct = this.exact.get(text.toUpperCase().replace(/\s+/g, ''));
    if (direct) return { found: true, shape: direct, via: 'exact' };
    const hits = this.byKey.get(shapeKey(text)) ?? [];
    if (hits.length === 1) return { found: true, shape: hits[0] as CatalogShape, via: 'numeric' };
    return { found: false, reason: hits.length > 1 ? 'ambiguous' : 'not_in_catalog' };
  }
}

export async function loadCatalogLookup(
  db: Kysely<Database>,
  edition: string,
): Promise<CatalogLookup | null> {
  const rows = await db
    .selectFrom('catalog_shapes')
    .select(['shape_name', 'family', 'weight_lb_per_ft', 'weight_kg_per_m'])
    .where('edition', '=', edition)
    .execute();
  if (rows.length === 0) return null;
  return new CatalogLookup(
    rows.map((r) => ({
      shape_name: r.shape_name,
      family: r.family,
      weight_lb_per_ft: r.weight_lb_per_ft === null ? null : Number(r.weight_lb_per_ft),
      weight_kg_per_m: Number(r.weight_kg_per_m),
    })),
  );
}

const cache = new Map<string, CatalogLookup | null>();

/** The edition used by the review screen: CATALOG_EDITION, else the most recently imported one. */
export async function defaultCatalogEdition(db: Kysely<Database>): Promise<string | null> {
  if (process.env.CATALOG_EDITION) return process.env.CATALOG_EDITION;
  const row = await db
    .selectFrom('catalog_shapes')
    .select('edition')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.edition ?? null;
}

/** The lookup of the default edition; editions are immutable, so a loaded one is kept. */
export async function defaultCatalogLookup(db: Kysely<Database>): Promise<CatalogLookup | null> {
  const edition = await defaultCatalogEdition(db);
  if (edition === null) return null;
  const hit = cache.get(edition);
  if (hit !== undefined) return hit;
  const loaded = await loadCatalogLookup(db, edition);
  if (loaded) cache.set(edition, loaded);
  return loaded;
}
