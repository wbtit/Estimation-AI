// Loads the synthetic fixtures under fixtures/synthetic (made-up data only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Member } from '../contract/index.js';
import { makeMember, type MemberOverrides } from './member-factory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SYNTHETIC_DIR = path.resolve(here, '../../../fixtures/synthetic');
export const SYNTHETIC_CATALOG_CSV = path.join(SYNTHETIC_DIR, 'catalog-test.csv');
export const SYNTHETIC_CATALOG_EDITION = 'TEST-EDITION';

export interface SyntheticProject {
  name: string;
  number: string;
  status: string;
  design_standard: string;
  location: string | null;
  drawing_issue: string | null;
  grids: { axis: 'x' | 'y'; label: string; position_mm: number }[];
  levels: { name: string; elevation_mm: number }[];
}

export function loadSyntheticMembers(): { project: SyntheticProject; members: Member[] } {
  const raw = JSON.parse(
    fs.readFileSync(path.join(SYNTHETIC_DIR, 'members.synthetic.json'), 'utf8'),
  ) as {
    project: SyntheticProject;
    members: MemberOverrides[];
  };
  return { project: raw.project, members: raw.members.map((o) => makeMember(o)) };
}
