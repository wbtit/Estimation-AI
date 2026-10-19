// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_LAYERS,
  type BomRow,
  type Page,
  type PageViewInfo,
  type Piece,
  type Project,
  type RoleName,
} from "../lib/lf";
import { RoleSelect } from "./RoleSelect";
import { BomTab } from "./BomTab";
import { Canvas, PieceMark } from "./Canvas";
import { PageCard, type PageActions } from "./PageCard";
import {
  CreateDialog,
  processingSteps,
  ProjectsScreen,
} from "./ProjectsScreen";
import { PropertiesPanel } from "./PropertiesPanel";
import { ReportTab } from "./ReportTab";
import { undoneViewText } from "./Workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** fetch answering by URL prefix with JSON. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const body = key === undefined ? { error: "not found" } : routes[key];
      return {
        ok: key !== undefined,
        status: key === undefined ? 404 : 200,
        statusText: "",
        text: async () => JSON.stringify(body),
      };
    }),
  );
  return calls;
}

const project = (over: Partial<Project>): Project => ({
  id: "p1",
  name: "Alpha",
  number: "100",
  status: "scanned",
  stage: "Estimating",
  archived: false,
  created_at: "2026-01-02T00:00:00Z",
  thumbnail_url: null,
  document: {
    original_filename: "x.pdf",
    page_count: 3,
    pages_scanned: 3,
    scan_status: "done",
  },
  ...over,
});

function page(over: Partial<Page> = {}): Page {
  return {
    id: "s1",
    page_index: 4,
    page_number: 5,
    sheet_number: "S-201",
    title: null,
    page_type: "framing_plan",
    page_kind: "vector",
    width_pt: 1000,
    height_pt: 800,
    rotation: 0,
    thumbnail_url: null,
    badge: "Not confirmed",
    reasons: [],
    notes: [],
    system_values: ["crop", "pen_class"],
    setup: {
      role: "framing",
      crop: { x0: 0, y0: 0, x1: 900, y1: 700 },
      pen_class: "1.5-2.5|black|solid",
      pen_class_source: "suggested",
      scale_ratio: 96,
      scale_text: `1/8" = 1'-0"`,
      tos_mm: null,
      tos_raw: null,
      column_plan_sheet_id: null,
    },
    scales_found: [{ raw: `1/8" = 1'-0"`, kind: "ratio", ratio: 96, count: 2 }],
    built_at: "2026-01-02T00:00:00Z",
    reviewed_by: null,
    reviewed_at: null,
    pending_edits: 0,
    counts: {
      pieces: 3,
      beams: 3,
      columns: 0,
      braces: 0,
      found: 2,
      needs_review: 0,
      attention: 1,
    },
    ...over,
  };
}

function piece(over: Partial<Piece>): Piece {
  return {
    id: "a",
    member_id: "LF-B-1",
    sheet_id: "s1",
    type: "beam",
    kind: "Beams",
    tag: "BE1",
    quantity: 1,
    profile: "W16X26",
    profile_raw: "W16X26",
    studs: 12,
    camber_raw: null,
    ignored: false,
    deleted: false,
    added: false,
    edited: false,
    a: [100, 100],
    b: [300, 100],
    ends_moved: false,
    length_mm: 6096,
    elevation_mm: 4051.3,
    build_state: "found",
    size_state: "sized",
    support_state: "both",
    piece_index: 1,
    scale_ratio: 96,
    evidence: {
      size: {
        state: "sized",
        rule: "parallel",
        distance_pt: 8.5,
        box: [110, 90, 150, 96],
      },
    },
    ...over,
  };
}

const row = (over: Partial<BomRow>): BomRow => ({
  main: 1,
  category: "Beams",
  piecemark: "BE1",
  qty: 1,
  section_type: "W",
  section: "W16X26",
  length_mm: 6096,
  grade: null,
  weight_kg: 236,
  weight_lb: 520,
  member: "m1",
  sheet_id: "s1",
  build_state: "found",
  in_main_total: true,
  ...over,
});

describe("projects screen", () => {
  it("shows a card per project with its status, and searches", async () => {
    stubFetch({
      "/api/projects": {
        projects: [
          project({}),
          project({ id: "p2", name: "Beta", stage: "Won", number: null }),
        ],
      },
    });
    const onOpen = vi.fn();
    render(<ProjectsScreen onOpen={onOpen} />);
    await screen.findByText("Beta");
    expect(screen.getByText("Won")).toBeTruthy();
    expect(screen.getByText("Add new project")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("search projects"), {
      target: { value: "bet" },
    });
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(screen.getByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("p2");
  });

  it("hides archived projects unless Show archived is on", async () => {
    stubFetch({
      "/api/projects": {
        projects: [
          project({}),
          project({ id: "p2", name: "Old test", archived: true }),
        ],
      },
    });
    render(<ProjectsScreen onOpen={() => undefined} />);
    await screen.findByText("Alpha");
    expect(screen.queryByText("Old test")).toBeNull();
    fireEvent.click(screen.getByLabelText("show archived"));
    expect(screen.getByText("Old test")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("create dialog: the name comes from the file; Create sends name, number and status", async () => {
    const calls = stubFetch({ "/api/projects": project({ id: "new" }) });
    const upload = vi.fn(async () => undefined);
    const onCreated = vi.fn();
    render(
      <CreateDialog
        onClose={() => undefined}
        onCreated={onCreated}
        upload={upload}
      />,
    );
    const file = new File(["%PDF"], "North_Tower set.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("drawing file"), {
      target: { files: [file] },
    });
    expect(
      (screen.getByLabelText("project name") as HTMLInputElement).value,
    ).toBe("North Tower set");
    fireEvent.change(screen.getByLabelText("project number"), {
      target: { value: "24-07" },
    });
    fireEvent.change(screen.getByLabelText("project status"), {
      target: { value: "Submitted" },
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new"));
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      name: "North Tower set",
      number: "24-07",
      stage: "Submitted",
    });
    expect(upload).toHaveBeenCalledWith("new", file);
  });

  it("processing steps follow the scan, the pipeline and auto mode", () => {
    const s = processingSteps({
      scan: { status: "done", pages: 10, pages_done: 10 },
      pipeline: { status: "completed", error: null },
      auto_build: { status: "running", pages: 10, pages_done: 4, error: null },
    });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "running"]);
    expect(s[3]!.detail).toBe("4/10");
    expect(processingSteps(null).map((x) => x.state)).toEqual([
      "done",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });
});

function actions(): PageActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    build: vi.fn(),
    setRole: vi.fn(),
    setColumnPlan: vi.fn(),
    setTos: vi.fn(),
    setScale: vi.fn(),
    noBeams: vi.fn(),
    addView: vi.fn(),
  };
}

describe("page card", () => {
  it("shows Page N | type, the sheet number and the badges on the thumbnail; ▶ builds", () => {
    const a = actions();
    render(
      <PageCard
        page={page()}
        columnPlans={[]}
        selected
        onSelect={() => undefined}
        actions={a}
      />,
    );
    expect(screen.getByText("Page 5 | Framing")).toBeTruthy();
    expect(screen.getByText("Sheet S-201")).toBeTruthy();
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("Estimating")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("build page"));
    expect(a.build).toHaveBeenCalled();
  });

  it("shows Top of Steel, Scale and the setup chips only on the selected card", () => {
    const { rerender } = render(
      <PageCard
        page={page()}
        columnPlans={[]}
        selected={false}
        onSelect={() => undefined}
        actions={actions()}
      />,
    );
    expect(screen.queryByLabelText("top of steel")).toBeNull();
    expect(screen.queryByLabelText("scale")).toBeNull();
    rerender(
      <PageCard
        page={page()}
        columnPlans={[]}
        selected
        onSelect={() => undefined}
        actions={actions()}
      />,
    );
    expect(screen.getByLabelText("top of steel")).toBeTruthy();
    expect(screen.getByText("Setup")).toBeTruthy();
    expect(screen.getByTestId("setup-chips")).toBeTruthy();
  });

  it("a skipped page shows Skip once", () => {
    render(
      <PageCard
        page={page({ badge: "Skip", setup: { ...page().setup, role: null } })}
        columnPlans={[]}
        selected={false}
        onSelect={() => undefined}
        actions={actions()}
      />,
    );
    expect(screen.getAllByText("Skip")).toHaveLength(1);
  });

  it("⋮ No beams sets the beam pen to none", () => {
    const a = actions();
    render(
      <PageCard
        page={page({ setup: { ...page().setup, role: "column_plan" } })}
        columnPlans={[]}
        selected={false}
        onSelect={() => undefined}
        actions={a}
      />,
    );
    fireEvent.click(screen.getByLabelText("page menu"));
    fireEvent.click(screen.getByText("No beams"));
    expect(a.noBeams).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      null,
    );
  });

  it("⋮ sets the column plan of the view", () => {
    const a = actions();
    const plan = page({
      id: "s0",
      page_number: 2,
      setup: { ...page().setup, role: "column_plan" },
    });
    render(
      <PageCard
        page={page()}
        columnPlans={[plan]}
        selected={false}
        onSelect={() => undefined}
        actions={a}
      />,
    );
    fireEvent.click(screen.getByLabelText("page menu"));
    fireEvent.click(screen.getByText("Page 2 · S-201"));
    expect(a.setColumnPlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      null,
      "s0",
    );
  });

  it("the selected card lists the views; a view's fields are its own; + Add view", () => {
    const a = actions();
    const base = page();
    const v = (over: Partial<PageViewInfo>): PageViewInfo => ({
      id: "v1",
      position: 1,
      name: "View 1",
      box: null,
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
      badge: "Built",
      reasons: [],
      system_values: [],
      counts: base.counts,
      ...over,
    });
    const onActive = vi.fn();
    render(
      <PageCard
        page={page({
          views: [
            v({}),
            v({
              id: "v2",
              position: 2,
              name: "View 2",
              role_name: "Detail",
              behaviour: "none",
            }),
          ],
        })}
        columnPlans={[]}
        selected
        onSelect={() => undefined}
        actions={a}
        roles={ROLES}
        activeViewId="v2"
        onActiveView={onActive}
      />,
    );
    expect(screen.getByText("Page 5 | 2 views")).toBeTruthy();
    expect(screen.getByTestId("views").textContent).toContain("View 2");
    expect(screen.queryByLabelText("top of steel")).toBeNull(); // Detail: Don't build
    fireEvent.click(screen.getByText("View 1"));
    expect(onActive).toHaveBeenCalledWith("v1");
    fireEvent.click(screen.getByText("Add view"));
    expect(a.addView).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("role"));
    fireEvent.click(
      within(screen.getByTestId("role-menu")).getByText("Roof framing"),
    );
    expect(a.setRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v2",
      "Roof framing",
    );
  });

  it("Top of Steel is typed in feet-inches; a bare number is refused", () => {
    const a = actions();
    render(
      <PageCard
        page={page()}
        columnPlans={[]}
        selected
        onSelect={() => undefined}
        actions={a}
      />,
    );
    const tos = screen.getByLabelText("top of steel") as HTMLInputElement;
    fireEvent.change(tos, { target: { value: "4051" } });
    fireEvent.blur(tos);
    expect(a.setTos).not.toHaveBeenCalled();
    expect(tos.className).toBe("bad");
    fireEvent.change(tos, { target: { value: `13'-3 1/2"` } });
    fireEvent.blur(tos);
    expect(a.setTos).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.closeTo(4051.3, 1),
      `13'-3 1/2"`,
    );
  });

  it("shows T.O.S. in feet-inches and the scale with its ratio", () => {
    render(
      <PageCard
        page={page({ setup: { ...page().setup, tos_mm: 4051.3 } })}
        columnPlans={[]}
        selected
        onSelect={() => undefined}
        actions={actions()}
      />,
    );
    expect(
      (screen.getByLabelText("top of steel") as HTMLInputElement).value,
    ).toBe(`13'-3 1/2"`);
    expect(screen.getByText(`1/8" = 1'-0" (96)`)).toBeTruthy();
  });
});

const ROLES: RoleName[] = [
  { name: "Column plan", behaviour: "column_plan", built_in: true },
  { name: "Framing plan", behaviour: "framing", built_in: true },
  { name: "Roof framing", behaviour: "framing", built_in: true },
  { name: "Detail", behaviour: "none", built_in: true },
  { name: "Mezzanine", behaviour: "framing", built_in: false },
];

describe("role dropdown", () => {
  it("lists built-in and custom names with their behaviour; a new name asks once how to build it", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    render(
      <RoleSelect
        value="Framing plan"
        roles={ROLES}
        onPick={onPick}
        onCreate={onCreate}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByLabelText("role").textContent).toContain("Framing plan");
    expect(screen.getByLabelText("role").textContent).toContain("Framing");
    fireEvent.click(screen.getByLabelText("role"));
    const menu = screen.getByTestId("role-menu");
    expect(menu.textContent).toContain("Built-in");
    expect(menu.textContent).toContain("Custom");
    fireEvent.click(within(menu).getByText("Mezzanine"));
    expect(onPick).toHaveBeenCalledWith("Mezzanine");
    fireEvent.click(screen.getByLabelText("role"));
    fireEvent.click(screen.getByText("+ Type a new role…"));
    const input = screen.getByLabelText("new role name");
    fireEvent.change(input, { target: { value: "  Canopy   framing " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("role-ask").textContent).toContain(
      "Build “Canopy   framing” as:",
    );
    fireEvent.click(
      within(screen.getByTestId("role-ask")).getByText("Framing"),
    );
    expect(onCreate).toHaveBeenCalledWith("Canopy framing", "framing");
    // a typed name that exists is just picked (no question)
    fireEvent.click(screen.getByLabelText("role"));
    fireEvent.click(screen.getByText("+ Type a new role…"));
    const again = screen.getByLabelText("new role name");
    fireEvent.change(again, { target: { value: "detail" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("Detail");
    // custom names are editable later
    fireEvent.click(screen.getByLabelText("role"));
    fireEvent.click(screen.getByText("Edit custom roles…"));
    fireEvent.change(screen.getByLabelText("behaviour of Mezzanine"), {
      target: { value: "none" },
    });
    expect(onEdit).toHaveBeenCalledWith("Mezzanine", { behaviour: "none" });
  });
});

describe("properties", () => {
  const kinds = [
    { kind: "Beams", scope: "main", symbol_group: "linear" },
    { kind: "Column", scope: "main", symbol_group: "column" },
  ];

  it("Set size for all undefined beams of the view is one edit of all of them", () => {
    stubFetch({ "/api/catalog/sections": { sections: [] } });
    const onSetSizeAll = vi.fn();
    const viewPieces = [
      piece({ id: "u1", profile: null, build_state: "attention" }),
      piece({ id: "u2", profile: null, build_state: "attention" }),
      piece({ id: "ig", profile: null, ignored: true }),
      piece({ id: "ok" }),
      piece({ id: "c1", type: "column", b: null, profile: null }),
    ];
    render(
      <PropertiesPanel
        bomRows={[]}
        sheetId="s1"
        selected={[]}
        kinds={kinds}
        crop={null}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onCropTool={() => undefined}
        viewPieces={viewPieces}
        viewName="View 2"
        onSetSizeAll={onSetSizeAll}
      />,
    );
    const box = screen.getByTestId("set-size-all");
    expect(box.textContent).toContain(
      "Set size for all undefined beams in View 2 (2)",
    );
    expect(box.textContent).toContain(
      "Set size for all columns without a size in View 2 (1)",
    );
    fireEvent.click(
      screen.getByText("Set size for all undefined beams in View 2 (2)"),
    );
    const input = within(box).getByLabelText("section size");
    fireEvent.change(input, { target: { value: "W12X26" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSetSizeAll).toHaveBeenCalledTimes(1);
    expect(onSetSizeAll).toHaveBeenCalledWith(["u1", "u2"], "W12X26");
  });

  it("shows Mixed for different values, locked elevations in feet-inches and the summary in tons", () => {
    stubFetch({ "/api/catalog": { sections: [] } });
    render(
      <PropertiesPanel
        bomRows={[
          row({ weight_lb: 3000 }),
          row({ member: "m2", category: "Column", weight_lb: 1000 }),
        ]}
        sheetId="s1"
        selected={[
          piece({}),
          piece({ id: "b", profile: "W18X35", tag: "BE2" }),
        ]}
        kinds={kinds}
        crop={null}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onCropTool={() => undefined}
      />,
    );
    expect(
      (screen.getByLabelText("section size") as HTMLInputElement).value,
    ).toBe("Mixed");
    expect(screen.getAllByText("Mixed").length).toBeGreaterThan(0); // piecemark
    expect(
      screen.getAllByTitle("Top of Steel of the page (locked)"),
    ).toHaveLength(2);
    expect(
      screen.getAllByTitle("Top of Steel of the page (locked)")[0]!.textContent,
    ).toContain(`13'-3 1/2"`);
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.getByTestId("summary").textContent).toContain(
      "Total Weight (tons):2.00",
    );
  });

  it("a selection opens the Member tab; sections open and close; Delete is there", () => {
    const onDelete = vi.fn();
    render(
      <PropertiesPanel
        bomRows={[]}
        sheetId="s1"
        selected={[piece({})]}
        kinds={kinds}
        crop={null}
        onEdit={() => undefined}
        onDelete={onDelete}
        onCropTool={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Member Properties"));
    expect(screen.queryByText("Delete")).toBeNull();
    fireEvent.click(screen.getByText("Member Properties"));
    expect(screen.getByText("Delete")).toBeTruthy();
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.getByTestId("summary").textContent).toContain("Column:0");
  });

  it("edits studs and Ignore for the selection", () => {
    const onEdit = vi.fn();
    render(
      <PropertiesPanel
        bomRows={[]}
        sheetId="s1"
        selected={[piece({})]}
        kinds={kinds}
        crop={null}
        onEdit={onEdit}
        onDelete={() => undefined}
        onCropTool={() => undefined}
      />,
    );
    const studs = screen.getByLabelText("studs");
    fireEvent.change(studs, { target: { value: "14" } });
    fireEvent.blur(studs);
    expect(onEdit).toHaveBeenCalledWith({ studs: 14 });
    fireEvent.click(screen.getByLabelText("ignore"));
    expect(onEdit).toHaveBeenCalledWith({ ignored: true });
    fireEvent.change(screen.getByLabelText("member type"), {
      target: { value: "Column" },
    });
    expect(onEdit).toHaveBeenCalledWith({ kind: "Column" });
  });
});

describe("BOM tab", () => {
  it("filters by category and section and totals in lb", () => {
    const bom = {
      rows: [
        row({}),
        row({ member: "m2", section: "W18X35", weight_lb: 700 }),
        row({
          member: "m3",
          category: "Column",
          section: "W10X49",
          weight_lb: 1000,
        }),
      ],
      totals: { pieces: 3, length_mm: 0, weight_lb: 2220 },
      attention: { pieces: 0, length_mm: 0, weight_lb: 0 },
    };
    render(<BomTab bom={bom} projectId="p1" />);
    const table = screen.getByTestId("bom");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(4); // 3 rows + total
    fireEvent.change(screen.getByLabelText("category filter"), {
      target: { value: "Beams" },
    });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("section filter"), {
      target: { value: "W18X35" },
    });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.textContent).toContain("700");
    expect(table.textContent).toContain(`20'-0"`);
  });

  it("sorts by category, section, piecemark and shows a status dot", () => {
    const bom = {
      rows: [
        row({
          member: "c",
          category: "Column",
          section: null,
          piecemark: "C1",
          build_state: "attention",
          in_main_total: false,
        }),
        row({ member: "b10", piecemark: "B10" }),
        row({ member: "b2", piecemark: "B2", build_state: "needs_review" }),
      ],
      totals: { pieces: 2, length_mm: 0, weight_lb: 1040 },
      attention: { pieces: 1, length_mm: 0, weight_lb: 0 },
    };
    render(<BomTab bom={bom} projectId="p1" />);
    const rows = [...screen.getByTestId("bom").querySelectorAll("tbody tr")];
    expect(rows.slice(0, 3).map((r) => r.children[3]!.textContent)).toEqual([
      "B2",
      "B10",
      "C1",
    ]);
    expect(screen.getAllByTestId("status-dot").map((d) => d.className)).toEqual(
      ["dot needs_review", "dot found", "dot attention"],
    );
    expect(rows[2]!.className).toBe("");
  });
});

describe("report tab", () => {
  it("lists system vs final per page and per size", async () => {
    stubFetch({
      "/api/projects/p1/report": {
        pages: [
          {
            sheet_id: "s1",
            page_index: 4,
            sheet_number: "S-201",
            reviewed_by: "tester",
            system_pieces: 10,
            final_pieces: 11,
            kept_unchanged: 7,
            size_changed: 2,
            length_changed: 1,
            deleted_by_person: 1,
            ignored: 0,
            removed_by_rebuild: 0,
            added_by_person: 2,
            added_by_rebuild: 0,
            setup_changed: ["pen_class"],
            minutes: 12.5,
          },
        ],
        total: {
          system_pieces: 10,
          final_pieces: 11,
          kept_unchanged: 7,
          size_changed: 2,
          length_changed: 1,
          deleted_by_person: 1,
          ignored: 0,
          removed_by_rebuild: 0,
          added_by_person: 2,
          added_by_rebuild: 0,
          minutes: 12.5,
          pages_with_setup_changes: 1,
          pages_reviewed: 1,
        },
        sizes: [
          {
            size: "W16X26",
            system_count: 4,
            system_length_mm: 3810,
            final_count: 5,
            final_length_mm: 7620,
          },
        ],
      },
    });
    render(<ReportTab projectId="p1" />);
    await screen.findByText("pen_class");
    expect(screen.getByTestId("report-pages").textContent).toContain("12.5");
    expect(screen.getByTestId("report-sizes").textContent).toContain(`25'-0"`);
  });
});

describe("canvas", () => {
  it("draws a beam with its size, and (Show flags on) one orange flag and a tooltip for one that needs review", () => {
    const { container } = render(
      <svg>
        <PieceMark
          p={piece({ build_state: "needs_review", support_state: "one" })}
          px={1}
          on={false}
          labels
          flags
        />
      </svg>,
    );
    expect(container.querySelector("title")!.textContent).toContain(
      "Read: W16X26 (parallel at 8.5 pt)",
    );
    expect(container.querySelector("title")!.textContent).toContain(
      "one end not supported",
    );
    expect(container.querySelectorAll("[data-testid=flag]")).toHaveLength(1);
    expect(container.querySelector("path")!.getAttribute("fill")).toBe(
      "var(--review)",
    );
    expect(container.textContent).toContain("w16x26 <12>");
  });

  it("no flag on a found member, nor with Show flags off", () => {
    const { container } = render(
      <svg>
        <PieceMark p={piece({})} px={1} on={false} labels />
        <PieceMark
          p={piece({ id: "z", build_state: "attention" })}
          px={1}
          on={false}
          labels
          flags={false}
        />
      </svg>,
    );
    expect(container.querySelectorAll("[data-testid=flag]")).toHaveLength(0);
  });

  it("the toolbar shows the pending edit count on Undo and has the tools", () => {
    const onUndo = vi.fn();
    const noop = () => undefined;
    render(
      <Canvas
        pdf={null}
        page={page({ pending_edits: 3 })}
        data={null}
        lines={null}
        layers={ALL_LAYERS}
        onLayers={noop}
        selected={new Set()}
        onSelect={noop}
        pendingEdits={3}
        onCrop={noop}
        onPick={noop}
        onDraw={noop}
        onEnds={noop}
        onUndo={onUndo}
        onDeleteSelected={noop}
      />,
    );
    const order = [
      ...screen.getByTestId("toolbar").querySelectorAll("button"),
    ].map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual([
      "Select",
      "Hand",
      "Layers",
      "Crop",
      "Pick beam",
      "Exclude area",
      "Add view",
      "Draw beam",
      "Draw column",
      "Measure",
      "Undo",
    ]);
    expect(screen.getByLabelText("Crop").getAttribute("data-tip")).toBe(
      "Crop (C)",
    );
    expect(screen.getByLabelText("Hand").getAttribute("data-tip")).toBe(
      "Hand (H)",
    );
    // Fit and the zoom box sit in the bar above the canvas, not over the drawing
    const bar = screen.getByTestId("canvas-bar");
    expect(bar.querySelector("[aria-label=Fit]")).toBeTruthy();
    expect(bar.querySelector("[aria-label='zoom percent']")).toBeTruthy();
    expect(screen.getByLabelText("Select").className).toBe("on");
    const undo = screen.getByLabelText("Undo");
    expect(undo.textContent).toContain("3");
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Layers"));
    expect(screen.getByTestId("layers").textContent).toContain(
      "Undefined Beams",
    );
    expect(screen.getByTestId("layers").textContent).toContain("Show flags");
  });

  it("the issue navigator counts attention and review, and Next / N select in order", () => {
    const onSelect = vi.fn();
    const noop = () => undefined;
    const data = {
      sheet_id: "s1",
      crop: null,
      pen_class: null,
      tos_mm: null,
      scale_ratio: 96,
      grid_lines: [],
      pieces: [
        piece({
          id: "r",
          build_state: "needs_review",
          a: [10, 10],
          b: [50, 10],
        }),
        piece({
          id: "a2",
          build_state: "attention",
          a: [10, 300],
          b: [50, 300],
        }),
        piece({
          id: "a1",
          build_state: "attention",
          a: [10, 100],
          b: [50, 100],
        }),
        piece({ id: "ok" }),
      ],
    };
    render(
      <Canvas
        pdf={null}
        page={page()}
        data={data}
        lines={null}
        layers={ALL_LAYERS}
        onLayers={noop}
        selected={new Set()}
        onSelect={onSelect}
        pendingEdits={0}
        onCrop={noop}
        onPick={noop}
        onDraw={noop}
        onEnds={noop}
        onUndo={noop}
        onDeleteSelected={noop}
      />,
    );
    expect(screen.getByTestId("navigator").textContent).toContain(
      "2 need attention · 1 to review",
    );
    fireEvent.click(screen.getByLabelText("next issue"));
    expect(onSelect).toHaveBeenLastCalledWith(["a1"], false);
    fireEvent.keyDown(window, { key: "n" });
    expect(onSelect).toHaveBeenLastCalledWith(["a2"], false);
    fireEvent.keyDown(window, { key: "N", shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(["a1"], false);
  });

  it("Pick beam shows Replace / Add pen, the reset link and unmatched deselections", () => {
    const noop = () => undefined;
    const onReset = vi.fn();
    const view = {
      id: "v1",
      position: 1,
      name: "View 1",
      box: { x0: 0, y0: 0, x1: 900, y1: 700 },
      role_name: "Framing plan",
      behaviour: "framing" as const,
      scale_ratio: 96,
      scale_text: null,
      tos_mm: null,
      tos_raw: null,
      pens: [
        { pen_class: "1.5-2.5|black|solid", position: 1, source: "person" },
        { pen_class: "0.5-1|black|solid", position: 2, source: "person" },
      ],
      no_beams: false,
      column_plan_view_id: null,
      column_plan_sheet_id: null,
      exclusions: [],
      deselections: [
        { id: "d1", line: [1, 1, 2, 2] as [number, number, number, number] },
        { id: "d2", line: [3, 3, 4, 4] as [number, number, number, number] },
      ],
      setup_changed_at: null,
      built_at: null,
      deselections_unmatched: 2,
    };
    render(
      <Canvas
        pdf={null}
        page={page()}
        data={{
          sheet_id: "s1",
          crop: null,
          pen_class: null,
          tos_mm: null,
          scale_ratio: 96,
          grid_lines: [],
          pieces: [],
          views: [view],
        }}
        lines={null}
        layers={ALL_LAYERS}
        onLayers={noop}
        selected={new Set()}
        onSelect={noop}
        pendingEdits={0}
        onCrop={noop}
        onPick={noop}
        onDraw={noop}
        onEnds={noop}
        onUndo={noop}
        onDeleteSelected={noop}
        onResetDeselect={onReset}
      />,
    );
    fireEvent.click(screen.getByLabelText("Pick beam"));
    const bar = screen.getByTestId("pick-bar");
    expect(bar.textContent).toContain("Replace pen");
    expect(bar.textContent).toContain("Add pen");
    expect(screen.getByTestId("unmatched").textContent).toBe(
      "2 deselected lines not found",
    );
    fireEvent.click(screen.getByText("Reset deselections (2)"));
    expect(onReset).toHaveBeenCalled();
  });
});

// ---- Phase 11c polish round -----------------------------------------------------------------------
const pview = (over: Partial<PageViewInfo> = {}): PageViewInfo => ({
  id: "v1",
  position: 1,
  name: "View 1",
  box: { x0: 100, y0: 100, x1: 500, y1: 400 },
  role_name: "Framing plan",
  behaviour: "framing",
  scale_ratio: 96,
  scale_text: null,
  tos_mm: 4000,
  tos_raw: null,
  pens: [{ pen_class: "p", position: 1, source: "person" }],
  no_beams: false,
  column_plan_view_id: null,
  column_plan_sheet_id: "c1",
  exclusions: [],
  deselections: [],
  setup_changed_at: null,
  built_at: null,
  badge: "Built",
  reasons: [],
  system_values: [],
  counts: page().counts,
  ...over,
});

function canvasWith(over: Partial<React.ComponentProps<typeof Canvas>> = {}) {
  const noop = () => undefined;
  const props: React.ComponentProps<typeof Canvas> = {
    pdf: null,
    page: page(),
    data: {
      sheet_id: "s1",
      crop: null,
      pen_class: null,
      tos_mm: null,
      scale_ratio: 96,
      grid_lines: [],
      pieces: [],
      views: [pview()],
    },
    lines: null,
    layers: ALL_LAYERS,
    onLayers: noop,
    selected: new Set(),
    onSelect: noop,
    pendingEdits: 2,
    onCrop: noop,
    onPick: noop,
    onDraw: noop,
    onEnds: noop,
    onUndo: noop,
    onDeleteSelected: noop,
    ...over,
  };
  return render(<Canvas {...props} />);
}

describe("polish round: hand, keys, cancel", () => {
  it("H picks the hand; Space held shows the hand in any tool and release goes back", () => {
    canvasWith();
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByLabelText("Draw beam").className).toBe("on");
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByLabelText("Hand").className).toBe("on");
    expect(screen.getByLabelText("Draw beam").className).toBe("");
    expect(screen.getByTestId("canvas-bar").textContent).toContain(
      "Drag to move the page",
    );
    fireEvent.keyUp(window, { key: " " });
    expect(screen.getByLabelText("Draw beam").className).toBe("on");
    expect(screen.getByLabelText("Hand").className).toBe("");
    fireEvent.keyDown(window, { key: "h" });
    expect(screen.getByLabelText("Hand").className).toBe("on");
    fireEvent.keyDown(window, { key: "v" });
    expect(screen.getByLabelText("Select").className).toBe("on");
  });

  it("Esc cancels a view box being drawn; Ctrl+Z undoes; ? opens the shortcut sheet", () => {
    const onUndo = vi.fn();
    const onAddView = vi.fn();
    canvasWith({ onUndo, onAddView, toolAsk: { tool: "view", n: 1 } });
    expect(screen.getByLabelText("Add view").className).toBe("on");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByLabelText("Select").className).toBe("on");
    expect(onAddView).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("shortcuts").textContent).toContain(
      "Hand while held",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("shortcuts")).toBeNull();
  });

  it("Edit box shows the active view's box with handles; Done leaves it", () => {
    const { container } = canvasWith({
      pdf: { getPage: () => new Promise(() => undefined) } as never,
      toolAsk: { tool: "editBox", n: 1 },
    });
    expect(screen.getByTestId("editbox-bar").textContent).toContain("View 1");
    expect(
      container.querySelectorAll("[data-testid=edit-box] rect"),
    ).toHaveLength(9);
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("edit-box")).toBeNull();
  });

  it("a building view shows a spinner in the canvas bar", () => {
    canvasWith({ building: true });
    expect(screen.getByTestId("canvas-building").textContent).toContain(
      "Building",
    );
  });
});

describe("polish round: marks", () => {
  it("only an attention member glows", () => {
    const { container } = render(
      <svg>
        <PieceMark p={piece({ id: "f" })} px={1} on={false} labels />
        <PieceMark
          p={piece({ id: "r", tag: "R", build_state: "needs_review" })}
          px={1}
          on={false}
          labels
        />
        <PieceMark
          p={piece({ id: "x", tag: "X", build_state: "attention" })}
          px={1}
          on={false}
          labels
        />
        <PieceMark
          p={piece({
            id: "c",
            tag: "C",
            type: "column",
            build_state: "attention",
            b: null,
          })}
          px={1}
          on={false}
          labels
        />
        <PieceMark
          p={piece({
            id: "d",
            tag: "D",
            type: "column",
            b: null,
            build_state: "needs_review",
          })}
          px={1}
          on={false}
          labels
        />
      </svg>,
    );
    const glowing = [...container.querySelectorAll("[data-testid=glow]")].map(
      (g) => g.closest("[data-state]")!.getAttribute("data-state"),
    );
    expect(glowing).toEqual(["attention", "attention"]);
  });

  it("the read size is written only where it differs, or on hover / select / Show all", () => {
    const same = piece({
      studs: 12,
      evidence: { studs: { raw: "(12)", count: 12 } },
    });
    const changed = piece({ id: "b2", tag: "B2", profile: "W18X35" });
    const labels = (el: HTMLElement) =>
      [...el.querySelectorAll("[data-testid=size-label]")].map(
        (t) => t.textContent,
      );
    const a = render(
      <svg>
        <PieceMark p={same} px={1} on={false} labels />
        <PieceMark p={changed} px={1} on={false} labels />
      </svg>,
    );
    expect(labels(a.container)).toEqual(["w18x35 <12>"]);
    a.unmount();
    const b = render(
      <svg>
        <PieceMark p={same} px={1} on={false} hover labels />
        <PieceMark p={same} px={1} on labels />
        <PieceMark p={same} px={1} on={false} labels allSizes />
        <PieceMark p={changed} px={1} on={false} labels={false} />
      </svg>,
    );
    expect(labels(b.container)).toEqual([
      "w16x26 <12>",
      "w16x26 <12>",
      "w16x26 <12>",
    ]);
  });

  it("the mark is thin at low zoom and capped at high zoom (screen px)", () => {
    const width = (px: number) => {
      const { container, unmount } = render(
        <svg>
          <PieceMark p={piece({})} px={px} on={false} labels={false} />
        </svg>,
      );
      // the coloured line: the one with the kind colour
      const line = [...container.querySelectorAll("line")].find(
        (l) => l.getAttribute("stroke") === "var(--beam)",
      )!;
      const w = Number(line.getAttribute("stroke-width")) / px;
      unmount();
      return w;
    };
    expect(width(1 / 0.3)).toBeCloseTo(1.25);
    expect(width(1 / 1.2)).toBeCloseTo(2.4);
    expect(width(1 / 6)).toBeCloseTo(4);
  });
});

describe("polish round: views on the card", () => {
  const twoViews = () =>
    page({
      views: [
        pview(),
        pview({ id: "v2", position: 2, name: "View 2", badge: "Building" }),
      ],
    });
  const card = (a: PageActions, p = twoViews()) =>
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

  it("a view chip menu: Rename, Edit box, Delete; View 1 offers Reset box instead of Delete", () => {
    const a = {
      ...actions(),
      deleteView: vi.fn(),
      renameView: vi.fn(),
      editBox: vi.fn(),
      resetBox: vi.fn(),
    };
    card(a);
    fireEvent.click(screen.getByLabelText("View 2 menu"));
    const menu = screen.getByTestId("view-menu");
    expect(menu.textContent).toContain("Delete view");
    fireEvent.click(within(menu).getByText("Delete view"));
    expect(a.deleteView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v2",
    );
    fireEvent.click(screen.getByLabelText("View 1 menu"));
    const m1 = screen.getByTestId("view-menu");
    expect(m1.textContent).not.toContain("Delete");
    fireEvent.click(within(m1).getByText("Reset box to page crop"));
    expect(a.resetBox).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
    );
    fireEvent.click(screen.getByLabelText("View 1 menu"));
    fireEvent.click(
      within(screen.getByTestId("view-menu")).getByText("Edit box"),
    );
    expect(a.editBox).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v1",
    );
    fireEvent.click(screen.getByLabelText("View 2 menu"));
    fireEvent.click(
      within(screen.getByTestId("view-menu")).getByText("Rename"),
    );
    const input = screen.getByLabelText("rename View 2");
    fireEvent.change(input, { target: { value: "Partial plan" } });
    fireEvent.blur(input);
    expect(a.renameView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "v2",
      "Partial plan",
    );
  });

  it("while a view builds: a spinner on the card and ▶ disabled", () => {
    card(actions());
    expect(screen.getByTestId("card-building")).toBeTruthy();
    expect(
      (screen.getByLabelText("build page") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("setup chips: green, grey, red", () => {
    card(
      actions(),
      page({
        views: [pview({ system_values: ["scale"], tos_mm: null })],
      }),
    );
    const chips = [...screen.getByTestId("setup-chips").children].map(
      (c) => `${c.textContent}:${c.getAttribute("data-state")}`,
    );
    expect(chips).toEqual([
      "Role:ok",
      "Crop:ok",
      "Scale:system",
      "Pen:ok",
      "Column plan:ok",
      "!T.O.S.:missing",
    ]);
  });

  it("the undo toast names what a view undo did", () => {
    const base = { applied: true, pieces_restored: 0, pieces_removed: 0 };
    expect(
      undoneViewText({ ...base, kind: "delete", pieces_restored: 12 }),
    ).toBe("View restored with 12 pieces");
    expect(undoneViewText({ ...base, kind: "add" })).toBe("View add undone");
    expect(undoneViewText({ ...base, kind: "box" })).toBe("View box put back");
    expect(undoneViewText({ ...base, kind: "box", applied: false })).toContain(
      "already changed",
    );
  });
});
