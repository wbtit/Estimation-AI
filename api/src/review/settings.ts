// Phase 14d global settings (environment), recorded on each Build and each Find similar run.
//   COLUMN_MODE          click_first (default): a column-plan Build makes no automatic columns;
//                        glyph: the old glyph / grid / base-plate rules.
//   FIND_SIMILAR_IMAGE   on / 1 / true: Find similar runs the worker's image search (vector + image
//                        matches; docs/PHASE14D_PREREGISTRATION.md); default off (vector only).

export const COLUMN_MODES = ['click_first', 'glyph'] as const;
export type ColumnMode = (typeof COLUMN_MODES)[number];

export function columnMode(env: NodeJS.ProcessEnv = process.env): ColumnMode {
  const v = (env.COLUMN_MODE ?? '').trim() || 'click_first';
  if (!(COLUMN_MODES as readonly string[]).includes(v))
    throw new Error(`unknown COLUMN_MODE ${JSON.stringify(v)}`);
  return v as ColumnMode;
}

export function findSimilarImage(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'on', 'true', 'yes'].includes((env.FIND_SIMILAR_IMAGE ?? '').trim().toLowerCase());
}
