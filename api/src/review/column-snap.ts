// Phase 0-14g: the Draw column snap radius, ONE value shared with the web (sent by GET .../column-
// symbols) and the worker (col_image.SNAP_RADIUS_PT): schema/column-snap.json at the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/column-snap.json',
);

/** Page points: a stored symbol this close to a click is the column's symbol. */
export const SNAP_RADIUS_PT: number = (() => {
  const v = (JSON.parse(fs.readFileSync(file, 'utf8')) as { snap_radius_pt: unknown })
    .snap_radius_pt;
  if (typeof v !== 'number' || !(v > 0)) throw new Error(`${file}: snap_radius_pt must be > 0`);
  return v;
})();

/** How a column placement was snapped (logged with the placement). */
export const SNAP_SOURCES = ['symbol', 'ink', 'line', 'none', 'shift_off'] as const;
export type SnapSource = (typeof SNAP_SOURCES)[number];
