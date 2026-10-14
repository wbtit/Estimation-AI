// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExplanationPanel } from "./ExplanationPanel";
import { MembersPanel } from "./MembersPanel";
import { PipelineBar } from "./PipelineBar";
import { SymbolOverlay } from "./SymbolOverlay";
import { NO_FILTERS } from "../lib/symbols";
import type { KindInfo, MemberView } from "../lib/types";

afterEach(cleanup);

// SYNTHETIC members; every field the components read is set here.
function member(id: string, over: Record<string, unknown> = {}): MemberView {
  return {
    id,
    member_id: id,
    sheet_id: "s1",
    view_id: "v1",
    origin: "extracted",
    type: "beam",
    mark: null,
    profile_raw: "W12x26",
    profile: "W12X26",
    quantity: 1,
    level: null,
    deleted: false,
    review_status: "unreviewed",
    bbox: { x0: 100, y0: 90, x1: 140, y1: 100 },
    mark_ref: { status: null, legend_row_id: null },
    link: {
      source: "rule",
      confidence: "high",
      margin: 50,
      line: { p: [0, 120], q: [400, 120] },
      chosen_rank: 1,
      candidates: [
        {
          rank: 1,
          p: [0, 120],
          q: [400, 120],
          score: 6,
          dist: 6,
          rel_angle: 0,
          length_mm: null,
        },
        {
          rank: 2,
          p: [0, 220],
          q: [400, 220],
          score: 106,
          dist: 106,
          rel_angle: 0,
          length_mm: null,
        },
      ],
    },
    length_mm: null,
    length_ft_in: null,
    length_source: null,
    status: { color: "green", confirmed: false, reasons: [] },
    plan_point: null,
    system: null,
    human: "unreviewed",
    existing: false,
    joist_series: null,
    shared_line: null,
    length_shared: false,
    merged_into: null,
    not_member: null,
    kind: {
      name: "Beams",
      scope: "main",
      state: "guessed",
      source: "keyword",
      evidence: { keyword: "beam", where: "same_line", candidates: [] },
    },
    tag: { prefix: "XX", number: 1, text: "XX1", provisional: true },
    symbol_group: "linear",
    symbol_color: "green",
    counting: "counted",
    catalog: {
      found: true,
      shape_name: "W12X26",
      shape: "W",
      unit_w_lb_ft: 26,
      via: "exact",
      reason: null,
    },
    flags: [],
    changed_at: "2026-01-01T00:00:00.000Z",
    ...over,
  } as unknown as MemberView;
}

const KINDS: KindInfo[] = [
  {
    kind: "Beams",
    scope: "main",
    symbol_group: "linear",
    prefix: "XX",
    provisional: true,
    sort: 2,
  },
  {
    kind: "Column",
    scope: "main",
    symbol_group: "column",
    prefix: "YY",
    provisional: true,
    sort: 1,
  },
  {
    kind: "Stair",
    scope: "misc",
    symbol_group: "other",
    prefix: "ZZ",
    provisional: true,
    sort: 22,
  },
  {
    kind: "Joist",
    scope: "excluded",
    symbol_group: "none",
    prefix: "WW",
    provisional: true,
    sort: 34,
  },
];

describe("SymbolOverlay", () => {
  const draw = (members: MemberView[], selectedId: string | null = null) =>
    render(
      <svg>
        <SymbolOverlay
          members={members}
          selectedId={selectedId}
          zoom={1}
          highlight={null}
          onSelect={() => undefined}
        />
      </svg>,
    );

  it("draws one symbol per counted piece with its tag, shape by group and colour by confidence", () => {
    const { container } = draw([
      member("a"),
      member("b", {
        symbol_group: "column",
        symbol_color: "amber",
        tag: { prefix: "YY", number: 1, text: "YY1", provisional: true },
      }),
      member("c", { symbol_group: "plate", symbol_color: "grey" }),
      member("d", { symbol_group: "other", symbol_color: "red" }),
    ]);
    const syms = [...container.querySelectorAll("[data-testid=count-symbol]")];
    expect(
      syms.map((s) => [
        s.getAttribute("data-group"),
        s.getAttribute("data-colour"),
      ]),
    ).toEqual([
      ["linear", "green"],
      ["column", "amber"],
      ["plate", "grey"],
      ["other", "red"],
    ]);
    expect(syms[0]?.querySelector("circle")).not.toBeNull(); // linear = circle
    expect(syms[1]?.querySelector("path")).not.toBeNull(); // triangle
    expect(screen.getByText("YY1")).toBeTruthy();
  });

  it("puts a blue ring on a piece a person confirmed, and none on an unreviewed one", () => {
    const { container } = draw([
      member("a"),
      member("b", { human: "confirmed" }),
    ]);
    const rings = container.querySelectorAll("[data-testid=reviewed-ring]");
    expect(rings).toHaveLength(1);
  });

  it("draws no symbol for excluded kinds, misc kinds, existing steel or deleted pieces", () => {
    const { container } = draw([
      member("a", { counting: "not_counted" }),
      member("b", { counting: "misc_reserved" }),
      member("c", { existing: true }),
      member("d", { deleted: true }),
    ]);
    expect(
      container.querySelectorAll("[data-testid=count-symbol]"),
    ).toHaveLength(0);
  });

  it("draws an unlinked label as a small red hollow square, not as a count symbol", () => {
    const { container } = draw([
      member("u", {
        status: {
          color: "unlinked",
          confirmed: false,
          reasons: ["no candidate line"],
        },
      }),
    ]);
    expect(
      container.querySelectorAll("[data-testid=unlinked-square]"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("[data-testid=count-symbol]"),
    ).toHaveLength(0);
  });
});

describe("ExplanationPanel", () => {
  const sheet = {
    page_number: 3,
    page_type: {
      effective: "framing_plan",
      guess: "framing_plan",
      reason: "title words: FRAMING, PLAN",
      overridden: false,
    },
  } as never;
  const view = {
    id: "v1",
    scale: { ratio: 96, text: '1/8" = 1\'-0"', confirmed: false },
  } as never;
  const render1 = (m: MemberView, onJump = vi.fn(), extra: object = {}) => {
    render(
      <ExplanationPanel
        member={m}
        sheet={sheet}
        view={view}
        legend={[]}
        history={[
          {
            field: "kind",
            before: { reset: true },
            after: "Beams",
            who: "alice",
            at: "2026-01-02T10:20:30.000Z",
            is_undo: false,
          },
        ]}
        onJump={onJump}
        onGotoPage={() => undefined}
        actions={<div>actions here</div>}
        {...extra}
      />,
    );
    return onJump;
  };

  it("shows a typical multiplier and its note in the evidence (Phase 10)", () => {
    render1(
      member("t", {
        quantity: 6,
        typical: {
          n: 6,
          note: "six bays per the typical note",
          base_quantity: 1,
        },
      }),
    );
    expect(screen.getByTestId("typical-evidence").textContent).toBe(
      "x6 (counts 6 pieces): six bays per the typical note",
    );
  });

  it("lists every piece of evidence and says 'not found' for what is missing", () => {
    render1(
      member("a", {
        kind: {
          name: null,
          scope: null,
          state: "missing",
          source: null,
          evidence: null,
        },
        catalog: {
          found: false,
          shape_name: null,
          shape: null,
          unit_w_lb_ft: null,
          via: null,
          reason: "not_in_catalog",
        },
        link: {
          source: "none",
          confidence: null,
          margin: null,
          line: null,
          chosen_rank: null,
          candidates: [],
        },
        profile: null,
      }),
    );
    const panel = screen.getByTestId("explanation");
    for (const label of [
      "Label text",
      "Size",
      "Catalog",
      "Kind",
      "Page type",
      "Link",
      "Rule",
      "Scale of the view",
      "Shared line",
      "Linked line",
      "Missing",
    ])
      expect(within(panel).getByText(label)).toBeTruthy();
    expect(panel.textContent).toContain("not parsed");
    expect(panel.textContent).toContain("no kind word in the label's own line");
    expect(panel.textContent).toContain("not in the catalog");
    expect(panel.textContent).toContain("no line found within reach");
    expect(panel.textContent).toContain("guessed, not confirmed");
    expect(panel.textContent).toContain(
      "framing plan (guess): title words: FRAMING, PLAN",
    );
  });

  it("jump links highlight the label and each candidate line on the page", () => {
    const onJump = render1(member("a"));
    const jumps = screen.getAllByText("jump");
    fireEvent.click(jumps[0] as HTMLElement); // label text
    expect(onJump).toHaveBeenLastCalledWith({
      box: { x0: 100, y0: 90, x1: 140, y1: 100 },
      kind: "label",
    });
    fireEvent.click(screen.getByText("show the line"));
    expect(onJump).toHaveBeenLastCalledWith({
      line: [0, 120, 400, 120],
      kind: "line",
    });
    fireEvent.click(screen.getByText("#2 (106 pt)"));
    expect(onJump).toHaveBeenLastCalledWith({
      line: [0, 220, 400, 220],
      kind: "candidate",
    });
  });

  it("shows the history with who, when and what, and the actions", () => {
    render1(member("a"));
    expect(
      screen.getByText(
        /changed by alice, 2026-01-02 10:20: kind from the system's guess to Beams/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("actions here")).toBeTruthy();
  });

  it("never shows a length as a figure of the piece (a grey hint at most)", () => {
    render1(member("a"));
    expect(screen.getByTestId("explanation").textContent).toContain(
      "lengths are added in Stage 2",
    );
  });
});

describe("MembersPanel", () => {
  const props = (members: MemberView[], over: object = {}) => ({
    members,
    kinds: KINDS,
    selectedId: null,
    onSelect: () => undefined,
    addingColumn: false,
    onAddColumn: () => undefined,
    filters: NO_FILTERS,
    onFilters: () => undefined,
    lastRunStart: null,
    ...over,
  });

  it("counts the pieces by colour, with a grey 'no kind' count, and notes that lengths come in Stage 2", () => {
    render(
      <MembersPanel
        {...props([
          member("a"),
          member("b", { symbol_color: "amber" }),
          member("c", { symbol_color: "grey" }),
        ])}
      />,
    );
    const chips = screen.getByTestId("colour-counts").textContent ?? "";
    expect(chips).toContain("1 no kind");
    expect(screen.getByTestId("stage-note").textContent).toContain(
      "Lengths are added in Stage 2",
    );
  });

  it("lists excluded kinds as 'not counted' and misc kinds as reserved, apart from the pieces", () => {
    render(
      <MembersPanel
        {...props([
          member("a"),
          member("j", {
            counting: "not_counted",
            kind: {
              name: "Joist",
              scope: "excluded",
              state: "guessed",
              source: "keyword",
              evidence: null,
            },
          }),
          member("s", {
            counting: "misc_reserved",
            kind: {
              name: "Stair",
              scope: "misc",
              state: "guessed",
              source: "keyword",
              evidence: null,
            },
          }),
        ])}
      />,
    );
    expect(
      within(screen.getByTestId("not-counted")).getByText("Joist"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("misc-reserved")).getByText("Stair"),
    ).toBeTruthy();
    // the main list holds only the counted piece
    expect(screen.getAllByText("W12x26").length).toBeGreaterThanOrEqual(1);
  });

  it("filters by colour through the chips and by the kind dropdown", () => {
    const onFilters = vi.fn();
    render(<MembersPanel {...props([member("a")], { onFilters })} />);
    fireEvent.click(screen.getByTitle("show only amber"));
    expect(onFilters.mock.calls[0]?.[0].colours.has("amber")).toBe(true);
    fireEvent.change(screen.getByLabelText("filter by kind"), {
      target: { value: "Column" },
    });
    expect(onFilters.mock.calls[1]?.[0].kind).toBe("Column");
  });

  it("only-changed is disabled until a run has happened", () => {
    render(<MembersPanel {...props([member("a")])} />);
    expect(
      (
        screen.getByLabelText(
          /only changed since the last run/,
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });
});

describe("kind hint and sheet list", () => {
  it("shows a nearby-text hint as grey text beside an empty kind, marked as not used", () => {
    render(
      <ExplanationPanel
        member={member("a", {
          kind: {
            name: null,
            scope: null,
            state: "missing",
            source: null,
            evidence: null,
            hint: { kind: "Truss", keyword: "truss", where: "sheet_title" },
          },
        })}
        sheet={null}
        view={null}
        legend={[]}
        history={[]}
        onJump={() => undefined}
        onGotoPage={() => undefined}
        actions={null}
      />,
    );
    const text = screen.getByTestId("explanation").textContent ?? "";
    expect(text).toContain("hint only, not used");
    expect(text).toContain("in the sheet title");
  });

  it("lists each sheet with its piece count and the likely-not-framing flag", async () => {
    const { PageList } = await import("./PageList");
    const sheet = (id: string, n: number) =>
      ({
        id,
        page_number: n,
        sheet_number: `S${n}`,
        kind: "plan",
        page_type: { effective: "detail", overridden: false },
        review_reasons: [],
        needs_review: false,
        thumbnail_url: null,
        takeoff: { decision: "undecided", included: true },
      }) as never;
    const flags = new Map([
      [
        "a",
        {
          sheet_id: "a",
          page_number: 1,
          included: true,
          by_default: true,
          piece_count: 12,
          likely_not_framing: false,
          flags: [],
          confirmed_by: null,
          confirmed_at: null,
        },
      ],
      [
        "b",
        {
          sheet_id: "b",
          page_number: 2,
          included: true,
          by_default: true,
          piece_count: 0,
          likely_not_framing: true,
          flags: [],
          confirmed_by: null,
          confirmed_at: null,
        },
      ],
    ]);
    render(
      <PageList
        sheets={[sheet("a", 1), sheet("b", 2)]}
        selectedId="a"
        onSelect={() => undefined}
        flags={flags as never}
      />,
    );
    expect(screen.getByText("12 pcs")).toBeTruthy();
    expect(screen.getByText("0 pcs")).toBeTruthy();
    expect(screen.getAllByTitle(/likely not a framing sheet/)).toHaveLength(1);
  });
});

describe("PipelineBar", () => {
  const draft = {
    unconfirmed_sheets: 3,
    unconfirmed_included: 1,
    unconfirmed_excluded_by_default: 2,
    reviewed: false,
    label: "draft, 3 sheets unconfirmed",
  };
  it("shows the draft label, the running state and the confirm-all button", () => {
    const onConfirmExcluded = vi.fn();
    render(
      <PipelineBar
        flags={{ draft, sheets: [], last_run: null }}
        running
        onRerun={() => undefined}
        onConfirmExcluded={onConfirmExcluded}
      />,
    );
    expect(screen.getByTestId("draft-label").textContent).toBe(
      "draft, 3 sheets unconfirmed",
    );
    expect(screen.getByRole("status").textContent).toContain("marking members");
    fireEvent.click(screen.getByText("Confirm all 2 excluded sheets"));
    expect(onConfirmExcluded).toHaveBeenCalled();
    expect((screen.getByText("Run again") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("says reviewed when nothing is unconfirmed", () => {
    render(
      <PipelineBar
        flags={{
          draft: {
            ...draft,
            unconfirmed_sheets: 0,
            unconfirmed_included: 0,
            unconfirmed_excluded_by_default: 0,
            reviewed: true,
            label: "reviewed",
          },
          sheets: [],
          last_run: null,
        }}
        running={false}
        onRerun={() => undefined}
        onConfirmExcluded={() => undefined}
      />,
    );
    expect(screen.getByTestId("draft-label").textContent).toBe("reviewed");
    expect(screen.queryByText(/Confirm all/)).toBeNull();
  });
});

describe("TablesPanel", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    key: "k1",
    kind: "Beams",
    quantity: 3,
    reference: "S1.1 (+1)",
    sheets: [1, 2],
    shape: "W",
    size: "12X26",
    name: "Beams",
    name_is_system: true,
    length_ft: null,
    length_in: null,
    unit_w: 26,
    total_w: null,
    grade: null,
    grade_suggestion: "A992",
    colour: "amber",
    flags: ["system wording"],
    tags: ["XX1", "XX2", "XX3"],
    member_ids: ["a", "b", "c"],
    ...over,
  });
  const apart = (pieces = 0) => ({
    pieces,
    by_kind: pieces ? [{ kind: "Beams", pieces }] : [],
    member_ids: [],
  });
  const data = {
    project: { id: "p", name: "n", number: null },
    draft: {
      unconfirmed_sheets: 1,
      unconfirmed_included: 1,
      unconfirmed_excluded_by_default: 0,
      reviewed: false,
      label: "draft, 1 sheet unconfirmed",
    },
    stage_note:
      "Lengths and Total W are added in Stage 2; those cells are empty on purpose.",
    job: {
      rows: [row()],
      quantity: 3,
      summary: [
        { kind: "Beams", scope: "main", quantity: 3, groups: 1, note: null },
        {
          kind: null,
          scope: null,
          quantity: 0,
          groups: 0,
          note: "kind not set yet: choose it",
        },
        {
          kind: "Stair",
          scope: "misc",
          quantity: 1,
          groups: 0,
          note: "not computed (misc steel is reserved)",
        },
      ],
      red: apart(2),
      existing: apart(),
      not_counted: apart(1),
      misc: apart(),
      unlinked: 0,
      sheets_excluded: [3],
    },
    pages: [
      {
        sheet_id: "s",
        page_number: 1,
        sheet_number: "S1.1",
        rows: [row({ reference: "S1.1" })],
        quantity: 3,
        red: apart(),
        existing: apart(),
        not_counted: apart(),
        misc: apart(),
        unlinked: 0,
      },
    ],
  };

  async function mount(over: Partial<{ onSelectRow: () => void }> = {}) {
    const { TablesPanel } = await import("./TablesPanel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(data),
      })),
    );
    const onSelectRow = over.onSelectRow ?? vi.fn();
    render(
      <TablesPanel
        projectId="p"
        pageNumber={1}
        version={0}
        kinds={KINDS}
        who="alice"
        onError={() => undefined}
        onSelectRow={onSelectRow}
        selectedKeys={new Set()}
        onChanged={() => undefined}
      />,
    );
    await screen.findByTestId("tables-draft");
    return onSelectRow;
  }

  it("shows the estimator's columns with Kind first, empty length and Total W cells, and the draft label", async () => {
    await mount();
    const table = screen.getByLabelText("page table");
    const heads = [...table.querySelectorAll("th")].map((h) => h.textContent);
    expect(heads).toEqual([
      "Kind",
      "Reference Dwg No.",
      "Quantity",
      "SHAPE",
      "Size",
      "Name",
      "Length ft",
      "Length In",
      "Unit W",
      "Total W",
      "Grade",
    ]);
    const cells = [...table.querySelectorAll("tbody tr td")].map(
      (c) => c.textContent,
    );
    expect(cells[2]).toBe("3");
    expect(cells[6]).toBe(""); // Length ft
    expect(cells[7]).toBe(""); // Length In
    expect(cells[9]).toBe(""); // Total W
    expect(cells[10]).toBe("(A992?)"); // grade only suggested, never filled in
    expect(screen.getByTestId("tables-draft").textContent).toBe(
      "draft, 1 sheet unconfirmed",
    );
    expect(screen.getByText(/Export Excel \(draft\)/)).toBeTruthy();
  });

  it("lists the summary by kind with misc reserved, and the red pieces on their own line", async () => {
    await mount();
    const summary = screen.getByLabelText("summary by kind");
    expect(summary.textContent).toContain("Stair");
    expect(summary.textContent).toContain("Red, not counted");
    expect(summary.textContent).toContain("weight is added in Stage 2");
    expect(screen.getByLabelText("job table").textContent).toContain(
      "1 sheets excluded: pages 3",
    );
  });

  it("clicking a row selects its pieces on the page", async () => {
    const onSelectRow = await mount();
    fireEvent.click(
      screen
        .getByLabelText("page table")
        .querySelector("tbody tr") as HTMLElement,
    );
    expect(onSelectRow).toHaveBeenCalled();
    expect(
      (onSelectRow as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].member_ids,
    ).toEqual(["a", "b", "c"]);
  });

  it("changing a row's kind posts one action for all its pieces", async () => {
    await mount();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fireEvent.change(
      screen.getAllByLabelText("kind of 12X26")[0] as HTMLElement,
      { target: { value: "Column" } },
    );
    await Promise.resolve();
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/rows/kind"),
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call?.[1].body)).toEqual({
      member_ids: ["a", "b", "c"],
      kind: "Column",
      who: "alice",
    });
  });
});

describe("NewJob", () => {
  it("creates a job named after the file, uploads the PDF and hands the project back", async () => {
    const { NewJob } = await import("./NewJob");
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "p1",
            name: "Some Job",
            document: { id: "d1", scan_status: "pending" },
          }),
        };
      }),
    );
    const onCreated = vi.fn();
    render(<NewJob onCreated={onCreated} onError={() => undefined} />);
    const file = new File(["%PDF-1.7"], "Some Job.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("upload a PDF"), {
      target: { files: [file] },
    });
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls[0]?.url).toBe("/api/projects");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: "Some Job",
    });
    expect(calls[1]?.url).toBe("/api/projects/p1/pdf");
    expect(calls[1]?.init?.body).toBeInstanceOf(FormData);
  });

  it("reports an upload error from the API", async () => {
    const { NewJob } = await import("./NewJob");
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        return n === 1
          ? { ok: true, status: 201, json: async () => ({ id: "p1" }) }
          : {
              ok: false,
              status: 415,
              json: async () => ({ error: "not a PDF" }),
            };
      }),
    );
    const onError = vi.fn();
    render(<NewJob onCreated={() => undefined} onError={onError} />);
    fireEvent.change(screen.getByLabelText("upload a PDF"), {
      target: {
        files: [new File(["x"], "a.pdf", { type: "application/pdf" })],
      },
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(String(onError.mock.calls[0]?.[0])).toContain("not a PDF");
  });
});
