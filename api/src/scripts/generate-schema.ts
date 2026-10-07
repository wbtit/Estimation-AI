// Writes schema/contract.v0.schema.json from the Zod contract. Run: npm run schema:generate
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractJsonSchemaText } from '../contract/json-schema.js';

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/contract.v0.schema.json',
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, contractJsonSchemaText());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
