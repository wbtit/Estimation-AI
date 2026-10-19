import { describe, expect, it } from "vitest";
import {
  ALL_LAYERS,
  flagOf,
  isProblem,
  issues,
  markColour,
  remainingIssues,
  sizeGroups,
  type BomRow,
  dashPx,
  hasGlow,
  labelDiffers,
  MARK_MAX_PX,
  MARK_MIN_PX,
  MARK_ON_PX,
  markWidthPx,
  setupChips,
  showSizeLabel,
  visible,
  type PageViewInfo,
  type Piece,
} from "./lf";

const piece = (over: Partial<Piece> = {}): Piece => ({
  id: "a",
  member_id: "LF-B-1",
  sheet_id: "s1",
  type: "beam",
  kind: "Beams",
  tag: "B1",
  quantity: 1,
  profile: "W16X26",
  profile_raw: "W16X26",
  studs: null,
  camber_raw: null,
  ignored: false,
  deleted: false,
  added: false,
  edited: false,
  a: [0, 0],
  b: [100, 0],
  ends_moved: false,
  length_mm: 3000,
  elevation_mm: null,
  build_state: "found",
  size_state: "sized",
  support_state: "both",
  piece_index: 1,
  scale_ratio: 48,
  evidence: null,
  ...over,
});

describe("less noise", () => {
  it("only attention glows; review and found do not, nor an ignored member", () => {
    expect(hasGlow(piece({ build_state: "attention" }))).toBe(true);
    expect(hasGlow(piece({ build_state: "needs_review" }))).toBe(false);
    expect(hasGlow(piece({ build_state: "found" }))).toBe(false);
    expect(hasGlow(piece({ build_state: "attention", ignored: true }))).toBe(
      false,
    );
  });

  it("mark width follows the zoom between the limits; hover and select are wider", () => {
    expect(markWidthPx(0.2)).toBe(MARK_MIN_PX);
    expect(markWidthPx(1.2)).toBeCloseTo(2.4);
    expect(markWidthPx(8)).toBe(MARK_MAX_PX);
    expect(markWidthPx(0.2, true)).toBe(MARK_ON_PX);
    expect(dashPx(2)).toEqual([6, 4]);
  });

  it("the read size shows only where it differs from the drawing's label", () => {
    const same = piece({ profile_raw: "W16x26" });
    expect(labelDiffers(same)).toBe(false);
    expect(labelDiffers(piece({ profile_raw: "W 16 X 26 (12)" }))).toBe(false);
    expect(labelDiffers(piece({ profile_raw: "W16X26 C=3/4" }))).toBe(false);
    expect(labelDiffers(piece({ profile_raw: "W16X260" }))).toBe(true);
    expect(labelDiffers(piece({ profile: "W18X35" }))).toBe(true); // a person changed it
    expect(labelDiffers(piece({ profile_raw: null }))).toBe(true); // typed, no label
    expect(labelDiffers(piece({ profile: null }))).toBe(false); // nothing to write
    // studs other than the label's differ
    expect(
      labelDiffers(
        piece({ studs: 12, evidence: { studs: { raw: "(12)", count: 12 } } }),
      ),
    ).toBe(false);
    expect(
      labelDiffers(
        piece({ studs: 14, evidence: { studs: { raw: "(12)", count: 12 } } }),
      ),
    ).toBe(true);
    const o = { hover: false, on: false, allSizes: false };
    expect(showSizeLabel(same, o)).toBe(false);
    expect(showSizeLabel(same, { ...o, hover: true })).toBe(true);
    expect(showSizeLabel(same, { ...o, on: true })).toBe(true);
    expect(showSizeLabel(same, { ...o, allSizes: true })).toBe(true);
  });

  it("Only problems hides found and ignored members", () => {
    const l = { ...ALL_LAYERS, onlyProblems: true };
    expect(visible(piece(), l)).toBe(false);
    expect(visible(piece({ build_state: "needs_review" }), l)).toBe(true);
    expect(visible(piece({ build_state: "attention", profile: null }), l)).toBe(
      true,
    );
    expect(visible(piece({ build_state: "attention", ignored: true }), l)).toBe(
      false,
    );
    expect(visible(piece(), ALL_LAYERS)).toBe(true);
  });
});

describe("setup chips", () => {
  const view = (over: Partial<PageViewInfo> = {}) =>
    ({
      role_name: "Framing plan",
      behaviour: "framing",
      box: { x0: 0, y0: 0, x1: 10, y1: 10 },
      scale_ratio: 96,
      pens: [{ pen_class: "p", position: 1, source: "person" }],
      no_beams: false,
      column_plan_sheet_id: "c1",
      column_plan_view_id: null,
      tos_mm: 4000,
      system_values: [],
      ...over,
    }) as PageViewInfo;
  const states = (v: PageViewInfo) =>
    Object.fromEntries(setupChips(v).map((c) => [c.key, c.state]));

  it("green when confirmed, grey when the system set it, red when missing", () => {
    expect(states(view())).toEqual({
      role: "ok",
      crop: "ok",
      scale: "ok",
      pen: "ok",
      column_plan: "ok",
      tos: "ok",
    });
    expect(
      states(
        view({ system_values: ["crop", "scale"], tos_mm: null, pens: [] }),
      ),
    ).toMatchObject({
      crop: "system",
      scale: "system",
      tos: "missing",
      pen: "missing",
    });
    expect(states(view({ pens: [], no_beams: true })).pen).toBe("ok");
  });

  it("a column plan chosen as None is confirmed; unchosen and empty is missing", () => {
    expect(states(view({ column_plan_sheet_id: null })).column_plan).toBe("ok");
    expect(
      states(
        view({ column_plan_sheet_id: null, system_values: ["column_plan"] }),
      ).column_plan,
    ).toBe("missing");
  });

  it("a column plan view shows no Pen, Column plan or T.O.S.; a view that does not build only Role", () => {
    expect(
      setupChips(view({ behaviour: "column_plan" })).map((c) => c.key),
    ).toEqual(["role", "crop", "scale"]);
    expect(
      setupChips(view({ behaviour: "none", role_name: "Detail" })).map(
        (c) => c.key,
      ),
    ).toEqual(["role"]);
    expect(states(view({ role_name: null, behaviour: null })).role).toBe(
      "missing",
    );
  });
});

describe("approve", () => {
  it("approved is a calm blue with no glow and no flag; ignored stays grey", () => {
    const a = piece({ build_state: "attention", approved: true });
    expect(markColour(a)).toBe("var(--approved)");
    expect(hasGlow(a)).toBe(false);
    expect(flagOf(a)).toBeNull();
    expect(isProblem(a)).toBe(false);
    expect(markColour(piece({ approved: true, ignored: true }))).toBe(
      "var(--mark-ignored)",
    );
    expect(markColour(piece({ type: "column", approved: true, b: null }))).toBe(
      "var(--approved)",
    );
  });

  it("the navigator skips approved members; Hide approved and Only problems hide them", () => {
    const list = [
      piece({ id: "r", build_state: "attention" }),
      piece({ id: "ra", build_state: "attention", approved: true }),
      piece({ id: "o", build_state: "needs_review", a: [0, 50], b: [100, 50] }),
      piece({ id: "oa", build_state: "needs_review", approved: true }),
    ];
    expect(issues(list).map((x) => x.piece.id)).toEqual(["r", "o"]);
    expect(visible(list[1]!, { ...ALL_LAYERS, hideApproved: true })).toBe(
      false,
    );
    expect(visible(list[0]!, { ...ALL_LAYERS, hideApproved: true })).toBe(true);
    expect(visible(list[1]!, { ...ALL_LAYERS, onlyProblems: true })).toBe(
      false,
    );
    expect(visible(list[1]!, ALL_LAYERS)).toBe(true);
  });

  it("Save page counts the red and orange left (not approved, ignored or deleted)", () => {
    const left = remainingIssues([
      piece({ id: "r1", build_state: "attention" }),
      piece({ id: "r2", build_state: "attention", approved: true }),
      piece({ id: "r3", build_state: "attention", ignored: true }),
      piece({ id: "r4", build_state: "attention", deleted: true }),
      piece({ id: "o1", build_state: "needs_review" }),
      piece({ id: "f", build_state: "found" }),
    ]);
    expect(left).toEqual({ red: 1, orange: 1, ids: ["r1", "o1"] });
  });
});

const bomRow = (over: Partial<BomRow>): BomRow => ({
  main: 1,
  category: "Beams",
  piecemark: "B1",
  qty: 1,
  section_type: "W",
  section: "W16X26",
  length_mm: 3048,
  grade: null,
  weight_kg: 36,
  weight_lb: 79.37,
  member: "LF-B-1",
  piece_id: "p1",
  sheet_id: "s1",
  approved: false,
  build_state: "found",
  in_main_total: true,
  ...over,
});

describe("members by size", () => {
  const rows: BomRow[] = [
    bomRow({ piece_id: "a", section: "W16X26", approved: true }),
    bomRow({ piece_id: "b", section: "W16X26", sheet_id: "s2" }),
    bomRow({
      piece_id: "c",
      section: "W8X10",
      length_mm: 2000,
      weight_lb: 30,
      qty: 2,
      weight_kg: 13.6,
    }),
    bomRow({
      piece_id: "d",
      section: null,
      weight_lb: null,
      weight_kg: null,
      build_state: "attention",
      in_main_total: false,
    }),
    bomRow({
      piece_id: "e",
      category: "Column",
      section: "W10X49",
      length_mm: null,
      weight_lb: null,
      weight_kg: null,
    }),
    bomRow({ piece_id: "f", category: "Vertical Brace", section: "L4X4X1/2" }),
  ];

  it("groups by kind (beams, columns, braces), sections in order, No size last", () => {
    const g = sizeGroups(rows);
    expect(g.map((x) => x.kind)).toEqual(["Beams", "Column", "Vertical Brace"]);
    expect(g[0]!.rows.map((r) => r.section)).toEqual(["W8X10", "W16X26", null]);
    const w16 = g[0]!.rows[1]!;
    expect([w16.qty, w16.approved, w16.piece_ids]).toEqual([2, 1, ["a", "b"]]);
    expect(w16.sheets).toEqual([
      { sheet_id: "s1", qty: 1, piece_ids: ["a"] },
      { sheet_id: "s2", qty: 1, piece_ids: ["b"] },
    ]);
    expect(g[0]!.rows[2]!.no_weight).toBe(1);
    expect(g[0]!.total).toMatchObject({ qty: 5, approved: 1 });
  });

  it("Sheet is one page (all its views)", () => {
    const g = sizeGroups(rows, "s2");
    expect(g.map((x) => [x.kind, x.total.qty])).toEqual([["Beams", 1]]);
  });

  it("the totals equal the BOM's totals (main + attention) for the same scope", () => {
    // the BOM's rule (api/src/review/line-first-bom.ts add()): pieces = qty, length = length x
    // qty, weight = the row weight; main and attention rows together are every row
    const bomTotals = (rs: BomRow[]) => ({
      pieces: rs.reduce((t, r) => t + r.qty, 0),
      length_mm: rs.reduce((t, r) => t + (r.length_mm ?? 0) * r.qty, 0),
      weight_lb: rs.reduce((t, r) => t + (r.weight_lb ?? 0), 0),
    });
    for (const scope of [undefined, "s1", "s2"]) {
      const inScope = rows.filter(
        (r) => scope === undefined || r.sheet_id === scope,
      );
      const g = sizeGroups(rows, scope);
      const sum = {
        pieces: g.reduce((t, x) => t + x.total.qty, 0),
        length_mm: g.reduce((t, x) => t + x.total.length_mm, 0),
        weight_lb: g.reduce((t, x) => t + x.total.weight_lb, 0),
      };
      const b = bomTotals(inScope);
      expect(sum.pieces).toBe(b.pieces);
      expect(sum.length_mm).toBeCloseTo(b.length_mm, 6);
      expect(sum.weight_lb).toBeCloseTo(b.weight_lb, 6);
    }
  });
});
