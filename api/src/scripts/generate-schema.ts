// Writes schema/contract.v1.schema.json (current) and contract.v0.schema.json (frozen) from the Zod
// contract. Run: npm run schema:generate
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractJsonSchemaText, contractJsonSchemaTextV0 } from '../contract/json-schema.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schema');
fs.mkdirSync(dir, { recursive: true });
for (const [name, text] of [
  ['contract.v1.schema.json', contractJsonSchemaText()],
  ['contract.v0.schema.json', contractJsonSchemaTextV0()],
] as const) {
  fs.writeFileSync(path.join(dir, name), text);
  console.log(`wrote ${path.relative(process.cwd(), path.join(dir, name))}`);
}
