import { describe, expect, it } from "vitest";
import {
  ALL_LAYERS,
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
