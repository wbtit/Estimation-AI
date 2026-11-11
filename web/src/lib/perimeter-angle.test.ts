// Phase 0 perimeter angle: the pure logic of the panel (SYNTHETIC pieces).
import { describe, expect, it } from "vitest";
import {
  anglesOf,
  angleGroups,
  bentLbPerFt,
  bentName,
  bentValid,
  formatInches,
  parseBent,
  parseInches,
  angleLabel,
  canAddAngle,
  parseAngleLength,
  sideNormal,
  startProfile,
  type AngleOption,
  type AngleOptions,
} from "./perimeter-angle";
import { pieceAt, piecesInBox, summary, type BomRow, type Piece } from "./lf";

const piece = (over: Partial<Piece>): Piece =>
  ({
    id: "p",
    member_id: "m",
    sheet_id: "s",
    type: "beam",
    kind: "Beams",
    tag: "BE1",
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
    length_mm: 3048,
    elevation_mm: null,
    build_state: "found",
    size_state: "sized",
    support_state: "both",
    piece_index: 1,
    scale_ratio: 96,
    evidence: null,
    ...over,
  }) as Piece;

const angle = (over: Partial<Piece> = {}) =>
  piece({
    id: "ang",
    tag: "DEABP1",
    kind: "Deck edge Angle / Bent plate",
    type: "other",
    profile: "L4X4X1/4",
    parent_member_id: "p",
    parent_tag: "BE1",
    ...over,
  });

const opt = (name: string, common: boolean): AngleOption => ({
  name,
  long_in: 4,
  short_in: 4,
  thickness_in: 0.25,
  lb_per_ft: 6.6,
  kg_per_m: 9.8,
  common,
});

describe("perimeter angle logic", () => {
  it("the action is for beams only: not columns, not angles, not deleted, two ends", () => {
    expect(canAddAngle([piece({})])).toBe(true);
    expect(canAddAngle([piece({}), piece({ id: "q" })])).toBe(true);
    expect(canAddAngle([])).toBe(false);
    expect(canAddAngle([piece({ type: "column", b: null })])).toBe(false);
    expect(canAddAngle([angle()])).toBe(false);
    expect(canAddAngle([piece({ deleted: true })])).toBe(false);
    expect(
      canAddAngle([piece({}), piece({ id: "c", type: "column", b: null })]),
    ).toBe(false);
  });

  it("lists the angles of a beam in tag order, not the deleted ones", () => {
    const all = [
      piece({}),
      angle({ id: "a2", tag: "DEABP10" }),
      angle({ id: "a1", tag: "DEABP2" }),
      angle({ id: "a3", tag: "DEABP3", deleted: true }),
      angle({ id: "x", parent_member_id: "other" }),
    ];
    expect(anglesOf(all, "p").map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("a typed length: empty follows the beam; ft-in or mm; junk is refused", () => {
    expect(parseAngleLength("")).toBeNull();
    expect(parseAngleLength("  ")).toBeNull();
    expect(parseAngleLength(`12'-6"`)).toBeCloseTo(3810, 1);
    expect(parseAngleLength("3000 mm")).toBe(3000);
    expect(parseAngleLength("3000")).toBeUndefined(); // a bare number has no unit
    expect(parseAngleLength("0 mm")).toBeUndefined();
    expect(parseAngleLength("abc")).toBeUndefined();
  });

  it("the picker starts on the project's last profile when it is listed, else the first", () => {
    const o: AngleOptions = {
      edition: "e",
      angles: [
        opt("L4X4X1/4", true),
        opt("L6X4X3/8", true),
        opt("L8X8X1", false),
      ],
      last_profile: "L6X4X3/8",
      kind: "Deck edge Angle / Bent plate",
      grade: "A36",
      grade_is_default: true,
    };
    expect(startProfile(o)).toBe("L6X4X3/8");
    expect(startProfile({ ...o, last_profile: "W16X26" })).toBe("L4X4X1/4");
    expect(startProfile({ ...o, last_profile: null })).toBe("L4X4X1/4");
    expect(angleGroups(o.angles).common).toHaveLength(2);
    expect(angleLabel(o.angles[0]!)).toBe("L4X4X1/4 · 6.6 lb/ft");
  });

  it("bent plate: inches with fractions, the name, the weight formula, the checks", () => {
    expect(parseInches("3/8")).toBeCloseTo(0.375);
    expect(parseInches("1-1/2")).toBeCloseTo(1.5);
    expect(parseInches("1 1/2")).toBeCloseTo(1.5);
    expect(parseInches("6")).toBe(6);
    expect(parseInches("0")).toBeNull();
    expect(parseInches("x")).toBeNull();
    expect(formatInches(0.375)).toBe("3/8");
    expect(formatInches(1.5)).toBe("1-1/2");
    const b = { thickness_in: 0.375, leg1_in: 6, leg2_in: 4 };
    expect(bentName(b)).toBe("BENT PL 3/8 x 6 x 4");
    expect(parseBent("BENT PL 3/8 x 6 x 4")).toEqual(b);
    expect(parseBent("L4X4X1/4")).toBeNull();
    expect(bentLbPerFt(b)).toBeCloseTo(3.4 * 0.375 * 9.625, 6);
    expect(bentValid({ ...b, leg2_in: 0.3 })).toBe(false); // a leg not longer than the thickness
    expect(bentValid({ ...b, leg1_in: 60 })).toBe(false);
  });

  it("the drawn line sits on the left / right of the beam direction (page frame, y down)", () => {
    // beam pointing right: left is up (y negative) on the page
    expect(sideNormal([0, 0], [10, 0], "left")).toEqual([0, -1]);
    expect(sideNormal([0, 0], [10, 0], "right")).toEqual([-0, 1]);
    expect(sideNormal([0, 0], [10, 0], null)).toEqual([0, -1]);
  });

  it("an angle is never counted as a beam in the summary", () => {
    const row = (over: Partial<BomRow>): BomRow => ({
      main: 1,
      category: "Beams",
      piecemark: "B",
      qty: 1,
      section_type: "W",
      section: "W16X26",
      length_mm: 1,
      grade: null,
      weight_kg: 1,
      weight_lb: 2000,
      member: "m",
      sheet_id: "s",
      build_state: "found",
      in_main_total: true,
      ...over,
    });
    const s = summary([
      row({}),
      row({
        category: "Deck edge Angle / Bent plate",
        perimeter_angle: true,
        qty: 2,
      }),
    ]);
    expect(s.beams).toBe(1);
    expect(s.angles).toBe(2);
  });

  it("clicking along the beam picks the beam; the angle beside it is picked on its own line", () => {
    const beam = piece({});
    const ang = angle({ a: [0, 0], b: [100, 0] }); // same geometry (the tie)
    expect(pieceAt([ang, beam], [50, 0], 6)!.id).toBe("p");
    expect(pieceAt([beam, ang], [50, 0], 6)!.id).toBe("p");
    const off = angle({ a: [0, -4], b: [100, -4] }); // drawn 4 off the beam
    expect(pieceAt([beam, off], [50, -4], 6)!.id).toBe("ang");
    expect(pieceAt([beam, off], [50, 0], 6)!.id).toBe("p");
  });

  it("a box select takes beams, never the angles on them (a size edit would change them too)", () => {
    const beam = piece({});
    const ang = angle();
    const got = piecesInBox([beam, ang], { x0: -10, y0: -10, x1: 200, y1: 10 });
    expect(got.map((p) => p.id)).toEqual(["p"]);
  });
});
