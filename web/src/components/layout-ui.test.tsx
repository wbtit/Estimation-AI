// @vitest-environment jsdom
// The workspace layout: remembered panel state (storage may throw), the drawer, the collapsible
// properties panel and its sections (SYNTHETIC).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSPECTOR_POS,
  loadDrawer,
  loadFlag,
  loadJson,
  loadPanel,
  saveDrawer,
  saveFlag,
  saveJson,
  savePanel,
} from "../lib/ui-state";
import { Drawer } from "./Drawer";
import { StatusLegend } from "./Canvas";
import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("remembered panel state", () => {
  it("is per person, defaults when nothing is stored, and survives blocked storage", () => {
    expect(loadFlag("left", true, "ann")).toBe(true);
    saveFlag("left", false, "ann");
    expect(loadFlag("left", true, "ann")).toBe(false);
    expect(loadFlag("left", true, "bob")).toBe(true); // another person has their own
    saveDrawer("details", "ann");
    expect(loadDrawer("ann")).toBe("details");
    expect(loadDrawer("bob")).toBeNull();
    saveDrawer(null, "ann");
    expect(loadDrawer("ann")).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadFlag("left", false, "ann")).toBe(false);
    expect(() => saveFlag("left", true, "ann")).not.toThrow();
    expect(loadDrawer("ann")).toBeNull();
    expect(() => saveDrawer("profile", "ann")).not.toThrow();
  });
});

describe("drawer", () => {
  it("has a title and a close button", () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Project details" onClose={onClose}>
        <span>body</span>
      </Drawer>,
    );
    expect(screen.getByLabelText("Project details")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("close Project details"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("properties panel", () => {
  const props = {
    bomRows: [],
    sheetId: "s",
    selected: [],
    kinds: [],
    crop: null,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCropTool: vi.fn(),
  };

  it("has a close button, and each section opens and closes and is remembered", () => {
    const onCollapse = vi.fn();
    const { unmount } = render(
      <PropertiesPanel {...props} onCollapse={onCollapse} />,
    );
    fireEvent.click(screen.getByLabelText("close properties"));
    expect(onCollapse).toHaveBeenCalled();
    const head = screen.getByText("Sheet Summary").closest("button")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    unmount();
    render(<PropertiesPanel {...props} />);
    expect(
      screen
        .getByText("Sheet Summary")
        .closest("button")!
        .getAttribute("aria-expanded"),
    ).toBe("false"); // remembered
    expect(
      screen
        .getByText("Project Summary")
        .closest("button")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

describe("one panel beside the rail, remembered per person", () => {
  it("defaults to Pages, remembers the panel (or none), and reads the old two-flag state", () => {
    expect(loadPanel("ann")).toBe("pages");
    savePanel("details", "ann");
    expect(loadPanel("ann")).toBe("details");
    savePanel(null, "ann");
    expect(loadPanel("ann")).toBeNull(); // closed stays closed
    expect(loadPanel("bob")).toBe("pages");
    // before the rail there were two flags: a closed left panel, an open drawer
    localStorage.clear();
    saveFlag("left", false, "cy");
    expect(loadPanel("cy")).toBeNull();
    saveDrawer("profile", "cy");
    expect(loadPanel("cy")).toBe("profile");
  });

  it("the inspector position is remembered, and blocked storage gives the defaults", () => {
    expect(loadJson("inspector.pos", INSPECTOR_POS, "ann")).toEqual(
      INSPECTOR_POS,
    );
    saveJson("inspector.pos", { right: 40, top: 90 }, "ann");
    expect(loadJson("inspector.pos", INSPECTOR_POS, "ann")).toEqual({
      right: 40,
      top: 90,
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadJson("inspector.pos", INSPECTOR_POS, "ann")).toEqual(
      INSPECTOR_POS,
    );
    expect(() =>
      saveJson("inspector.pos", { right: 1, top: 1 }, "ann"),
    ).not.toThrow();
    expect(loadPanel("ann")).toBe("pages");
  });
});

describe("the inspector: dock, float, drag, collapse", () => {
  const props = {
    bomRows: [],
    sheetId: "s",
    selected: [],
    kinds: [],
    crop: null,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCropTool: vi.fn(),
  };

  it("docked: a float button and a close button; no collapse, no drag", () => {
    const onToggleFloat = vi.fn();
    render(
      <PropertiesPanel
        {...props}
        onCollapse={vi.fn()}
        onToggleFloat={onToggleFloat}
      />,
    );
    fireEvent.click(screen.getByLabelText("float properties"));
    expect(onToggleFloat).toHaveBeenCalled();
    expect(screen.queryByLabelText("collapse properties")).toBeNull();
    expect(document.querySelector(".panel-head.draggable")).toBeNull();
  });

  it("floating: dock button, collapse to the header and back, a drag handle that the buttons do not start", () => {
    const onToggleFloat = vi.fn();
    const onToggleCollapsed = vi.fn();
    const onDragStart = vi.fn();
    const { rerender } = render(
      <PropertiesPanel
        {...props}
        floating
        onCollapse={vi.fn()}
        onToggleFloat={onToggleFloat}
        onToggleCollapsed={onToggleCollapsed}
        onDragStart={onDragStart}
      />,
    );
    fireEvent.pointerDown(document.querySelector(".panel-head.draggable")!);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    for (const l of [
      "dock properties right",
      "collapse properties",
      "close properties",
    ]) {
      fireEvent.pointerDown(screen.getByLabelText(l)); // a button press is not a drag
    }
    expect(onDragStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("dock properties right"));
    expect(onToggleFloat).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("collapse properties"));
    expect(onToggleCollapsed).toHaveBeenCalled();
    expect(screen.getByText("Sheet Summary")).toBeTruthy();
    rerender(
      <PropertiesPanel
        {...props}
        floating
        collapsed
        onCollapse={vi.fn()}
        onToggleFloat={onToggleFloat}
        onToggleCollapsed={onToggleCollapsed}
        onDragStart={onDragStart}
      />,
    );
    // collapsed: only the header is left (nothing of the work is hidden behind more than that)
    expect(screen.queryByText("Sheet Summary")).toBeNull();
    expect(screen.getByLabelText("expand properties")).toBeTruthy();
    expect(screen.getByLabelText("close properties")).toBeTruthy();
  });
});

describe("status legend", () => {
  it("names the three states, each with its glyph", () => {
    render(<StatusLegend />);
    const t = screen.getByTestId("status-legend").textContent!;
    expect(t).toContain("✓");
    expect(t).toContain("approved");
    expect(t).toContain("?");
    expect(t).toContain("check");
    expect(t).toContain("!");
    expect(t).toContain("problem");
  });
});
