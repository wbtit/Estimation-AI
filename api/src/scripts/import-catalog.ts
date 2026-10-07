// Imports an AISC-style shapes file into catalog_shapes under an edition label.
//   npm run catalog:import -- --file <path.csv|xlsx> --edition <label> \
//     --name-col <header> --weight-col <header> --weight-unit <lb/ft|kg/m> [--family-col <header>] \
//     [--sheet <name>] [--header-row <n>]
// Nothing is guessed: the columns and the weight unit must be given. The whole file is refused if
// any row is invalid (weight must be > 0, names unique).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { CatalogColumnError, type WeightUnit } from '../catalog/parse.js';
import { loadCatalogFile } from '../catalog/load-file.js';
import { importCatalog } from '../catalog/store.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const USAGE =
  'usage: npm run catalog:import -- --file <path> --edition <label> --name-col <header> ' +
  '--weight-col <header> --weight-unit <lb/ft|kg/m> [--family-col <header>] [--sheet <name>] [--header-row <n>]';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      edition: { type: 'string' },
      'name-col': { type: 'string' },
      'weight-col': { type: 'string' },
      'weight-unit': { type: 'string' },
      'family-col': { type: 'string' },
      sheet: { type: 'string' },
      'header-row': { type: 'string' },
    },
  });

  const unit = values['weight-unit'];
  if (
    !values.file ||
    !values.edition ||
    !values['name-col'] ||
    !values['weight-col'] ||
    (unit !== 'lb/ft' && unit !== 'kg/m')
  ) {
    console.error(USAGE);
    return 1;
  }

  let loaded;
  try {
    loaded = await loadCatalogFile(values.file, {
      sheet: values.sheet,
      headerRow: values['header-row'] ? Number(values['header-row']) : undefined,
      columns: {
        name: values['name-col'],
        weight: values['weight-col'],
        weightUnit: unit as WeightUnit,
        family: values['family-col'],
      },
    });
  } catch (err) {
    console.error(err instanceof CatalogColumnError || err instanceof Error ? err.message : err);
    return 1;
  }

  if (loaded.errors.length > 0) {
    console.error(`refusing to import: ${loaded.errors.length} invalid row(s)`);
    for (const e of loaded.errors.slice(0, 50)) {
      console.error(`  row ${e.row}${e.shape_name ? ` (${e.shape_name})` : ''}: ${e.message}`);
    }
    return 1;
  }

  const count = await importCatalog(getDb(), values.edition, loaded.shapes);
  console.log(`imported ${count} shapes into edition "${values.edition.trim()}"`);
  return 0;
}

main()
  .then(async (code) => {
    await closeDatabaseConnection();
    process.exit(code);
  })
  .catch(async (err: Error) => {
    console.error(err.message);
    await closeDatabaseConnection();
    process.exit(1);
  });
