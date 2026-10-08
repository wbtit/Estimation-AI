// Material / grade by shape family, SET BY A PERSON (Phase 5b item 6). The table starts empty and
// nothing here ever fills it in: no default, no inference. The takeoff shows "not set" until a
// person types a grade for a family. Append-only: the latest row per family wins; null clears.
import type { Kysely } from 'kysely';
import { SHAPE_FAMILIES, type Database, type ShapeFamily } from '../db/types.js';
import type { MemberView } from './members.js';
import { parseProfile } from './profile.js';

export interface GradeRule {
  family: ShapeFamily;
  grade: string;
  set_by: string;
  set_at: string;
}

export const GRADE_NOT_SET = 'not set';

/** The shape family of a member ("joist" for joists), or null when the profile is not parsed. */
export function familyOf(m: Pick<MemberView, 'type' | 'profile'>): ShapeFamily | null {
  if (m.type === 'joist') return 'joist';
  const parsed = m.profile ? parseProfile(m.profile) : null;
  const family = parsed?.family ?? null;
  return family !== null && (SHAPE_FAMILIES as readonly string[]).includes(family)
    ? (family as ShapeFamily)
    : null;
}

export async function loadGrades(
  db: Kysely<Database>,
  projectId: string,
): Promise<Map<ShapeFamily, GradeRule>> {
  const rows = await db
    .selectFrom('project_grade_rules')
    .select(['shape_family', 'grade', 'set_by', 'set_at'])
    .where('project_id', '=', projectId)
    .orderBy('set_at')
    .orderBy('id')
    .execute();
  const out = new Map<ShapeFamily, GradeRule>();
  for (const r of rows) {
    if (r.grade === null) out.delete(r.shape_family);
    else
      out.set(r.shape_family, {
        family: r.shape_family,
        grade: r.grade,
        set_by: r.set_by,
        set_at: new Date(r.set_at as unknown as string).toISOString(),
      });
  }
  return out;
}

export async function setGrade(
  db: Kysely<Database>,
  projectId: string,
  family: ShapeFamily,
  grade: string | null,
  who: string,
): Promise<void> {
  await db
    .insertInto('project_grade_rules')
    .values({
      project_id: projectId,
      shape_family: family,
      grade: grade === null || grade.trim() === '' ? null : grade.trim(),
      set_by: who.trim(),
    })
    .execute();
}
