// @vitest-environment jsdom
// Phase 14f: the red Pen chip (Pick a beam pen / No beams), the card note, a Build's warnings on the
// card and badge, and the tooltips of the missing chips (SYNTHETIC).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLUMN_PLAN_HINT,
  notBuiltNote,
  setupNeeds,
  PEN_HINT,
  setupChips,
  type Page,
  type PageViewInfo,
} from "../lib/lf";
import { PageCard, type PageActions } from "./PageCard";

afterEach(cleanup);

const counts = {
  pieces: 0,
  beams: 0,
  columns: 0,
  braces: 0,
  found: 0,
  needs_review: 0,
  attention: 0,
};

const view = (over: Partial<PageViewInfo> = {}): PageViewInfo => ({
  id: "v1",
  position: 1,
  name: "View 1",
  box: { x0: 100, y0: 100, x1: 500, y1: 400 },
  role_name: "Framing plan",
  behaviour: "framing",
  scale_ratio: 96,
  scale_text: null,
  tos_mm: null,
  tos_raw: null,
  pens: [],
  no_beams: false,
  column_plan_view_id: null,
  column_plan_sheet_id: null,
  exclusions: [],
  deselections: [],
  setup_changed_at: null,
  built_at: null,
  badge: "Not built",
  reasons: ["no beam pen class"],
  system_values: [],
  counts,
  ...over,
});

const page = (v: PageViewInfo, over: Partial<Page> = {}): Page =>
  ({
    id: "s1",
    page_index: 11,
    page_number: 12,
    sheet_number: "S-1",
    title: null,
    page_type: "framing_plan",
    page_kind: "vector",
    width_pt: 1000,
    height_pt: 800,
    rotation: 0,
    thumbnail_url: null,
    badge: v.badge,
    reasons: v.reasons,
    notes: [],
    warnings: v.warnings ?? [],
    system_values: v.system_values,
    setup: {
      role: "framing",
      crop: v.box,
      pen_class: null,
      pen_class_source: null,
      scale_ratio: 96,
      scale_text: null,
      tos_mm: null,
      tos_raw: null,
      column_plan_sheet_id: null,
    },
    views: [v],
    scales_found: [],
    built_at: null,
    reviewed_by: null,
    reviewed_at: null,
    pending_edits: 0,
    counts,
    ...over,
  }) as Page;

function actions(): PageActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    build: vi.fn(),
    setRole: vi.fn(),
    setColumnPlan: vi.fn(),
    setTos: vi.fn(),
    setScale: vi.fn(),
    noBeams: vi.fn(),
    pickPen: vi.fn(),
  };
}

const card = (a: PageActions, p: Page) =>
  render(
    <PageCard
      page={p}
      columnPlans={[]}
      selected
      onSelect={() => undefined}
      actions={a}
      activeViewId="v1"
      onActiveView={() => undefined}
    />,
  );

describe("the red Pen chip", () => {
  it("says what to do and offers Pick a beam pen and No beams", () => {
    const a = actions();
    card(a, page(view()));
    const chip = screen.getByTestId("pen-chip");
    expect(chip.getAttribute("title")).toBe(PEN_HINT);
    expect(screen.getByTestId("need-pen").textContent).toBe(
      "Set the beam line style (Pen)",
    );
    fireEvent.click(chip);
    expect(screen.getByTestId("pen-menu").textContent).toContain(PEN_HINT);
    fireEvent.click(screen.getByText("Pick a beam pen"));
    expect(a.pickPen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
    );
    fireEvent.click(screen.getByTestId("pen-chip"));
    fireEvent.click(screen.getByText("No beams"));
    expect(a.noBeams).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
    );
  });

  it("is a plain chip once a pen or No beams is set", () => {
    card(
      actions(),
      page(view({ no_beams: true, reasons: [], badge: "Requesting Build" })),
    );
    expect(screen.queryByTestId("pen-chip")).toBeNull();
  });
});

describe("the card note", () => {
  it("names every missing item by name, never just a count", () => {
    expect(notBuiltNote(["no beam pen class"])).toBe(
      "Not built: Set the beam line style (Pen)",
    );
    expect(notBuiltNote(["no crop", "View 2: no beam pen class"])).toBe(
      "Not built: Confirm the crop; Set the beam line style (Pen)",
    );
    expect(notBuiltNote(["scale not confirmed", "no scale"])).toBe(
      "Not built: Confirm the scale",
    );
    expect(
      notBuiltNote([
        "page role not set (column plan or framing)",
        "build the foundation / column plan page first, or say the job has none",
      ]),
    ).toBe(
      "Not built: Set the page role; Choose the foundation / column plan page, or None (⋮ menu)",
    );
  });

  it("a failed Build's error is shown as a problem, not as a thing to set", () => {
    expect(notBuiltNote(["UndefinedColumn"])).toBe(
      "Not built: Build problem: UndefinedColumn",
    );
    expect(setupNeeds(["UndefinedColumn"])[0]!.key).toBe("other");
  });

  it("each named item on the card jumps to its step", () => {
    const a = actions();
    card(
      a,
      page(
        view({
          badge: "Not built",
          reasons: ["no beam pen class", "scale not confirmed"],
        }),
      ),
    );
    expect(screen.getByTestId("card-note").textContent).toContain(
      "Set the beam line style (Pen)",
    );
    fireEvent.click(screen.getByTestId("need-pen"));
    expect(a.pickPen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("need-scale"));
    expect(document.activeElement).toBe(screen.getByLabelText("scale"));
  });
});

describe("a Build's warnings", () => {
  it("show on the card and on the badge", () => {
    const w =
      "Built without column supports: the column plan page is not built";
    card(
      actions(),
      page(
        view({
          badge: "Built",
          reasons: [],
          pens: [{ pen_class: "p", position: 1, source: "person" }],
          warnings: [w],
          built_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    expect(screen.getByTestId("card-warning").textContent).toBe(`⚠ ${w}`);
    expect(screen.getByTestId("badge-warning")).toBeTruthy();
    expect(
      screen.getByTestId("badge-warning").parentElement!.getAttribute("title"),
    ).toContain(w);
  });
});

describe("missing chip tooltips", () => {
  it("Pen and Column plan say how to set them", () => {
    const chips = setupChips(
      view({ system_values: ["column_plan"], pens: [] }),
    );
    expect(chips.find((c) => c.key === "pen")!.tip).toBe(PEN_HINT);
    expect(chips.find((c) => c.key === "column_plan")!.tip).toBe(
      "Choose the foundation / column plan page or None (⋮ menu)",
    );
    expect(COLUMN_PLAN_HINT).toBe(
      "Choose the foundation / column plan page or None (⋮ menu)",
    );
    expect(chips.find((c) => c.key === "role")!.tip).toBe("Role: confirmed");
  });
});

describe("Foundation / column plan: the chip links by itself", () => {
  const chipOf = (choices?: number) =>
    setupChips(
      view({
        system_values: ["column_plan"],
        pens: [{ pen_class: "a|b|c" } as never],
      }),
      choices === undefined ? {} : { columnPlanChoices: choices },
    ).find((c) => c.key === "column_plan")!;

  it("exactly one built page: linked automatically (not red); none: built without supports (not red)", () => {
    const one = chipOf(1);
    expect(one.state).toBe("system");
    expect(one.tip).toContain("only foundation / column plan page");
    expect(chipOf(0).state).toBe("system");
    expect(chipOf(0).tip).toContain("without column supports");
  });

  it("several built pages and no choice: red, and it asks; the old rule when the count is unknown", () => {
    expect(chipOf(2).state).toBe("missing");
    expect(chipOf(2).tip).toBe(COLUMN_PLAN_HINT);
    expect(chipOf(undefined).state).toBe("missing");
    expect(chipOf(2).label).toBe("Column page");
  });
});

describe("Cover / Title page suggestion", () => {
  const roles = [
    { name: "Cover / Title page", behaviour: "none", built_in: true },
    { name: "Notes", behaviour: "none", built_in: true },
  ] as never[];
  const renderCard = (a: PageActions, role: string | null) =>
    render(
      <PageCard
        page={page(view({ role_name: role, behaviour: role ? "none" : null }), {
          page_type: "cover_sheet",
        })}
        columnPlans={[]}
        selected
        roles={roles}
        onSelect={() => undefined}
        actions={a}
        activeViewId="v1"
        onActiveView={() => undefined}
      />,
    );

  it("a cover-sheet guess offers the role with one click; it never sets it by itself", () => {
    const a = actions();
    renderCard(a, null);
    expect(a.setRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cover / Title page: use"));
    expect(a.setRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
      "Cover / Title page",
    );
  });

  it("no suggestion once the page has a role", () => {
    renderCard(actions(), "Notes");
    expect(screen.queryByTestId("cover-suggestion")).toBeNull();
  });
});

describe("a page whose text could not be read", () => {
  it("shows 'page N: step: reason' on the card, and nothing when the text was read", () => {
    const msg = "page 12: reading text: RuntimeError: broken font";
    card(actions(), page(view(), { text_problem: msg }));
    expect(screen.getByTestId("card-text-problem").textContent).toBe(
      `⚠ Text not read — ${msg}`,
    );
    cleanup();
    card(actions(), page(view()));
    expect(screen.queryByTestId("card-text-problem")).toBeNull();
  });
});

describe("Beam lines: the page beam style (single / double / both)", () => {
  const withStyle = (a: ReturnType<typeof actions>) => {
    a.setBeamStyle = vi.fn();
    return a;
  };

  it("shows the learned style once the view has a pen, and a change asks for the override", () => {
    const a = withStyle(actions());
    card(
      a,
      page(
        view({
          pens: [
            {
              pen_class: "0.25-0.5|black|solid",
              position: 1,
              source: "person",
            },
          ],
          reasons: [],
          badge: "Requesting Build",
          beam_style: "double",
          beam_style_source: "learned",
          beam_gap_pt: 3.9,
          beam_style_evidence: { reason: "thin pair with a dashed centreline" },
        }),
      ),
    );
    const select = screen.getByTestId("beam-style") as HTMLSelectElement;
    expect(select.value).toBe("double");
    expect(select.title).toBe("thin pair with a dashed centreline");
    expect(screen.getByTestId("beam-style-note").textContent).toContain(
      "learned: two thin lines with a dashed centreline",
    );
    fireEvent.change(select, { target: { value: "both" } });
    expect(a.setBeamStyle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
      "both",
    );
  });

  it("a person's choice is labelled as theirs; no pen and no action: no control", () => {
    const a = withStyle(actions());
    card(
      a,
      page(
        view({
          pens: [{ pen_class: "p", position: 1, source: "person" }],
          reasons: [],
          badge: "Requesting Build",
          beam_style: "single",
          beam_style_source: "person",
        }),
      ),
    );
    expect(screen.getByTestId("beam-style").getAttribute("title")).toBe(
      "Set by a person",
    );
    expect(screen.queryByTestId("beam-style-note")).toBeNull();
    cleanup();
    card(withStyle(actions()), page(view()));
    expect(screen.queryByTestId("beam-style")).toBeNull(); // no pen yet
    cleanup();
    card(
      actions(),
      page(view({ pens: [{ pen_class: "p", position: 1, source: "person" }] })),
    );
    expect(screen.queryByTestId("beam-style")).toBeNull(); // the page cannot set it
  });
});
