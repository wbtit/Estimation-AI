// Loads the SYNTHETIC demo project (14 made-up members) and the TEST-xxx catalog edition into the
// local database so the validate/BOM/Excel endpoints can be tried. Run: npm run seed:synthetic
//   --reset   delete the synthetic project (and only it) first, then recreate it
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { loadCatalogFile } from '../catalog/load-file.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { memberToInsertRow } from '../members/rows.js';
import {
  loadSyntheticMembers,
  SYNTHETIC_CATALOG_CSV,
  SYNTHETIC_CATALOG_EDITION,
} from '../synthetic/fixture.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { reset: { type: 'boolean' } } });
  const db = getDb();
  const { project, members } = loadSyntheticMembers();

  const catalogExists = await db
    .selectFrom('catalog_shapes')
    .select('id')
    .where('edition', '=', SYNTHETIC_CATALOG_EDITION)
    .limit(1)
    .executeTakeFirst();
  if (!catalogExists) {
    const loaded = await loadCatalogFile(SYNTHETIC_CATALOG_CSV, {
      columns: { name: 'shape', family: 'family', weight: 'weight_kg_per_m', weightUnit: 'kg/m' },
    });
    if (loaded.errors.length > 0)
      throw new Error(`synthetic catalog invalid: ${JSON.stringify(loaded.errors)}`);
    await importCatalog(db, SYNTHETIC_CATALOG_EDITION, loaded.shapes);
    console.log(`imported synthetic catalog edition "${SYNTHETIC_CATALOG_EDITION}"`);
  }

  const existing = await db
    .selectFrom('projects')
    .select('id')
    .where('name', '=', project.name)
    .where('number', '=', project.number)
    .executeTakeFirst();
  if (existing && !values.reset) {
    console.log(`synthetic project already exists: ${existing.id} (use --reset to recreate)`);
    return;
  }
  if (existing) await db.deleteFrom('projects').where('id', '=', existing.id).execute();

  const created = await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('projects')
      .values({
        name: project.name,
        number: project.number,
        status: project.status,
        location: project.location,
        drawing_issue: project.drawing_issue,
        grids: JSON.stringify(project.grids),
        levels: JSON.stringify(project.levels),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('members')
      .values(members.map((m) => memberToInsertRow(row.id, m, { origin: 'seed' })))
      .execute();
    return row.id;
  });

  console.log(`created synthetic project ${created} with ${members.length} members`);
  console.log(
    `try: curl "http://127.0.0.1:3000/api/projects/${created}/bom?edition=${SYNTHETIC_CATALOG_EDITION}"`,
  );
}

main()
  .then(async () => {
    await closeDatabaseConnection();
  })
  .catch(async (err: Error) => {
    console.error(err.message);
    await closeDatabaseConnection();
    process.exit(1);
  });
