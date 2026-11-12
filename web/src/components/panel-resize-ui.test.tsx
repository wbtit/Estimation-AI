// @vitest-environment jsdom
// Resizable side panels, compact page cards and setup chips as steps (SYNTHETIC).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampPanelWidth,
  loadWidth,
  PANEL_MIN,
  panelMax,
  saveWidth,
} from "../lib/ui-state";
import { pageNeighbour, type Page } from "../lib/lf";
import { PageCard, type PageActions } from "./PageCard";
import { ResizeHandle } from "./ResizeHandle";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("panel width rules", () => {
  it("is between 280 px and 45% of the window", () => {
    expect(PANEL_MIN).toBe(280);
    expect(panelMax(1920)).toBe(864);
    expect(panelMax(1366)).toBe(614);
    expect(clampPanelWidth(100, 1920)).toBe(280);
    expect(clampPanelWidth(5000, 1920)).toBe(864);
    expect(clampPanelWidth(400, 1366)).toBe(400);
    // a window so small that 45% is under the minimum still gets the minimum
    expect(clampPanelWidth(900, 500)).toBe(280);
    expect(clampPanelWidth(Number.NaN, 1920)).toBe(280);
  });

  it("is remembered per person; a bad value or blocked storage gives the default", () => {
    expect(loadWidth("panel.left.width", 320, "ann")).toBe(320);
    saveWidth("panel.left.width", 417.4, "ann");
    expect(loadWidth("panel.left.width", 320, "ann")).toBe(417);
    expect(loadWidth("panel.left.width", 320, "bob")).toBe(320);
    localStorage.setItem("ui.ann.panel.left.width", '"wide"');
    expect(loadWidth("panel.left.width", 320, "ann")).toBe(320);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadWidth("panel.left.width", 320, "ann")).toBe(320);
    expect(() => saveWidth("panel.left.width", 300, "ann")).not.toThrow();
  });
});

describe("the resize handle", () => {
  const mount = (side: "left" | "right" = "right", width = 320) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onReset = vi.fn();
    render(
      <ResizeHandle
        side={side}
        width={width}
        min={280}
        max={864}
        label="resize"
        onChange={onChange}
        onCommit={onCommit}
        onReset={onReset}
      />,
    );
    return { onChange, onCommit, onReset, h: screen.getByRole("separator") };
  };

  it("is a vertical separator that says its range", () => {
    const { h } = mount();
    expect(h.getAttribute("aria-orientation")).toBe("vertical");
    expect(h.getAttribute("aria-valuemin")).toBe("280");
    expect(h.getAttribute("aria-valuemax")).toBe("864");
    expect(h.getAttribute("aria-valuenow")).toBe("320");
  });

  it("dragging right widens a left panel, within 280 px and the maximum; the end remembers it", () => {
    const { h, onChange, onCommit } = mount("right");
    fireEvent.pointerDown(h, { button: 0, clientX: 320, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 420, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(420);
    fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(864); // the maximum
    fireEvent.pointerMove(h, { clientX: -900, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(280); // the minimum
    fireEvent.pointerUp(h, { clientX: 350, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(350);
  });

  it("on the right panel the sign is the other way (dragging left widens)", () => {
    const { h, onChange } = mount("left");
    fireEvent.pointerDown(h, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 940, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(380);
  });

  it("moving without pressing does nothing; double-click resets", () => {
    const { h, onChange, onReset } = mount();
    fireEvent.pointerMove(h, { clientX: 900, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(h);
    expect(onReset).toHaveBeenCalled();
  });

  it("arrow keys resize by 16 (Shift 64), Home / End go to the ends, Enter resets", () => {
    const { h, onChange, onCommit, onReset } = mount("right", 320);
    fireEvent.keyDown(h, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(336);
    fireEvent.keyDown(h, { key: "ArrowLeft", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(280);
    fireEvent.keyDown(h, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(864);
    fireEvent.keyDown(h, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(280);
    fireEvent.keyDown(h, { key: "Enter" });
    expect(onReset).toHaveBeenCalled();
  });
});

describe("up / down through the pages", () => {
  const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("moves to the neighbour and stops at both ends", () => {
    expect(pageNeighbour(pages, "b", "ArrowDown")?.id).toBe("c");
    expect(pageNeighbour(pages, "b", "ArrowUp")?.id).toBe("a");
    expect(pageNeighbour(pages, "c", "ArrowDown")).toBeNull();
    expect(pageNeighbour(pages, "a", "ArrowUp")).toBeNull();
    expect(pageNeighbour(pages, null, "ArrowDown")?.id).toBe("a");
    expect(pageNeighbour(pages, null, "ArrowUp")?.id).toBe("c");
    expect(pageNeighbour([], "a", "ArrowDown")).toBeNull();
  });
});

describe("page cards: compact until selected; chips are steps", () => {
  const actions = {
    build: vi.fn(),
    setRole: vi.fn(),
    setColumnPlan: vi.fn(),
    setTos: vi.fn(),
    setScale: vi.fn(),
    noBeams: vi.fn(),
    addView: vi.fn(),
  } as unknown as PageActions;
  const pg = (over: Partial<Page> = {}): Page =>
    ({
      id: "s1",
      page_index: 2,
      page_number: 3,
      sheet_number: "S-102",
      title: null,
      name: "First floor framing plan with a long descriptive title",
      page_type: "framing_plan",
      page_kind: "vector",
      width_pt: 1000,
      height_pt: 800,
      rotation: 0,
      thumbnail_url: null,
      badge: "Scale needed",
      reasons: [],
      notes: [],
      system_values: [],
      setup: {
        role: "framing",
        crop: null,
        pen_class: null,
        pen_class_source: null,
        scale_ratio: null,
        scale_text: null,
        tos_mm: null,
        tos_raw: null,
        column_plan_sheet_id: null,
      },
      scales_found: [],
      built_at: null,
      reviewed_by: null,
      reviewed_at: null,
      pending_edits: 0,
      counts: {
        pieces: 0,
        beams: 0,
        columns: 0,
        braces: 0,
        found: 0,
        needs_review: 0,
        attention: 0,
      },
      ...over,
    }) as Page;
  const card = (selected: boolean, page = pg()) =>
    render(
      <PageCard
        page={page}
        columnPlans={[]}
        selected={selected}
        onSelect={() => undefined}
        actions={actions}
        notes={{ projectId: "p", who: "ann" }}
      />,
    );

  it("a card that is not selected shows name, sheet, status and the notes action; no setup", () => {
    card(false);
    expect(screen.getByTestId("card-status").textContent).toContain(
      "Scale needed",
    );
    expect(screen.getByTestId("sheet-name")).toBeTruthy();
    expect(screen.getByTestId("notes-add")).toBeTruthy();
    expect(screen.queryByTestId("card-setup")).toBeNull();
    expect(screen.queryByTestId("views")).toBeNull();
    expect(screen.queryByTestId("setup-chips")).toBeNull();
    expect(screen.queryByLabelText("scale")).toBeNull();
  });

  it("the selected card expands: views, role, scale and the chips (status on the thumbnail)", () => {
    card(true);
    expect(screen.getByTestId("card-setup")).toBeTruthy();
    expect(screen.getByTestId("views")).toBeTruthy();
    expect(screen.getByTestId("setup-chips")).toBeTruthy();
    expect(screen.queryByTestId("card-status")).toBeNull();
    expect(screen.getByText("Scale needed")).toBeTruthy();
  });

  it("long names and titles carry a tooltip (they truncate, never clip silently)", () => {
    card(false);
    expect(screen.getByText(/Page 3 \|/).getAttribute("title")).toContain(
      "Page 3 |",
    );
    expect(screen.getByTestId("sheet-name").getAttribute("title")).toBeTruthy();
  });

  it("to do = amber 'not set' with its step word, done = green with a tick; red is not used for to-do", () => {
    card(true);
    const chips = [
      ...screen.getByTestId("setup-chips").querySelectorAll("[data-state]"),
    ];
    const by = (txt: string) =>
      chips.find((c) => c.textContent!.includes(txt))!;
    expect(by("Crop").textContent).toContain("Crop: not set");
    expect(by("Crop").getAttribute("data-state")).toBe("missing");
    expect(by("Crop").className).toContain("missing"); // styled amber outline, see theme.css
    expect(by("Scale").textContent).toContain("Scale: not set");
    expect(chips.some((c) => c.className.includes("problem"))).toBe(false);
    expect(screen.getByTestId("pen-chip").textContent).toContain(
      "Pen: not set",
    );
    // done: a tick, no "not set"
    cleanup();
    card(
      true,
      pg({
        setup: {
          role: "framing",
          crop: { x0: 0, y0: 0, x1: 900, y1: 700 },
          pen_class: "p",
          pen_class_source: "person",
          scale_ratio: 96,
          scale_text: `1/8" = 1'-0"`,
          tos_mm: null,
          tos_raw: null,
          column_plan_sheet_id: null,
        },
      } as Partial<Page>),
    );
    expect(screen.getByTestId("setup-chips").textContent).not.toContain(
      "Crop: not set",
    );
  });
});
