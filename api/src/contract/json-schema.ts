import { z } from 'zod';
import { contractDocumentSchema } from './schema.js';

/** JSON Schema (draft 2020-12) for the v0 contract document, as stable pretty-printed text. */
export function contractJsonSchemaText(): string {
  const schema = z.toJSONSchema(contractDocumentSchema, { target: 'draft-2020-12' });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
