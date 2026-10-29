// Session report from a frozen export (pure, SYNTHETIC data only).
import { describe, expect, it } from 'vitest';
import type { SnapshotPiece } from '../db/types.js';
import type { PieceView } from '../review/line-first-pieces.js';
import {
  comparePage,
  longGaps,
  ratio,
  sessionReport,
  type SessionExport,
} from '../review/session-report.js';

const sys = (id: string, page: [number, number, number, number], extra = {}): SnapshotPiece => ({
  member_id: id,
  kind: 'Beams',
  type: 'beam',
  tag: null,
  profile: 'W8X10',
  profile_raw: 'W8X10',
  page,
  start: null,
  end: null,
  length_mm: 1000,
  build_state: 'found',
  size_state: 'label',
  support_state: 'both',
  piece_index: 0,
  ...extra,
});
const col = (id: string, x: number, y: number) =>
  sys(id, [x, y, x, y], { kind: 'Column', type: 'column', length_mm: null });

const fin = (id: string, a: [number, number], b: [number, number] | null, extra = {}) =>
  ({
    id: `m-${id}`,
    member_id: id,
    sheet_id: 'S1',
    type: b ? 'beam' : 'column',
    kind: b ? 'Beams' : 'Column',
    tag: null,
    quantity: 1,
    profile: 'W8X10',
    profile_raw: 'W8X10',
    studs: null,
    camber_raw: null,
    ignored: false,
    approved: false,
    duplicate_of: null,
    excluded_kind: false,
    deleted: false,
    added: false,
    edited: false,
    a,
    b,
    ends_moved: false,
    length_mm: b ? 1000 : null,
    elevation_mm: null,
    build_state: 'found',
    size_state: 'label',
    support_state: 'both',
    piece_index: 0,
    scale_ratio: null,
    evidence: null,
    build_run_id: 'R1',
    build_view_id: null,
    start: null,
    end: null,
    ...extra,
  }) as PieceView;

describe('comparePage', () => {
  it('classifies kept, approved, deleted, size changed, kind changed and drawn pieces', () => {
    const system = [
      sys('B1', [0, 0, 100, 0]),
      sys('B2', [0, 50, 100, 50]),
      sys('B3', [0, 100, 100, 100]),
      sys('B4', [0, 150, 100, 150]),
      sys('B5', [0, 200, 100, 200]),
      col('C1', 500, 500),
    ];
    const final = [
      fin('B1', [0, 0], [100, 0]), // unchanged
      fin('B2', [0, 50], [100, 50], { approved: true }), // approved unchanged
      fin('B3', [0, 100], [100, 100], { deleted: true }), // false positive
      fin('B4', [0, 150], [100, 150], { profile: 'W10X12' }), // size changed
      fin('B5', [0, 200], [100, 200], { kind: 'Joist', ends_moved: true }), // kind changed
      fin('C1', [500, 500], null, { deleted: true }),
      fin('D1', [0, 300], [100, 300], { added: true }), // drawn = miss
      fin('D2', [0, 350], [100, 350], { added: true, deleted: true }), // drawn then deleted
      fin('D3', [600, 600], null, { added: true }),
    ];
    const { groups } = comparePage(system, final);
    expect(groups.beams).toMatchObject({
      system: 5,
      final: 5,
      kept: 4,
      unchanged: 3,
      approved_unchanged: 1,
      deleted: 1,
      drawn: 1,
      drawn_then_deleted: 1,
      size_changed: 1,
      kind_changed: 1,
      ends_moved: 1,
      positives: 5,
      negatives: 1,
    });
    expect(groups.columns).toMatchObject({
      system: 1,
      final: 1,
      kept: 0,
      deleted: 1,
      drawn: 1,
      positives: 1,
      negatives: 1,
    });
  });

  it('matches by geometry when a rebuild changed the ids', () => {
    const { groups } = comparePage([sys('B1', [0, 0, 100, 0])], [fin('X9', [2, 1], [98, 1])]);
    expect(groups.beams.kept).toBe(1);
    expect(groups.beams.drawn).toBe(0);
  });
});

const T0 = Date.parse('2026-01-05T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const S = 'sess-1';

function exportOf(over: Partial<SessionExport> = {}): SessionExport {
  const tag = { actor: 'estimator', session_id: S };
  return {
    manifest: { session_id: S, project_id: 'P', exported_at: at(4000) },
    work_sessions: [
      { id: S, project_id: 'P', actor: 'estimator', started_at: at(0), ended_at: at(3600) },
    ],
    count_actions: [
      { id: 1, ...tag, sheet_id: null, action: 'session', detail: null, created_at: at(0) },
      { id: 2, ...tag, sheet_id: 'S1', action: 'view', detail: null, created_at: at(10) },
      {
        id: 3,
        ...tag,
        sheet_id: 'S1',
        action: 'rebuild',
        detail: { build_run_id: 'R1' },
        created_at: at(20),
      },
      {
        id: 4,
        ...tag,
        sheet_id: 'S1',
        action: 'delete',
        detail: { members: 12 },
        created_at: at(40),
      },
      { id: 5, ...tag, sheet_id: 'S2', action: 'view', detail: null, created_at: at(60) },
      { id: 6, ...tag, sheet_id: 'S2', action: 'save', detail: null, created_at: at(70) },
    ],
    page_events: [],
    sheet_edits: [],
    member_edits: [
      {
        id: 'e1',
        ...tag,
        member_id: 'm-B1',
        field_name: 'review_status',
        action_id: 'a',
        created_at: at(40),
      },
    ],
    members: [
      {
        id: 'm-B1',
        actor: 'system',
        session_id: S,
        sheet_id: 'S1',
        origin: 'extracted',
        build_run_id: 'R1',
        created_at: at(21),
      },
    ],
    pieces_final: [fin('B1', [0, 0], [100, 0], { deleted: true })],
    build_runs: [
      { id: 'R1', ...tag, sheet_id: 'S1', mode: 'person', status: 'done', started_at: at(20) },
    ],
    build_snapshots: [
      {
        id: 'N1',
        actor: 'system',
        session_id: S,
        sheet_id: 'S1',
        build_run_id: 'R1',
        mode: 'person',
        before_user_edit: true,
        pieces: [sys('B1', [0, 0, 100, 0])],
        created_at: at(21),
      },
    ],
    build_views: [
      { sheet_id: 'S1', position: 0, role_name: 'framing plan', no_beams_at: null },
      { sheet_id: 'S2', position: 0, role_name: null, no_beams_at: at(65) },
    ],
    view_deselections: [],
    view_exclusions: [],
    view_undo: [],
    measurements: [],
    auto_builds: [{ id: 'A', status: 'done', counts: { mode: 'suggest' } }],
    sheets: [
      { id: 'S1', page_index: 0 },
      { id: 'S2', page_index: 1 },
    ],
    timing: [],
    ...over,
  };
}

describe('sessionReport', () => {
  it('passes the checks of a clean session and lists pages, notes and labels', () => {
    const r = sessionReport(exportOf());
    expect(r.checks.map((c) => c.pass)).toEqual([true, true, true, true, true]);
    expect(r.sessions[0]).toMatchObject({ pages_opened: 2, pages_built: 1, pages_saved: 1 });
    expect(r.built_pages).toHaveLength(1);
    expect(r.built_pages[0]!.page).toBe(1);
    expect(r.built_pages[0]!.notes).toEqual([
      'not_saved',
      'bulk_delete(12)',
      'most_system_deleted(beams 1/1)',
    ]);
    expect(r.totals.beams).toMatchObject({ system: 1, deleted: 1, negatives: 1, positives: 0 });
    expect(r.rates.beams.precision).toBe(0);
    expect(r.rates.beams.recall).toBeNull();
    expect(r.pages_opened_not_built).toEqual([{ page: 2, role: 'none (no beams)' }]);
    expect(r.pages_built_not_saved).toEqual([{ page: 1, role: 'framing plan' }]);
  });

  it('fails each check on its own defect', () => {
    const base = exportOf();
    const r = sessionReport(
      exportOf({
        count_actions: [
          ...base.count_actions.filter((a) => a.action !== 'rebuild'), // no Build press
          {
            id: 9,
            actor: 'owner',
            session_id: null,
            sheet_id: 'S1',
            action: 'view',
            detail: null,
            created_at: at(30),
          },
        ],
        build_snapshots: [{ ...base.build_snapshots[0]!, created_at: at(50) }], // after the edit
        auto_builds: [{ id: 'A', status: 'done', counts: { mode: 'auto' } }],
      }),
    );
    const byId = Object.fromEntries(r.checks.map((c) => [c.id.split(' ')[0], c]));
    expect(byId.I1!.pass).toBe(false);
    expect(byId.I1!.detail.not_tagged).toBe(1);
    expect(byId.I2b!.pass).toBe(false);
    expect(byId.I3!.pass).toBe(false);
    expect(byId.I3!.detail).toMatchObject({ runs_without_press: 1, auto_builds_not_suggest: 1 });
  });

  it('notes approvals that only came with Save page and edits after the save', () => {
    const base = exportOf();
    const tag = { actor: 'estimator', session_id: S };
    const r = sessionReport(
      exportOf({
        count_actions: [
          ...base.count_actions.filter((a) => a.action !== 'delete'),
          { id: 7, ...tag, sheet_id: 'S1', action: 'approve', detail: null, created_at: at(100) },
          { id: 8, ...tag, sheet_id: 'S1', action: 'save', detail: null, created_at: at(100.5) },
          { id: 10, ...tag, sheet_id: 'S1', action: 'edit', detail: null, created_at: at(200) },
        ],
        member_edits: [],
        pieces_final: [fin('B1', [0, 0], [100, 0], { approved: true })],
      }),
    );
    expect(r.built_pages[0]!.notes).toEqual(['approved_by_save_only', 'edits_after_save(1)']);
    expect(r.totals.beams).toMatchObject({ kept: 1, approved_unchanged: 1, positives: 1 });
    expect(r.rates.beams).toMatchObject({ precision: 1, recall: 1 });
  });
});

describe('helpers', () => {
  it('finds long gaps and rounds ratios', () => {
    expect(longGaps([at(0), at(30), at(1000)], 600)).toEqual([{ from: at(30), minutes: 16.2 }]);
    expect(ratio(2, 3)).toBe(0.667);
    expect(ratio(1, 0)).toBeNull();
  });
});
