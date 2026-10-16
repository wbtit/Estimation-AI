// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_LAYERS,
  type BomRow,
  type Page,
  type Piece,
  type Project,
} from "../lib/lf";
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
    expect(screen.getByText("S-201")).toBeTruthy();
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("Estimating")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("build page"));
    expect(a.build).toHaveBeenCalled();
  });

  it("shows Top of Steel, Scale and Status only on the selected card", () => {
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
    expect(screen.getByText("Status")).toBeTruthy();
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
    );
  });

  it("⋮ sets the role and the column plan", () => {
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
      "s0",
    );
    fireEvent.click(screen.getByLabelText("page menu"));
    fireEvent.click(screen.getByText("Skip"));
    expect(a.setRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      null,
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

describe("properties", () => {
  const kinds = [
    { kind: "Beams", scope: "main", symbol_group: "linear" },
    { kind: "Column", scope: "main", symbol_group: "column" },
  ];

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
    expect(screen.getByTestId("summary").textContent).toContain("2.00tons");
  });

  it("sections open and close; Delete is in the Member section", () => {
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
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.queryByTestId("summary")).toBeNull();
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.getByTestId("summary")).toBeTruthy();
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
  it("draws a beam with its size, and one amber flag and a tooltip for one that needs review", () => {
    const { container } = render(
      <svg>
        <PieceMark
          p={piece({ build_state: "needs_review", support_state: "one" })}
          px={1}
          on={false}
          labels
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
      "var(--amber)",
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
      "Layers",
      "Fit",
      "Crop",
      "Pick beam",
      "Draw beam",
      "Draw column",
      "Measure",
      "Undo",
    ]);
    expect(screen.getByLabelText("Crop").getAttribute("data-tip")).toBe("Crop");
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
});
