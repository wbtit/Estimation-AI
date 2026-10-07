// Builds SYNTHETIC members for tests and the demo seed. Everything here is made up: the TEST-xxx
// profile names, the TEST-MAT / TEST-GRADE strings and the coordinates. It must never be used
// to stand in for real project data.
import type { Endpoint, Member } from '../contract/index.js';

export type EndpointOverrides = Partial<Endpoint>;
export type MemberOverrides = Partial<Omit<Member, 'start' | 'end'>> & {
  member_id: string;
  start?: EndpointOverrides;
  end?: EndpointOverrides;
};

export function makeEndpoint(overrides: EndpointOverrides = {}): Endpoint {
  return {
    grid_x: null,
    grid_y: null,
    offset_x_mm: null,
    offset_y_mm: null,
    elevation_mm: null,
    resolved_xyz_mm: null,
    resolution_method: null,
    ...overrides,
  };
}

/**
 * Valid-by-default synthetic beam: TEST-001, 6000 mm long at elevation 4000 mm, material and
 * grade set, no supports. Pass overrides to change or break individual fields.
 */
export function makeMember(overrides: MemberOverrides): Member {
  const { start, end, ...rest } = overrides;
  return {
    type: 'beam',
    mark: null,
    profile_raw: 'TEST-001',
    profile: 'TEST-001',
    material: 'TEST-MAT',
    grade: 'TEST-GRADE',
    start: makeEndpoint({
      grid_x: 'A',
      grid_y: '1',
      elevation_mm: 4000,
      resolved_xyz_mm: [0, 0, 4000],
      resolution_method: 'synthetic',
      ...start,
    }),
    end: makeEndpoint({
      grid_x: 'B',
      grid_y: '1',
      elevation_mm: 4000,
      resolved_xyz_mm: [6000, 0, 4000],
      resolution_method: 'synthetic',
      ...end,
    }),
    level: null,
    rotation_deg: null,
    camber_raw: null,
    camber_mm: null,
    studs: null,
    quantity: 1,
    supported_by: [],
    connection_hint: null,
    coating: null,
    source: { sheet_id: null, bbox: null, callout_ref: null, fields: {} },
    confidence: { overall: null, fields: {} },
    status: { color: null, reason: null },
    review: { status: 'unreviewed', edits: [] },
    ...rest,
  };
}
