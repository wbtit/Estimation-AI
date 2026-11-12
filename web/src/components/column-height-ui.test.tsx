// @vitest-environment jsdom
// Review 3 item 4: the column height section (one or many columns, the default, the source, amber
// when none), and the parser (SYNTHETIC).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHeightText, type ColumnHeightApi } from "../lib/column-height";
import type { Piece } from "../lib/lf";
import { ColumnHeightSection } from "./ColumnHeight";

afterEach(cleanup);

const col = (over: Partial<Piece> = {}): Piece =>
  ({
    id: "c1",
    type: "column",
    tag: "C1",
    column_height_mm: null,
    column_top_mm: null,
    column_base_mm: null,
    height_mm: null,
    height_source: null,
    ...over,
  }) as Piece;
const apiOf = (over: Partial<ColumnHeightApi> = {}): ColumnHeightApi => ({
  defaultMm: null,
  onSet: vi.fn(),
  onSetDefault: vi.fn(),
  ...over,
});

describe("column height parser", () => {
  it("feet-inches or mm; empty clears; junk is refused; a height is above 0, an elevation may not be", () => {
    expect(parseHeightText("", "height")).toBeNull();
    expect(parseHeightText(`12'-0"`, "height")).toBeCloseTo(3657.6, 1);
    expect(parseHeightText("3000 mm", "height")).toBe(3000);
    expect(parseHeightText("abc", "height")).toBeUndefined();
    expect(parseHeightText("0 mm", "height")).toBeUndefined();
    expect(parseHeightText(`0'-0"`, "elevation")).toBe(0);
    expect(parseHeightText(`-3'-0"`, "elevation")).toBeCloseTo(-914.4, 1);
  });
});

describe("column height section", () => {
  it("no height from any source: shown amber, never a made-up number", () => {
    render(<ColumnHeightSection selected={[col()]} api={apiOf()} />);
    expect(screen.getByTestId("no-height").textContent).toBe("No height");
  });

  it("shows the height with its source", () => {
    render(
      <ColumnHeightSection
        selected={[col({ height_mm: 3657.6, height_source: "project" })]}
        api={apiOf({ defaultMm: 3657.6 })}
      />,
    );
    expect(screen.getByTestId("height-result").textContent).toContain(
      "12'-0\"",
    );
    expect(screen.getByTestId("height-result").textContent).toContain(
      "project default",
    );
    expect(
      (screen.getByLabelText("default column height") as HTMLInputElement)
        .value,
    ).toBe("12'-0\"");
  });

  it("one column: a typed height goes with the column id; junk is refused", () => {
    const api = apiOf();
    render(<ColumnHeightSection selected={[col()]} api={api} />);
    const f = screen.getByLabelText("column height");
    fireEvent.change(f, { target: { value: "banana" } });
    fireEvent.blur(f);
    expect(api.onSet).not.toHaveBeenCalled();
    expect(f.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(f, { target: { value: `15'-0"` } });
    fireEvent.blur(f);
    const [ids, patch] = (api.onSet as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ids).toEqual(["c1"]);
    expect(patch.height_mm).toBeCloseTo(4572, 1);
  });

  it("bulk: several selected columns are set once (one call with all the ids)", () => {
    const api = apiOf();
    render(
      <ColumnHeightSection
        selected={[
          col(),
          col({ id: "c2", tag: "C2" }),
          col({ id: "c3", tag: "C3" }),
        ]}
        api={api}
      />,
    );
    expect(screen.getByText("3 selected")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("column height"), {
      target: { value: `20'-0"` },
    });
    fireEvent.blur(screen.getByLabelText("column height"));
    const [ids, patch] = (api.onSet as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ids).toEqual(["c1", "c2", "c3"]);
    expect(patch.height_mm).toBeCloseTo(6096, 1);
  });

  it("different heights show 'Mixed'; leaving the field blank sends nothing", () => {
    const api = apiOf();
    render(
      <ColumnHeightSection
        selected={[
          col({
            column_height_mm: 3000,
            height_mm: 3000,
            height_source: "column",
          }),
          col({
            id: "c2",
            column_height_mm: 4000,
            height_mm: 4000,
            height_source: "column",
          }),
        ]}
        api={api}
      />,
    );
    const f = screen.getByLabelText("column height") as HTMLInputElement;
    expect(f.value).toBe("");
    expect(f.placeholder).toBe("Mixed");
    fireEvent.blur(f);
    expect(api.onSet).not.toHaveBeenCalled();
  });

  it("top and base elevations are optional fields; the default sends null when cleared", () => {
    const api = apiOf({ defaultMm: 3657.6 });
    render(<ColumnHeightSection selected={[col()]} api={api} />);
    fireEvent.change(screen.getByLabelText("column top elevation"), {
      target: { value: `20'-0"` },
    });
    fireEvent.blur(screen.getByLabelText("column top elevation"));
    expect(
      (api.onSet as ReturnType<typeof vi.fn>).mock.calls[0]![1].top_mm,
    ).toBeCloseTo(6096, 1);
    fireEvent.change(screen.getByLabelText("default column height"), {
      target: { value: "" },
    });
    fireEvent.blur(screen.getByLabelText("default column height"));
    expect(api.onSetDefault).toHaveBeenCalledWith(null);
  });
});
