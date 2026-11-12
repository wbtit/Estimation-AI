// @vitest-environment jsdom
// The workspace layout: remembered panel state (storage may throw), the drawer, the collapsible
// properties panel and its sections (SYNTHETIC).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDrawer, loadFlag, saveDrawer, saveFlag } from "../lib/ui-state";
import { Drawer } from "./Drawer";
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
