// Member data contract, schema_version 0 (docs/SPEC.md section 5).
//
// The Zod schemas here are the single source of truth: TypeScript types are inferred from them
// and schema/contract.v0.schema.json is generated from them. The contract is versioned and is
// expected to change; bump SCHEMA_VERSION with a migration when it does.
//
// Rules encoded here:
//  * Unknown values are explicit nulls, never defaults. Material and grade are never defaulted.
//  * Objects are strict: unknown keys are rejected.
//  * Grid labels and other identifiers are exact strings. No trimming or Unicode normalization,
//    so look-alike characters (for example Cyrillic \u0410 U+0410 vs Latin A) stay distinct.
//  * Lengths and elevations are millimetres. Computed values (length, weight, cost) are not part
//    of the contract; they are derived from the catalog and rules.
import { z } from 'zod';

export const SCHEMA_VERSION = 0 as const;

const confidence = z.number().min(0).max(1);

/** Rectangle in page coordinates. The coordinate system is defined when extraction is built. */
export const bboxSchema = z.strictObject({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

export const memberTypeSchema = z.enum(['beam', 'column', 'brace', 'joist', 'other']);
export const statusColorSchema = z.enum(['green', 'amber', 'red']);
export const reviewStatusSchema = z.enum(['unreviewed', 'approved', 'edited', 'rejected']);
export const sheetKindSchema = z.enum(['plan', 'schedule', 'detail', 'notes', 'other']);
export const buildStatusSchema = z.enum(['not_built', 'building', 'built', 'failed']);

export const xyzSchema = z.tuple([z.number(), z.number(), z.number()]);

/** One end of a member. Elevation is required at BOTH ends by the validator (members can slope). */
export const endpointSchema = z.strictObject({
  grid_x: z.string().min(1).nullable(),
  grid_y: z.string().min(1).nullable(),
  offset_x_mm: z.number().nullable(),
  offset_y_mm: z.number().nullable(),
  elevation_mm: z.number().nullable(),
  resolved_xyz_mm: xyzSchema.nullable(),
  resolution_method: z.string().nullable(),
});

export const sourceRefSchema = z.strictObject({
  sheet_id: z.string().nullable(),
  bbox: bboxSchema.nullable(),
  callout_ref: z.string().nullable(),
});

export const reviewEditSchema = z.strictObject({
  field: z.string().min(1),
  original_value: z.unknown(),
  corrected_value: z.unknown(),
  reviewer: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
});

export const memberSchema = z.strictObject({
  member_id: z.string().min(1),
  type: memberTypeSchema,
  mark: z.string().nullable(),
  profile_raw: z.string().nullable(), // exactly as on the drawing
  profile: z.string().nullable(), // normalized catalog name, null if unresolved
  material: z.string().nullable(), // explicit, never defaulted
  grade: z.string().nullable(), // explicit, never defaulted
  start: endpointSchema,
  end: endpointSchema,
  level: z.string().nullable(),
  rotation_deg: z.number().nullable(),
  camber_raw: z.string().nullable(),
  camber_mm: z.number().nullable(),
  studs: z.number().int().min(0).nullable(),
  quantity: z.number().int().positive(),
  supported_by: z.array(z.string().min(1)), // stable member_ids
  connection_hint: z
    .strictObject({ type: z.string().nullable(), raw_text: z.string().nullable() })
    .nullable(),
  coating: z.string().nullable(),
  source: sourceRefSchema.extend({ fields: z.record(z.string(), sourceRefSchema) }),
  confidence: z.strictObject({
    overall: confidence.nullable(),
    fields: z.record(z.string(), confidence),
  }),
  status: z.strictObject({ color: statusColorSchema.nullable(), reason: z.string().nullable() }),
  review: z.strictObject({ status: reviewStatusSchema, edits: z.array(reviewEditSchema) }),
});

export const gridSchema = z.strictObject({
  axis: z.enum(['x', 'y']),
  label: z.string().min(1), // exact characters, may be non-Latin
  position_mm: z.number(),
});

export const levelSchema = z.strictObject({ name: z.string().min(1), elevation_mm: z.number() });

export const sheetSchema = z.strictObject({
  sheet_id: z.string().min(1),
  sheet_number: z.string().nullable(),
  title: z.string().nullable(),
  kind: sheetKindSchema,
  page_index: z.number().int().min(0),
  scale: z.strictObject({
    parsed: z.string().nullable(),
    override: z.string().nullable(),
    source: z.string().nullable(),
  }),
  tos_notes: z.string().nullable(),
  crop_region: bboxSchema.nullable(),
  build_status: buildStatusSchema,
  built_at: z.iso.datetime({ offset: true }).nullable(),
});

export const projectSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  project_id: z.string().min(1),
  name: z.string().min(1),
  number: z.string().nullable(),
  status: z.string().min(1),
  design_standard: z.string().min(1),
  unit_system: z.literal('mm'), // canonical internal unit; display strings are kept separately
  location: z.string().nullable(),
  grids: z.array(gridSchema),
  levels: z.array(levelSchema),
  drawing_issue: z.string().nullable(),
});

/** Top-level contract document: project-level fields plus all sheets and members. */
export const contractDocumentSchema = projectSchema.extend({
  sheets: z.array(sheetSchema),
  members: z.array(memberSchema),
});

export type MemberType = z.infer<typeof memberTypeSchema>;
export type StatusColor = z.infer<typeof statusColorSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ContractDocument = z.infer<typeof contractDocumentSchema>;
