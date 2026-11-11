// @vitest-environment jsdom
// Phase 0 perimeter angle: the Member panel flow and the canvas line (SYNTHETIC pieces).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BomRow, type Piece } from "../lib/lf";
import { type AngleOption, type AngleOptions } from "../lib/perimeter-angle";
import { BomTab } from "./BomTab";
import { PieceMark } from "./Canvas";
import { type PerimeterApi } from "./PerimeterAngle";
import { PropertiesPanel } from "./PropertiesPanel";

afterEach(cleanup);

const piece = (over: Partial<Piece>): Piece =>
  ({
    id: "b1",
    member_id: "LF-B-1",
    sheet_id: "s1",
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
    a: [100, 100],
    b: [300, 100],
    ends_moved: false,
    length_mm: 6096,
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
    id: "a1",
    member_id: "LF-P-1",
    tag: "DEABP1",
    kind: "Deck edge Angle / Bent plate",
    type: "other",
    profile: "L4X4X1/4",
    parent_member_id: "b1",
    parent_tag: "BE1",
    angle_length_mm: null,
    angle_start_offset_mm: null,
    slab_edge_side: null,
    vertical_leg: null,
    ...over,
  });

const opt = (name: string, common: boolean, lb: number): AngleOption => ({
  name,
  long_in: 4,
  short_in: 4,
  thickness_in: 0.25,
  lb_per_ft: lb,
  kg_per_m: lb * 1.488,
  common,
});
const options = (over: Partial<AngleOptions> = {}): AngleOptions => ({
  edition: "aisc-v16.0",
  angles: [
    opt("L4X4X1/4", true, 6.6),
    opt("L4X4X5/16", true, 8.2),
    opt("L6X4X3/8", true, 12.3),
    opt("L6X6X3/8", true, 14.9),
    opt("L8X8X1", false, 51),
  ],
  last_profile: null,
  kind: "Deck edge Angle / Bent plate",
  grade: "A36",
  grade_is_default: true,
  ...over,
});
const apiOf = (over: Partial<PerimeterApi> = {}): PerimeterApi => ({
  options: options(),
  pieces: [],
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onSetGrade: vi.fn(),
  onSelect: vi.fn(),
  onRemove: vi.fn(),
  ...over,
});
const panel = (selected: Piece[], perimeter: PerimeterApi) =>
  render(
    <PropertiesPanel
      bomRows={[]}
      sheetId="s1"
      selected={selected}
      kinds={[]}
      crop={null}
      onEdit={() => undefined}
      onDelete={() => undefined}
      onCropTool={() => undefined}
      perimeter={perimeter}
    />,
  );

describe("Add perimeter angle", () => {
  it("one beam: the button opens the picker (common ones first, the last one ready); Enter adds", () => {
    const api = apiOf({ options: options({ last_profile: "L6X4X3/8" }) });
    panel([piece({})], api);
    fireEvent.click(screen.getByTestId("add-angle"));
    const sel = screen.getByLabelText("angle profile") as HTMLSelectElement;
    expect(sel.value).toBe("L6X4X3/8");
    const common = within(sel).getByRole("group", { name: "Common" });
    expect(
      within(common)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["L4X4X1/4", "L4X4X5/16", "L6X4X3/8", "L6X6X3/8"]);
    fireEvent.keyDown(sel, { key: "Enter" });
    expect(api.onAdd).toHaveBeenCalledWith(["b1"], {
      profile_text: "L6X4X3/8",
    });
  });

  it("two clicks per beam: the button, then Add; the whole beam by default", () => {
    const api = apiOf();
    panel([piece({})], api);
    fireEvent.click(screen.getByTestId("add-angle"));
    fireEvent.click(screen.getByTestId("confirm-add-angle"));
    expect(api.onAdd).toHaveBeenCalledWith(["b1"], {
      profile_text: "L4X4X1/4",
    });
  });

  it("several beams: one picker, one call with all the beams", () => {
    const api = apiOf();
    panel([piece({}), piece({ id: "b2", tag: "BE2" })], api);
    expect(screen.getByTestId("add-angle").textContent).toContain("(2 beams)");
    fireEvent.click(screen.getByTestId("add-angle"));
    fireEvent.change(screen.getByLabelText("angle profile"), {
      target: { value: "L6X6X3/8" },
    });
    fireEvent.click(screen.getByTestId("confirm-add-angle"));
    expect(api.onAdd).toHaveBeenCalledWith(["b1", "b2"], {
      profile_text: "L6X6X3/8",
    });
  });

  it("a typed real length, the slab side and the vertical leg go with it; junk is refused", () => {
    const api = apiOf();
    panel([piece({})], api);
    fireEvent.click(screen.getByTestId("add-angle"));
    fireEvent.change(screen.getByLabelText("angle length"), {
      target: { value: "banana" },
    });
    fireEvent.click(screen.getByTestId("confirm-add-angle"));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(api.onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("angle length"), {
      target: { value: `12'-6"` },
    });
    fireEvent.change(screen.getByLabelText("slab edge side"), {
      target: { value: "right" },
    });
    fireEvent.change(screen.getByLabelText("vertical leg"), {
      target: { value: "long" },
    });
    fireEvent.click(screen.getByTestId("confirm-add-angle"));
    const [, form] = (api.onAdd as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(form).toMatchObject({
      profile_text: "L4X4X1/4",
      slab_edge_side: "right",
      vertical_leg: "long",
    });
    expect(form.length_mm).toBeCloseTo(3810, 1);
  });

  it("not offered on a column or on an angle", () => {
    panel([piece({ type: "column", b: null })], apiOf());
    expect(screen.queryByTestId("add-angle")).toBeNull();
    cleanup();
    panel([angle()], apiOf());
    expect(screen.queryByTestId("add-angle")).toBeNull();
  });

  it("grade: A36 by default and editable per project; empty goes back to the default; Enter does not add", () => {
    const api = apiOf();
    panel([piece({})], api);
    fireEvent.click(screen.getByTestId("add-angle"));
    const g = screen.getByLabelText("angle grade") as HTMLInputElement;
    expect(g.value).toBe("A36");
    expect(screen.getByTestId("angle-grade").textContent).toContain("default");
    expect(screen.queryByTestId("set-angle-grade")).toBeNull();
    fireEvent.blur(g); // unchanged: nothing recorded
    expect(api.onSetGrade).not.toHaveBeenCalled();
    fireEvent.change(g, { target: { value: "A572 Gr 50" } });
    fireEvent.keyDown(g, { key: "Enter" });
    fireEvent.blur(g);
    expect(api.onSetGrade).toHaveBeenCalledWith("A572 Gr 50");
    expect(api.onAdd).not.toHaveBeenCalled();
    cleanup();
    const own = apiOf({
      options: options({ grade: "A572 Gr 50", grade_is_default: false }),
    });
    panel([piece({})], own);
    fireEvent.click(screen.getByTestId("add-angle"));
    const g2 = screen.getByLabelText("angle grade") as HTMLInputElement;
    expect(g2.value).toBe("A572 Gr 50");
    fireEvent.change(g2, { target: { value: "" } });
    fireEvent.blur(g2);
    expect(own.onSetGrade).toHaveBeenCalledWith(null);
  });

  it("bent plate: thickness and two legs in inches (fractions); name and weight shown; sent as sizes", () => {
    const api = apiOf();
    panel([piece({})], api);
    fireEvent.click(screen.getByTestId("add-angle"));
    fireEvent.change(screen.getByLabelText("perimeter type"), {
      target: { value: "bent" },
    });
    expect(screen.queryByLabelText("angle profile")).toBeNull();
    fireEvent.click(screen.getByTestId("confirm-add-angle")); // empty: refused
    expect(api.onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("bent thickness"), {
      target: { value: "3/8" },
    });
    fireEvent.change(screen.getByLabelText("bent leg 1"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("bent leg 2"), {
      target: { value: "4" },
    });
    expect(screen.getByTestId("bent-preview").textContent).toContain(
      "BENT PL 3/8 x 6 x 4 · 12.3 lb/ft",
    );
    fireEvent.click(screen.getByTestId("confirm-add-angle"));
    expect(api.onAdd).toHaveBeenCalledWith(["b1"], {
      bent: { thickness_in: 0.375, leg1_in: 6, leg2_in: 4 },
    });
  });

  it("the form starts as a bent plate when the project's last one was a bent plate", () => {
    panel(
      [piece({})],
      apiOf({ options: options({ last_profile: "BENT PL 1/4 x 5 x 3" }) }),
    );
    fireEvent.click(screen.getByTestId("add-angle"));
    expect(
      (screen.getByLabelText("bent leg 1") as HTMLInputElement).value,
    ).toBe("5");
    expect(screen.getByTestId("bent-preview").textContent).toContain(
      "BENT PL 1/4 x 5 x 3",
    );
  });

  it("a selected bent plate: its sizes are editable and go back as sizes", () => {
    const api = apiOf();
    panel([angle({ profile: "BENT PL 3/8 x 6 x 4" })], api);
    expect(screen.queryByLabelText("angle profile")).toBeNull();
    fireEvent.change(screen.getByLabelText("bent leg 2"), {
      target: { value: "5" },
    });
    fireEvent.blur(screen.getByLabelText("bent leg 2"));
    expect(api.onEdit).toHaveBeenCalledWith(["a1"], {
      bent: { thickness_in: 0.375, leg1_in: 6, leg2_in: 5 },
    });
  });
});

describe("angles under their beam, and their own panel", () => {
  it("one beam: its angles are listed with profile and length; select and remove", () => {
    const api = apiOf({
      pieces: [
        piece({}),
        angle(),
        angle({ id: "a2", tag: "DEABP2", deleted: true }),
      ],
    });
    panel([piece({})], api);
    const rows = screen.getAllByTestId("angle-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("L4X4X1/4");
    fireEvent.click(within(rows[0]!).getByText("DEABP1"));
    expect(api.onSelect).toHaveBeenCalledWith(["a1"]);
    fireEvent.click(within(rows[0]!).getByLabelText("remove angle DEABP1"));
    expect(api.onRemove).toHaveBeenCalledWith(["a1"]);
  });

  it("a selected angle: profile, typed length (blank = whole beam), offset, side, leg, remove", () => {
    const api = apiOf();
    panel([angle({ slab_edge_side: "left" })], api);
    const box = screen.getByTestId("angle-member");
    expect(box.textContent).toContain("DEABP1");
    expect(box.textContent).toContain("BE1");
    expect(screen.queryByText("Studs")).toBeNull(); // not the beam panel
    fireEvent.change(within(box).getByLabelText("angle profile"), {
      target: { value: "L6X4X3/8" },
    });
    expect(api.onEdit).toHaveBeenLastCalledWith(["a1"], {
      profile_text: "L6X4X3/8",
    });
    const len = within(box).getByLabelText("angle length");
    fireEvent.change(len, { target: { value: `4'` } });
    fireEvent.blur(len);
    const patch = (api.onEdit as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    )![1];
    expect(patch.length_mm).toBeCloseTo(1219.2, 1);
    const off = within(box).getByLabelText("angle start offset");
    fireEvent.change(off, { target: { value: `1'` } });
    fireEvent.blur(off);
    expect(
      (api.onEdit as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
        .start_offset_mm,
    ).toBeCloseTo(304.8, 1);
    fireEvent.change(within(box).getByLabelText("slab edge side"), {
      target: { value: "right" },
    });
    expect(api.onEdit).toHaveBeenLastCalledWith(["a1"], {
      slab_edge_side: "right",
    });
    fireEvent.change(within(box).getByLabelText("vertical leg"), {
      target: { value: "" },
    });
    expect(api.onEdit).toHaveBeenLastCalledWith(["a1"], { vertical_leg: null });
    fireEvent.click(screen.getByTestId("remove-angle"));
    expect(api.onRemove).toHaveBeenCalledWith(["a1"]);
  });

  it("clearing a typed length sends null (follows the whole beam again)", () => {
    const api = apiOf();
    panel([angle({ angle_length_mm: 1219.2 })], api);
    const len = screen.getByLabelText("angle length") as HTMLInputElement;
    expect(len.value).toContain("4'");
    fireEvent.change(len, { target: { value: "" } });
    fireEvent.blur(len);
    expect(api.onEdit).toHaveBeenLastCalledWith(["a1"], { length_mm: null });
  });
});

describe("canvas and BOM", () => {
  it("an angle is a thin line of its own colour beside the beam, with a tooltip", () => {
    const { container } = render(
      <svg>
        <PieceMark
          p={angle({
            slab_edge_side: "left",
            vertical_leg: "long",
            length_mm: 3048,
          })}
          px={1}
          on={false}
          labels
        />
      </svg>,
    );
    const g = container.querySelector('[data-angle="1"]')!;
    expect(g).toBeTruthy();
    expect(g.querySelector("title")!.textContent).toBe(
      `Perimeter angle DEABP1 L4X4X1/4\n10'-0"\non beam BE1\nslab edge: left of the beam\nvertical leg: long`,
    );
    const colour = [...g.querySelectorAll("line")].find(
      (l) => l.getAttribute("stroke") === "var(--angle)",
    )!;
    expect(Number(colour.getAttribute("stroke-width"))).toBeLessThanOrEqual(2);
    // beside the beam: left of a beam pointing right is up on the page (y smaller)
    expect(Number(colour.getAttribute("y1"))).toBeLessThan(100);
  });

  it("BOM tab: the angles by profile with count, length, unit weight and weight", () => {
    const row = (over: Partial<BomRow>): BomRow => ({
      main: 1,
      category: "Beams",
      piecemark: "BE1",
      qty: 1,
      section_type: "W",
      section: "W16X26",
      length_mm: 3048,
      grade: null,
      weight_kg: 1,
      weight_lb: 100,
      member: "m1",
      sheet_id: "s1",
      build_state: "found",
      in_main_total: true,
      ...over,
    });
    render(
      <BomTab
        projectId="p1"
        bom={{
          rows: [
            row({}),
            row({
              member: "m2",
              category: "Deck edge Angle / Bent plate",
              piecemark: "DEABP1",
              section: "L4X4X1/4",
              perimeter_angle: true,
            }),
          ],
          totals: { pieces: 2, length_mm: 6096, weight_lb: 200 },
          attention: { pieces: 0, length_mm: 0, weight_lb: 0 },
          angles: [
            {
              category: "Deck edge Angle / Bent plate",
              section: "L4X4X1/4",
              qty: 2,
              length_mm: 6096,
              unit_w_lb_ft: 6.6,
              grade: "A36",
              weight_kg: 12,
              weight_lb: 132,
            },
          ],
        }}
      />,
    );
    const line = screen.getByTestId("angle-line").textContent!;
    expect(line).toContain("L4X4X1/4");
    expect(line).toContain("20'-0\"");
    expect(line).toContain("6.6");
    expect(line).toContain("A36");
    expect(line).toContain("132 lbs");
  });
});
