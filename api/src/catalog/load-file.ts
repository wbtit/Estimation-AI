import {
  parseCatalogTable,
  type CatalogColumns,
  type ParsedShape,
  type RowError,
} from './parse.js';
import { readTable, type ReadTableOptions } from './table.js';

export type LoadCatalogOptions = ReadTableOptions & { columns: CatalogColumns };

/** Reads and validates a catalog file. Callers must refuse the file if `errors` is non-empty. */
export async function loadCatalogFile(
  filePath: string,
  options: LoadCatalogOptions,
): Promise<{ shapes: ParsedShape[]; errors: RowError[] }> {
  const table = await readTable(filePath, options);
  return parseCatalogTable(table, options.columns);
}
