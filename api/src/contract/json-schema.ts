import { z } from 'zod';
import { contractDocumentSchema, contractDocumentSchemaV0 } from './schema.js';

/** JSON Schema (draft 2020-12) for the current (v1) contract document, as stable pretty-printed text. */
export function contractJsonSchemaText(): string {
  const schema = z.toJSONSchema(contractDocumentSchema, { target: 'draft-2020-12' });
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/** The same for the frozen version 0 document. */
export function contractJsonSchemaTextV0(): string {
  const schema = z.toJSONSchema(contractDocumentSchemaV0, { target: 'draft-2020-12' });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
