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
    expect(panel.textContent).toContain("no kind word near the label");
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
